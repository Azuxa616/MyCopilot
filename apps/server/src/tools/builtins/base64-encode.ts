import type { ToolExecutor } from '../registry.js';
import {
  builtinTool,
  executeLocalTool,
  jsonResult,
  requiredString,
} from './helpers.js';

export const base64EncodeExecutor: ToolExecutor = {
  describe: () => builtinTool({
    id: 'base64-encode',
    name: 'base64_encode',
    description: 'Encode UTF-8 text as Base64.',
    fields: [
      { name: 'text', type: 'string', description: 'UTF-8 text to encode', required: true },
    ],
  }),
  async execute(args, context) {
    return executeLocalTool(context, () => {
      const text = requiredString(args, 'text');
      return jsonResult({ base64: Buffer.from(text, 'utf8').toString('base64') });
    });
  },
};
