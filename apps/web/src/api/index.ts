/**
 * API entry module
 *
 * Re-exports the server-backed API surface. All API calls go through the server with
 * automatic Authorization. Importing `real` directly here means new functions added to
 * `real.ts` are available via `api.*` automatically — no manual re-listing needed.
 */

import * as real from './real';

export const api = real;

export type { RequestOptions } from './request';
export { enhancedFetch, fetchWithAuth, createTimeoutSignal } from './request';

// Error types
export {
    ApiError,
    NetworkError,
    HttpError,
    TimeoutError,
    BusinessError,
    AbortError,
    StreamError,
} from './errors';

// Error utilities
export {
    isApiError,
    getErrorMessage,
    getErrorCode,
    isRetryableError,
} from './errors';
