import { createHash } from 'node:crypto';
import type { ToolExecutor } from '../registry.js';
import {
  builtinTool,
  executeLocalTool,
  jsonResult,
  requiredString,
} from './helpers.js';

export const hashTextExecutor: ToolExecutor = {
  describe: () => builtinTool({
    id: 'hash-text',
    name: 'hash_text',
    description: 'Create a SHA-256 hexadecimal digest of UTF-8 text.',
    fields: [
      { name: 'text', type: 'string', description: 'UTF-8 text to hash', required: true },
    ],
  }),
  async execute(args, context) {
    return executeLocalTool(context, () => {
      const text = requiredString(args, 'text');
      return jsonResult({
        algorithm: 'sha256',
        digest: createHash('sha256').update(text, 'utf8').digest('hex'),
      });
    });
  },
};
