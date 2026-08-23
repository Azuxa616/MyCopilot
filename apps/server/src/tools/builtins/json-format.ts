import type { ToolExecutor } from '../registry.js';
import {
  builtinTool,
  executeLocalTool,
  jsonResult,
  optionalBoolean,
  optionalInteger,
  requiredString,
} from './helpers.js';

export const jsonFormatExecutor: ToolExecutor = {
  describe: () => builtinTool({
    id: 'json-format',
    name: 'json_format',
    description: 'Validate and format a JSON string with optional recursive key sorting.',
    fields: [
      { name: 'json', type: 'string', description: 'JSON text to validate and format', required: true },
      { name: 'indent', type: 'number', description: 'Indent width from 0 to 8; defaults to 2', required: false },
      { name: 'sortKeys', type: 'boolean', description: 'Recursively sort object keys; defaults to false', required: false },
    ],
  }),
  async execute(args, context) {
    return executeLocalTool(context, () => {
      const json = requiredString(args, 'json');
      const indent = optionalInteger(args, 'indent', 2, 0, 8);
      const sortKeys = optionalBoolean(args, 'sortKeys', false);
      const parsed = JSON.parse(json) as unknown;
      const value = sortKeys ? sortJsonKeys(parsed) : parsed;
      return jsonResult({ formatted: JSON.stringify(value, null, indent) });
    });
  },
};

function sortJsonKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonKeys);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortJsonKeys(child)]),
  );
}
