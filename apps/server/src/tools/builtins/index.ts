// Built-in tools will be registered here in T12 (web_search) and T13 (http_fetch).
//
// This barrel exists so that `apps/server/src/index.ts` (or a boot module) can
// import `./tools/builtins/index.js` once and trigger every built-in's
// `registerTool()` side effect, without T10 having to know which built-ins
// exist.

// T13 exports (T12 will add web-search exports)
export { httpFetchExecutor, registerHttpFetch } from './http-fetch.js';

export { webSearchExecutor, registerWebSearch } from './web-search.js';
// T13 will add http-fetch exports here
