/**
 * API type definitions
 */

import type { Message } from '@my-copilot/shared';

/**
 * AI streaming response request parameters
 */
export interface StreamAIResponseParams {
    /** Session ID */
    sessionId: string;
    /** User prompt */
    prompt: string;
    /** Full conversation history for the LLM (optional) */
    messages?: Message[];
    /** Optional cancellation signal */
    signal?: AbortSignal;
}

/**
 * AI streaming response data
 */
export interface StreamAIResponseData {
    /** SSE stream for reading streaming data */
    stream: ReadableStream<Uint8Array>;
    /** Manually close the stream */
    close: () => void;
    /** Unique request identifier */
    requestId: string;
    /** Content type, fixed as 'text/event-stream' */
    contentType: 'text/event-stream';
    /** Estimated token count */
    tokenCount: number;
}
