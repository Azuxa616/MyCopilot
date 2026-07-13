// Barrel export for the tools subsystem.
//
// Route handlers, the agent loop, and boot code import everything they need
// from here rather than reaching into individual modules.

export {
  registerTool,
  getToolExecutor,
  listRegisteredTools,
  clearRegisteredTools,
} from './registry.js';
export type {
  ToolExecutor,
  ToolExecutionResult,
  ToolExecutionContext,
} from './registry.js';

export { executeToolCall } from './executor.js';

export {
  requestToolApproval,
  resolveToolApproval,
  getPendingToolApproval,
  isConfirmedThisSession,
  markConfirmedThisSession,
  clearSessionConfirmations,
  clearToolConfirmations,
  cancelToolApprovalsForSession,
  clearPendingConfirmations,
} from './confirmation.js';
