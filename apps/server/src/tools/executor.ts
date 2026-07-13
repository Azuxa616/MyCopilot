import { createHash } from 'node:crypto';
import { resolve as resolvePath } from 'node:path';
import type {
  SafetyLevel,
  Tool,
  ToolCall,
  ToolRef,
} from '@my-copilot/shared';
import type { ToolExecutionResult, ToolExecutionContext } from './registry.js';
import { getToolExecutor } from './registry.js';
import { getToolsByName } from '../repo/tool.js';
import { getAgentToolSafetyOverride } from '../repo/agent.js';
import { listEnabledMcps } from '../repo/mcp.js';
import {
  callTool as mcpCallTool,
  listTools as listMcpTools,
} from '../mcp/manager.js';
import {
  isConfirmedThisSession,
  markConfirmedThisSession,
  requestToolApproval,
} from './confirmation.js';

const DEFAULT_AGENT_ID = 'default';
const STRICTNESS: Record<SafetyLevel, number> = {
  safe: 0,
  restricted: 1,
  danger: 2,
};

interface ExecutionTarget {
  tool: Tool;
  ref: ToolRef;
  execute: (
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ) => Promise<ToolExecutionResult>;
}

export async function executeToolCall(
  toolCall: ToolCall,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  try {
    const args = parseArguments(toolCall.arguments);
    const target = await resolveExecutionTarget(toolCall.name, context);
    const agentId = context.agentId ?? DEFAULT_AGENT_ID;
    const safetyLevel = resolveEffectiveSafetyLevel(target.tool, target.ref, agentId);
    const argumentsDigest = digest(stableSerialize(args));
    const resourceScope = deriveResourceScope(args, argumentsDigest);
    const cacheKey = [
      context.sessionId,
      agentId,
      target.ref.id,
      target.ref.sourceMcpId ?? '-',
      target.ref.policyVersion,
      resourceScope,
      argumentsDigest,
    ].join(':');

    const needsConfirmation =
      safetyLevel === 'danger' ||
      (safetyLevel === 'restricted' && !isConfirmedThisSession(cacheKey));

    if (needsConfirmation) {
      if (!context.onConfirmationRequired) {
        return errorResult('Tool confirmation is required but no confirmation channel is available');
      }
      const approved = await requestToolApproval({
        approval: {
          runId: context.runId ?? `${context.sessionId}:${toolCall.id}`,
          jobId: context.jobId ?? null,
          sessionId: context.sessionId,
          agentId,
          tool: target.ref,
          toolCallId: toolCall.id,
          arguments: toolCall.arguments,
          argumentsDigest,
          resourceScope,
          safetyLevel,
          policyVersion: target.ref.policyVersion,
        },
        signal: context.signal,
        onRequired: context.onConfirmationRequired,
        onSettled: context.onConfirmationSettled,
      });
      if (!approved) return errorResult('Tool execution was rejected or expired');
      if (safetyLevel === 'restricted') markConfirmedThisSession(cacheKey);
    }

    if (context.signal?.aborted) return errorResult('Tool execution was cancelled');
    return await target.execute(args, context);
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : String(error));
  }
}

async function resolveExecutionTarget(
  toolName: string,
  context: ToolExecutionContext,
): Promise<ExecutionTarget> {
  const advertised = context.advertisedTool;
  if (advertised && advertised.name !== toolName) {
    throw new Error(`Tool call name does not match advertised tool "${advertised.name}"`);
  }

  if (advertised?.type === 'built-in') {
    return resolveBuiltinTarget(advertised);
  }
  if (advertised?.type === 'mcp-provided') {
    return resolveMcpTarget(advertised);
  }

  const dbMatches = getToolsByName(toolName).filter((tool) => tool.enabled);
  if (dbMatches.length > 1) {
    throw new Error(`Tool name "${toolName}" is ambiguous`);
  }
  if (dbMatches[0]?.type === 'built-in') return resolveBuiltinTarget(dbMatches[0]);
  if (dbMatches[0]?.type === 'mcp-provided') return resolveMcpTarget(dbMatches[0]);

  const builtin = getToolExecutor(toolName);
  if (builtin) return resolveBuiltinTarget(builtin.describe());

  return resolveDynamicMcpTarget(toolName);
}

function resolveBuiltinTarget(tool: Tool): ExecutionTarget {
  const executor = getToolExecutor(tool.name);
  if (!executor) throw new Error(`No executor registered for tool "${tool.name}"`);
  const descriptor = executor.describe();
  const safetyLevel = stricterLevel(descriptor.safetyLevel, tool.safetyLevel);
  const effectiveTool = { ...tool, safetyLevel };
  return {
    tool: effectiveTool,
    ref: {
      id: effectiveTool.id,
      name: effectiveTool.name,
      source: 'built-in',
      sourceMcpId: null,
      policyVersion: effectiveTool.policyVersion,
    },
    execute: (args, executionContext) => executor.execute(args, executionContext),
  };
}

