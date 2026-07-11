import type { ToolCall } from '@my-copilot/shared';
import type { ToolExecutionResult, ToolExecutionContext } from './registry.js';
import { getToolExecutor } from './registry.js';
import { listTools } from '../repo/tool.js';
import { listEnabledMcps } from '../repo/mcp.js';
import { callTool as mcpCallTool } from '../mcp/manager.js';
import { waitForConfirmation } from './confirmation.js';

/** Default timeout for user confirmation of high-danger tools (5 minutes). */
const CONFIRMATION_TIMEOUT_MS = 300_000;

/**
 * Execute a tool call produced by the LLM, routing it to the right backend:
 *
 *   1. Built-in executor (registered via {@link registerTool}) — fastest path.
 *   2. DB tool (`type: 'mcp-provided'`) — gated by `waitForConfirmation`
 *      when `dangerLevel === 'high'`, then routed to its owning MCP.
 *   3. Dynamically discovered MCP tool (not in DB) — best-effort MCP route.
 *
 * Any exception thrown by an executor is caught and converted to an
 * `isError: true` result so the agent loop can feed the error back to the
 * LLM rather than crashing the request.
 *
 * NOTE on DB lookup: `repo/tool.ts#getTool(id)` queries by `id`, but LLM
 * tool calls only carry the tool `name`. We therefore resolve DB tools by
 * filtering `listTools()` on `name`. This is O(n_tools) per call; for the
 * current scale (tens of tools) this is negligible and avoids touching
 * `repo/tool.ts` (out of scope for T10).
 */
export async function executeToolCall(
  toolCall: ToolCall,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  try {
    // 1. Built-in executor (registered in-memory).
    const builtin = getToolExecutor(toolCall.name);
    if (builtin) {
      const args = JSON.parse(toolCall.arguments) as Record<string, unknown>;
      return await builtin.execute(args, context);
    }

    // 2. DB-registered tool.
    const dbTool = listTools().find((t) => t.name === toolCall.name);
    if (dbTool) {
      // Gate high-danger tools on user confirmation before doing anything.
      if (dbTool.dangerLevel === 'high') {
        const callId = `${context.sessionId}:${toolCall.id}`;
        const approved = await waitForConfirmation(
          callId,
          toolCall,
          CONFIRMATION_TIMEOUT_MS,
        );
        if (!approved) {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: 'Tool execution was rejected by user',
              },
            ],
          };
        }
      }

      // DB tool without a built-in executor must be an MCP-provided tool.
      // (Built-in type tools always have a registered executor in step 1.)
      if (dbTool.type === 'mcp-provided') {
        const args = JSON.parse(toolCall.arguments) as Record<string, unknown>;
        try {
          return await routeToMcp(toolCall.name, args, context.signal);
        } catch (err) {
          // We know this is an MCP tool (DB says so) but routing failed —
          // surface the routing error rather than masking it as "unknown".
          const message =
            err instanceof Error ? err.message : String(err);
          return {
            isError: true,
            content: [{ type: 'text', text: message }],
          };
        }
      }

      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `No executor registered for tool "${toolCall.name}"`,
          },
        ],
      };
    }

    // 3. Fallback: dynamically discovered MCP tool not persisted in DB.
    // If routing throws (no MCPs / all errored), we swallow and fall through
    // to the generic "Unknown tool" return — without DB evidence we can't
    // claim this was ever an MCP tool.
    try {
      const args = JSON.parse(toolCall.arguments) as Record<string, unknown>;
      return await routeToMcp(toolCall.name, args, context.signal);
    } catch {
      // Fall through to "Unknown tool".
    }

    return {
      isError: true,
      content: [{ type: 'text', text: `Unknown tool "${toolCall.name}"` }],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      isError: true,
      content: [{ type: 'text', text: message }],
    };
  }
}

/**
 * Route a tool call to the MCP server that exposes it.
 *
 * Iterates over enabled MCPs and invokes the tool on the first server that
 * accepts it. This is best-effort: if the tool name doesn't exist on any
 * MCP, every call throws and we re-throw the final error.
 *
 * The MCP manager's `callTool` requires `(mcpId, config, toolName, args)`,
 * so we must resolve both `mcpId` and `config` from the DB — which is why
 * this helper lives here rather than in the manager.
 *
 * @throws Error when no MCP is enabled, or when every enabled MCP rejects.
 */
async function routeToMcp(
  toolName: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<ToolExecutionResult> {
  const enabledMcps = listEnabledMcps();
  if (enabledMcps.length === 0) {
    throw new Error(`No MCP server provides tool "${toolName}"`);
  }

  let lastError: unknown;
  for (const mcp of enabledMcps) {
    try {
      const raw = await mcpCallTool(
        mcp.id,
        mcp.config,
        toolName,
        args,
        signal,
      );
      return normalizeMcpResult(raw);
    } catch (err) {
      lastError = err;
      // Try the next MCP server.
    }
  }

  const message =
    lastError instanceof Error ? lastError.message : String(lastError ?? 'unknown');
  throw new Error(`MCP tool "${toolName}" failed: ${message}`);
}

/**
 * Coerce a raw MCP `callTool` result into the uniform `ToolExecutionResult`.
 *
 * The MCP SDK returns `{ content: Array<ContentEntry> }` where each entry is
 * a `{ type, ... }` object (text, image, etc.). For text entries we extract
 * the `.text` field; all other shapes are JSON-stringified so the LLM still
 * gets a view of them.
 */
function normalizeMcpResult(raw: unknown): ToolExecutionResult {
  if (
    raw !== null &&
    typeof raw === 'object' &&
    'content' in raw &&
    Array.isArray((raw as { content: unknown }).content)
  ) {
    const content = (raw as { content: unknown[] }).content;
    return {
      content: content.map((c) => {
        // MCP text content entry: { type: 'text', text: string }
        if (
          c !== null &&
          typeof c === 'object' &&
          'text' in c &&
          typeof (c as { text: unknown }).text === 'string'
        ) {
          return { type: 'text' as const, text: (c as { text: string }).text };
        }
        return {
          type: 'text' as const,
          text: typeof c === 'string' ? c : JSON.stringify(c),
        };
      }),
    };
  }

  // Unexpected shape — surface as text so the agent loop can react.
  return {
    content: [
      { type: 'text', text: typeof raw === 'string' ? raw : JSON.stringify(raw) },
    ],
  };
}
