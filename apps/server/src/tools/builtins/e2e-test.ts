import type { Tool } from '@my-copilot/shared';
import type {
  ToolExecutionContext,
  ToolExecutionResult,
  ToolExecutor,
} from '../registry.js';

// ---------------------------------------------------------------------------
// E2E test fixtures
// ---------------------------------------------------------------------------
//
// Two no-op tools used to exercise the danger / restricted confirmation
// flows end-to-end without depending on an external MCP server. Originally
// these existed only as orphan rows in the `tools` table (type=mcp-provided
// with source_mcp_id=null), which caused executor.ts to throw
// "Unknown tool" on every call and triggered the agent-loop death-loop
// (model retried indefinitely because the failure looked transient).
//
// Promoting them to first-class built-ins makes the executor resolve them
// through the built-in path, returning a deterministic string so the chat
// UI / e2e harness can assert on the result. The safetyLevel is hard-coded
// in code (not the DB) so it cannot drift.

const E2E_DANGER_TOOL: Tool = {
  id: 'builtin-e2e-danger',
  name: 'e2e_danger_tool',
  description:
    'E2E 测试工具（danger 级别）。返回固定字符串，用于验证 danger 工具的每次确认流程。',
  inputSchema: { fields: [] },
  type: 'built-in',
  safetyLevel: 'danger',
  sourceMcpId: null,
  policyVersion: 'builtin:e2e-danger:v1',
  enabled: true,
  createdAt: 0,
  updatedAt: 0,
};

const E2E_RESTRICTED_TOOL: Tool = {
  id: 'builtin-e2e-restricted',
  name: 'e2e_restricted_tool',
  description:
    'E2E 测试工具（restricted 级别）。返回固定字符串，用于验证 restricted 工具的会话内确认。',
  inputSchema: { fields: [] },
  type: 'built-in',
  safetyLevel: 'restricted',
  sourceMcpId: null,
  policyVersion: 'builtin:e2e-restricted:v1',
  enabled: true,
  createdAt: 0,
  updatedAt: 0,
};

/** Build the deterministic success payload for an e2e fixture tool. */
function e2eResult(toolName: string): ToolExecutionResult {
  return {
    content: [
      {
        type: 'text',
        text: `${toolName} executed successfully: confirmation flow OK.`,
      },
    ],
  };
}

export const e2eDangerExecutor: ToolExecutor = {
  describe: () => E2E_DANGER_TOOL,
  async execute(
    _args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    if (context.signal?.aborted) {
      return {
        isError: true,
        content: [{ type: 'text', text: 'Tool execution was cancelled' }],
      };
    }
    return e2eResult('e2e_danger_tool');
  },
};

export const e2eRestrictedExecutor: ToolExecutor = {
  describe: () => E2E_RESTRICTED_TOOL,
  async execute(
    _args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    if (context.signal?.aborted) {
      return {
        isError: true,
        content: [{ type: 'text', text: 'Tool execution was cancelled' }],
      };
    }
    return e2eResult('e2e_restricted_tool');
  },
};
