import type { ToolExecutor } from '../registry.js';
import { base64DecodeExecutor } from './base64-decode.js';
import { base64EncodeExecutor } from './base64-encode.js';
import { calculatorExecutor } from './calculator.js';
import { currentDatetimeExecutor } from './current-datetime.js';
import { generateUuidExecutor } from './generate-uuid.js';
import { hashTextExecutor } from './hash-text.js';
import { httpFetchExecutor } from './http-fetch.js';
import { jsonFormatExecutor } from './json-format.js';
import { webSearchExecutor } from './web-search.js';

export interface BuiltinExecutorRegistration {
  name: string;
  executor: ToolExecutor;
}

export const builtinExecutors: readonly BuiltinExecutorRegistration[] = [
  { name: 'web_search', executor: webSearchExecutor },
  { name: 'http_fetch', executor: httpFetchExecutor },
  { name: 'current_datetime', executor: currentDatetimeExecutor },
  { name: 'calculator', executor: calculatorExecutor },
  { name: 'generate_uuid', executor: generateUuidExecutor },
  { name: 'hash_text', executor: hashTextExecutor },
  { name: 'base64_encode', executor: base64EncodeExecutor },
  { name: 'base64_decode', executor: base64DecodeExecutor },
  { name: 'json_format', executor: jsonFormatExecutor },
];

export { base64DecodeExecutor } from './base64-decode.js';
export { base64EncodeExecutor } from './base64-encode.js';
export { calculatorExecutor } from './calculator.js';
export { currentDatetimeExecutor } from './current-datetime.js';
export { generateUuidExecutor } from './generate-uuid.js';
export { hashTextExecutor } from './hash-text.js';
export { httpFetchExecutor, registerHttpFetch } from './http-fetch.js';
export { jsonFormatExecutor } from './json-format.js';
export { webSearchExecutor, registerWebSearch } from './web-search.js';