async function resolveMcpTarget(tool: Tool): Promise<ExecutionTarget> {
  const mcp = await resolveMcpProvider(tool.name, tool.sourceMcpId);
  const effectiveTool = {
    ...tool,
    safetyLevel: stricterLevel(tool.safetyLevel, 'restricted'),
    sourceMcpId: mcp.id,
  };
  return {
    tool: effectiveTool,
    ref: {
      id: effectiveTool.id,
      name: effectiveTool.name,
      source: 'mcp',
      sourceMcpId: mcp.id,
      policyVersion: effectiveTool.policyVersion,
    },
    execute: async (args, executionContext) => normalizeMcpResult(
      await mcpCallTool(
        mcp.id,
        mcp.config,
        tool.name,
        args,
        executionContext.signal,
      ),
    ),
  };
}

async function resolveDynamicMcpTarget(toolName: string): Promise<ExecutionTarget> {
  const mcp = await resolveMcpProvider(toolName, null);
  const policyVersion = `mcp:${mcp.id}:${mcp.updatedAt}`;
  const tool: Tool = {
    id: `mcp-${mcp.id}-${toolName}`,
    name: toolName,
    description: '',
    inputSchema: { fields: [] },
    type: 'mcp-provided',
    safetyLevel: 'restricted',
    sourceMcpId: mcp.id,
    policyVersion,
    enabled: true,
    createdAt: mcp.createdAt,
    updatedAt: mcp.updatedAt,
  };
  return resolveMcpTarget(tool);
}

async function resolveMcpProvider(toolName: string, preferredMcpId: string | null) {
  const mcps = listEnabledMcps();
  if (preferredMcpId) {
    const preferred = mcps.find((mcp) => mcp.id === preferredMcpId);
    if (!preferred) throw new Error(`MCP source "${preferredMcpId}" is not enabled`);
    return preferred;
  }

  const matches = (
    await Promise.all(
      mcps.map(async (mcp) => {
        try {
          const tools = await listMcpTools(mcp.id, mcp.config);
          return tools.some((tool) => tool.name === toolName) ? mcp : null;
        } catch {
          return null;
        }
      }),
    )
  ).filter((mcp): mcp is NonNullable<typeof mcp> => mcp !== null);

  if (matches.length === 0) throw new Error(`Unknown tool "${toolName}"`);
  if (matches.length > 1) throw new Error(`MCP tool "${toolName}" is ambiguous`);
  return matches[0];
}

function resolveEffectiveSafetyLevel(
  tool: Tool,
  ref: ToolRef,
  agentId: string,
): SafetyLevel {
  let level = ref.source === 'mcp'
    ? stricterLevel(tool.safetyLevel, 'restricted')
    : tool.safetyLevel;
  const override = getAgentToolSafetyOverride(agentId, tool.id);
  if (override !== 'inherit') level = stricterLevel(level, override);
  return level;
}

function stricterLevel(first: SafetyLevel, second: SafetyLevel): SafetyLevel {
  return STRICTNESS[first] >= STRICTNESS[second] ? first : second;
}

function parseArguments(raw: string): Record<string, unknown> {
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Tool arguments must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}

function deriveResourceScope(
  args: Record<string, unknown>,
  argumentsDigest: string,
): string {
  for (const key of ['path', 'file', 'directory']) {
    if (typeof args[key] === 'string' && args[key].trim()) {
      return `path:${resolvePath(args[key].trim())}`;
    }
  }
  if (typeof args.url === 'string') {
    try {
      return `origin:${new URL(args.url).origin}`;
    } catch {
      return `args:${argumentsDigest}`;
    }
  }
  return `args:${argumentsDigest}`;
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableSerialize(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function errorResult(message: string): ToolExecutionResult {
  return {
    isError: true,
    content: [{ type: 'text', text: message }],
  };
}

function normalizeMcpResult(raw: unknown): ToolExecutionResult {
  if (
    raw !== null &&
    typeof raw === 'object' &&
    'content' in raw &&
    Array.isArray((raw as { content: unknown }).content)
  ) {
    return {
      content: (raw as { content: unknown[] }).content.map((entry) => {
        if (
          entry !== null &&
          typeof entry === 'object' &&
          'text' in entry &&
          typeof (entry as { text: unknown }).text === 'string'
        ) {
          return { type: 'text' as const, text: (entry as { text: string }).text };
        }
        return {
          type: 'text' as const,
          text: typeof entry === 'string' ? entry : JSON.stringify(entry),
        };
      }),
    };
  }
  return {
    content: [{ type: 'text', text: typeof raw === 'string' ? raw : JSON.stringify(raw) }],
  };
}
