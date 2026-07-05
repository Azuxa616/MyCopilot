/**
 * API request wrapper module
 *
 * Provides generalized request functions with timeout control, auto-retry, error handling,
 * and automatic Authorization header attachment.
 */

import {
    ApiError,
    NetworkError,
    HttpError,
    AbortError,
    BusinessError,
    isRetryableError,
} from './errors';
import { useConfigStore } from '../store/configStore';

/**
 * Base URL for API requests.
 * In development, Vite proxy handles /api → localhost:3000 (empty string).
 * In production, set VITE_API_BASE_URL to the server origin (e.g., https://api.example.com).
 */
const baseURL = import.meta.env.VITE_API_BASE_URL || '';

/**
 * Request configuration options
 */
export interface RequestOptions extends RequestInit {
    /** Timeout in milliseconds, default 30000 (30s) */
    timeout?: number;
    /** Enable automatic retry, default false */
    retry?: boolean;
    /** Maximum retry count, default 3 */
    maxRetries?: number;
    /** Retry delay function, receives current attempt number, returns delay in ms */
    retryDelay?: (attempt: number) => number;
}

/**
 * Default timeout (30 seconds)
 */
const DEFAULT_TIMEOUT = 30000;

/**
 * Default max retries
 */
const DEFAULT_MAX_RETRIES = 3;

/**
 * Default retry delay strategy: exponential backoff
 * 1st retry: 1s, 2nd: 2s, 3rd: 4s
 */
const defaultRetryDelay = (attempt: number): number => {
    return Math.min(1000 * Math.pow(2, attempt - 1), 10000); // max 10s
};

/**
 * Unified fetch error handler - converts raw errors to ApiError types
 */
function handleFetchError(error: unknown, url?: string, method?: string): ApiError {
    if (error instanceof ApiError) {
        return error;
    }

    if (error instanceof Error && error.name === 'AbortError') {
        return new AbortError(url, method);
    }

    if (error instanceof TypeError) {
        return new NetworkError(
            `Network request failed: ${error.message}`,
            error,
            url,
            method,
        );
    }

    return new NetworkError(
        `Request failed: ${error instanceof Error ? error.message : String(error)}`,
        error,
        url,
        method,
    );
}

/**
 * Parse response and handle HTTP errors
 */
async function parseResponse<T>(
    response: Response,
    url?: string,
    method?: string,
): Promise<T> {
    if (!response.ok) {
        // Handle 401: trigger token modal
        if (response.status === 401) {
            useConfigStore.getState().clearAuthToken();
        }

        const contentType = response.headers.get('content-type');
        let responseBody: unknown;
        try {
            responseBody = contentType?.includes('application/json')
                ? await response.json()
                : await response.text();
        } catch {
            responseBody = undefined;
        }
        throw new HttpError(
            `HTTP ${response.status}: ${response.statusText}`,
            response.status,
            responseBody,
            url,
            method,
        );
    }

    try {
        const contentType = response.headers.get('content-type');
        return contentType?.includes('application/json')
            ? ((await response.json()) as T)
            : ((await response.text()) as T);
    } catch (error) {
        throw new NetworkError(
            `Failed to parse response: ${error instanceof Error ? error.message : String(error)}`,
            error,
            url,
            method,
        );
    }
}

/**
 * Build Authorization header from configStore
 */
function getAuthHeaders(): Record<string, string> {
    const token = useConfigStore.getState().authToken;
    if (!token) {
        throw new BusinessError('No auth token', 401, 'No auth token');
    }
    return { Authorization: `Bearer ${token}` };
}

/**
 * Execute request with retry support
 */
async function requestWithRetry<T>(
    requestFn: () => Promise<T>,
    options: Pick<RequestOptions, 'maxRetries' | 'retryDelay'>,
    attempt: number = 1,
): Promise<T> {
    try {
        return await requestFn();
    } catch (error) {
        const { maxRetries = DEFAULT_MAX_RETRIES, retryDelay = defaultRetryDelay } = options;

        if (attempt >= maxRetries || !isRetryableError(error)) {
            throw error;
        }

        const delay = retryDelay(attempt);
        await new Promise(resolve => setTimeout(resolve, delay));

        return requestWithRetry(requestFn, options, attempt + 1);
    }
}

