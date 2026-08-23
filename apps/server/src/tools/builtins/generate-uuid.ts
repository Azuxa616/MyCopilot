import { randomUUID } from 'node:crypto';
import type { ToolExecutor } from '../registry.js';
import { builtinTool, executeLocalTool, jsonResult } from './helpers.js';

export const generateUuidExecutor: ToolExecutor = {
  describe: () => builtinTool({
    id: 'generate-uuid',
    name: 'generate_uuid',
    description: 'Generate a cryptographically random UUID version 4.',
    fields: [],
  }),
  async execute(_args, context) {
    return executeLocalTool(context, () => jsonResult({
      uuid: randomUUID(),
      version: 4,
    }));
  },
};
