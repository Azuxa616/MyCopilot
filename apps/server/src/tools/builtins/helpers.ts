import type { Tool } from '@my-copilot/shared';
import type {
  ToolExecutionContext,
  ToolExecutionResult,
} from '../registry.js';

export const MAX_TEXT_INPUT_BYTES = 1024 * 1024;

export function builtinTool(params: {
  id: string;
  name: string;
  description: string;
  fields: Tool['inputSchema']['fields'];
  version?: number;
}): Tool {
  const version = params.version ?? 1;
  return {
    id: `builtin-${params.id}`,
    name: params.name,
    description: params.description,
    inputSchema: { fields: params.fields },
    type: 'built-in',
    safetyLevel: 'safe',
    sourceMcpId: null,
    policyVersion: `builtin:${params.id}:v${version}`,
    enabled: true,
    createdAt: 0,
    updatedAt: 0,
  };
}

export function executeLocalTool(
  context: ToolExecutionContext,
  operation: () => ToolExecutionResult,
): ToolExecutionResult {
  if (context.signal?.aborted) return errorResult('Tool execution was cancelled');
  try {
    return operation();
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : String(error));
  }
}

export function requiredString(
  args: Record<string, unknown>,
  name: string,
  maxBytes: number = MAX_TEXT_INPUT_BYTES,
): string {
  const value = args[name];
  if (typeof value !== 'string') {
    throw new Error(`Parameter "${name}" must be a string`);
  }
  assertByteLength(value, name, maxBytes);
  return value;
}

export function optionalString(
  args: Record<string, unknown>,
  name: string,
  maxBytes: number = MAX_TEXT_INPUT_BYTES,
): string | undefined {
  const value = args[name];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new Error(`Parameter "${name}" must be a string`);
  }
  assertByteLength(value, name, maxBytes);
  return value;
}

export function optionalBoolean(
  args: Record<string, unknown>,
  name: string,
  defaultValue: boolean,
): boolean {
  const value = args[name];
  if (value === undefined) return defaultValue;
  if (typeof value !== 'boolean') {
    throw new Error(`Parameter "${name}" must be a boolean`);
  }
  return value;
}

export function optionalInteger(
  args: Record<string, unknown>,
  name: string,
  defaultValue: number,
  minimum: number,
  maximum: number,
): number {
  const value = args[name];
  if (value === undefined) return defaultValue;
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`Parameter "${name}" must be an integer`);
  }
  if (value < minimum || value > maximum) {
    throw new Error(`Parameter "${name}" must be between ${minimum} and ${maximum}`);
  }
  return value;
}

export function jsonResult(value: unknown): ToolExecutionResult {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}

export function textResult(value: string): ToolExecutionResult {
  return { content: [{ type: 'text', text: value }] };
}

export function errorResult(message: string): ToolExecutionResult {
  return {
    isError: true,
    content: [{ type: 'text', text: message }],
  };
}

function assertByteLength(value: string, name: string, maxBytes: number): void {
  if (Buffer.byteLength(value, 'utf8') > maxBytes) {
    throw new Error(`Parameter "${name}" exceeds the ${maxBytes} byte limit`);
  }
}
