import type { ToolExecutor } from '../registry.js';
import {
  MAX_TEXT_INPUT_BYTES,
  builtinTool,
  executeLocalTool,
  jsonResult,
  requiredString,
} from './helpers.js';

const MAX_BASE64_INPUT_BYTES = Math.ceil(MAX_TEXT_INPUT_BYTES * 4 / 3) + 4;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export const base64DecodeExecutor: ToolExecutor = {
  describe: () => builtinTool({
    id: 'base64-decode',
    name: 'base64_decode',
    description: 'Strictly decode Base64 data as UTF-8 text.',
    fields: [
      { name: 'data', type: 'string', description: 'Valid Base64 data to decode', required: true },
    ],
  }),
  async execute(args, context) {
    return executeLocalTool(context, () => {
      const data = requiredString(args, 'data', MAX_BASE64_INPUT_BYTES);
      if (!BASE64_PATTERN.test(data)) throw new Error('Parameter "data" must be valid Base64');
      const decoded = Buffer.from(data, 'base64');
      if (decoded.byteLength > MAX_TEXT_INPUT_BYTES) {
        throw new Error(`Decoded data exceeds the ${MAX_TEXT_INPUT_BYTES} byte limit`);
      }
      const text = new TextDecoder('utf-8', { fatal: true }).decode(decoded);
      return jsonResult({ text });
    });
  },
};