/**
 * Prepare a single authenticated fetch call: merges auth headers, builds a timeout-controlled
 * signal (combined with any caller-supplied signal), and returns the ready fetch arguments plus
 * a cleanup function.
 *
 * Shared by {@link enhancedFetch} (parsed body) and {@link fetchWithAuth} (raw Response).
 */
function prepareAuthedFetch(
    url: string,
    options: { timeout?: number; signal?: AbortSignal | null } & RequestInit,
): { fullUrl: string; init: RequestInit; cleanup: () => void } {
    const { timeout = DEFAULT_TIMEOUT, signal, ...fetchOptions } = options;

    // Auto-attach Authorization header
    const authHeaders = getAuthHeaders();
    const mergedHeaders = {
        ...authHeaders,
        ...(fetchOptions.headers as Record<string, string> | undefined),
    };

    // Create timeout controller
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort(), timeout);

    // Merge signals: either cancellation triggers abort
    let finalSignal: AbortSignal = timeoutController.signal;
    if (signal) {
        const combinedController = new AbortController();
        const abort = () => combinedController.abort();
        signal.addEventListener('abort', abort);
        timeoutController.signal.addEventListener('abort', abort);
        finalSignal = combinedController.signal;
    }

    return {
        fullUrl: baseURL + url,
        init: { ...fetchOptions, headers: mergedHeaders, signal: finalSignal },
        cleanup: () => clearTimeout(timeoutId),
    };
}

/**
 * Enhanced fetch function
 *
 * Provides timeout control, auto-retry, unified error handling,
 * and automatic Authorization header attachment.
 *
 * @param url Request URL
 * @param options Request options (timeout, retry, etc.)
 * @returns Parsed response data
 * @throws {ApiError} Various API error types
 * @throws {BusinessError} When no auth token is configured
 */
export async function enhancedFetch<T>(
    url: string,
    options: RequestOptions = {},
): Promise<T> {
    const {
        retry = false,
        maxRetries = DEFAULT_MAX_RETRIES,
        retryDelay = defaultRetryDelay,
        ...rest
    } = options;

    const { fullUrl, init, cleanup } = prepareAuthedFetch(url, rest);

    // Request function
    const requestFn = async (): Promise<T> => {
        try {
            const response = await fetch(fullUrl, init);
            return await parseResponse<T>(response, url, options.method);
        } catch (error) {
            throw handleFetchError(error, url, options.method);
        } finally {
            cleanup();
        }
    };

    return retry
        ? requestWithRetry(requestFn, { maxRetries, retryDelay })
        : requestFn();
}

/**
 * Create a timeout-controlled AbortSignal
 */
export function createTimeoutSignal(timeout: number): {
    signal: AbortSignal;
    cleanup: () => void;
} {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
        controller.abort();
    }, timeout);

    return {
        signal: controller.signal,
        cleanup: () => {
            clearTimeout(timeoutId);
        },
    };
}

/**
 * Fetch with auth headers, returning raw Response (for SSE streams).
 * Does NOT parse the response body.
 *
 * @throws {BusinessError} When no auth token is configured
 * @throws {HttpError} When response is not ok
 */
export async function fetchWithAuth(
    url: string,
    options: RequestInit & { timeout?: number } = {},
): Promise<Response> {
    const { fullUrl, init, cleanup } = prepareAuthedFetch(url, options);

    try {
        const response = await fetch(fullUrl, init);

        if (!response.ok) {
            if (response.status === 401) {
                useConfigStore.getState().clearAuthToken();
            }
            throw new HttpError(
                `HTTP ${response.status}: ${response.statusText}`,
                response.status,
                undefined,
                url,
                options.method,
            );
        }

        return response;
    } catch (error) {
        throw handleFetchError(error, url, options.method);
    } finally {
        cleanup();
    }
}
