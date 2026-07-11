import type { Tool } from '@my-copilot/shared';

/** Uniform result shape produced by every tool executor (built-in or MCP). */
export interface ToolExecutionResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

/** Runtime context passed to every tool executor. */
export interface ToolExecutionContext {
  signal?: AbortSignal;
  sessionId: string;
}

/**
 * A built-in tool executor.
 *
 * - `execute` runs the tool with parsed args and context.
 * - `describe` returns the static `Tool` metadata used to advertise the tool
 *   to the LLM and the frontend.
 */
export interface ToolExecutor {
  execute(
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult>;
  describe(): Tool;
}

/**
 * Module-level registry of built-in tool executors.
 *
 * Mirrors the pattern used by `streaming/registry.ts`: a flat module-scoped
 * Map plus thin functional accessors. Tools are registered once at boot
 * (T12/T13 wire the real built-ins) and read on every tool call.
 *
 * Keys are tool names, which are unique across the registry. Re-registering
 * the same name throws — this is intentional to surface double-registration
 * bugs early instead of silently shadowing the previous executor.
 */
const executors = new Map<string, ToolExecutor>();

/**
 * Register a built-in tool executor under `name`.
 *
 * @throws Error if `name` is already registered.
 */
export function registerTool(name: string, executor: ToolExecutor): void {
  if (executors.has(name)) {
    throw new Error(`Tool "${name}" is already registered`);
  }
  executors.set(name, executor);
}

/** Look up the executor registered under `name`, if any. */
export function getToolExecutor(name: string): ToolExecutor | undefined {
  return executors.get(name);
}

/** Return the static `Tool` descriptors for every registered built-in. */
export function listRegisteredTools(): Tool[] {
  return Array.from(executors.values()).map((e) => e.describe());
}

/** Test-only escape hatch: clears the registry without invoking executors. */
export function clearRegisteredTools(): void {
  executors.clear();
}
