import { createParser } from 'eventsource-parser';

export interface SSEStreamParams {
    stream: ReadableStream<Uint8Array>;
    signal?: AbortSignal;
    onPlaceholder: (msgId: string) => void;
    onDelta: (content: string) => void;
    onDone: (title: string) => void;
    onError: (message: string) => void;
    onAborted: () => void;
}

/**
 * Parse SSE stream from server with the new event format:
 *
 * event: placeholder
 * data: {"msgId":"msg-xxx"}
 *
 * event: delta
 * data: {"content":"Hello"}
 *
 * event: done
 * data: {"title":"New Session"}
 *
 * event: error
 * data: {"message":"API error"}
 *
 * event: aborted
 * data: {}
 */
export async function parseSSEStream({
    stream,
    signal,
    onPlaceholder,
    onDelta,
    onDone,
    onError,
    onAborted,
}: SSEStreamParams): Promise<void> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();

    let parserError: Error | null = null;

    const parser = createParser((event) => {
        if (event.type !== 'event') {
            return;
        }

        // Check for abort signal
        if (signal?.aborted) {
            return;
        }

        switch (event.event) {
            case 'placeholder': {
                try {
                    const data = JSON.parse(event.data || '{}');
                    if (data.msgId) {
                        onPlaceholder(data.msgId);
                    }
                } catch {
                    // Ignore parse errors
                }
                break;
            }
            case 'delta': {
                try {
                    const data = JSON.parse(event.data || '{}');
                    if (data.content) {
                        onDelta(data.content);
                    }
                } catch {
                    // Ignore parse errors
                }
                break;
            }
            case 'done': {
                try {
                    const data = JSON.parse(event.data || '{}');
                    onDone(data.title || '');
                } catch {
                    onDone('');
                }
                break;
            }
            case 'error': {
                try {
                    const data = JSON.parse(event.data || '{}');
                    onError(data.message || 'Stream error');
                } catch {
                    onError(event.data || 'Stream error');
                }
                parserError = new Error('SSE error event received');
                break;
            }
            case 'aborted': {
                onAborted();
                break;
            }
            default:
                break;
        }
    });

    try {
        while (true) {
            const { value, done } = await reader.read();

            if (done) {
                // Flush remaining decoder buffer
                const flushText = decoder.decode();
                if (flushText) {
                    parser.feed(flushText);
                }
                break;
            }

            if (value) {
                const chunkText = decoder.decode(value, { stream: true });
                parser.feed(chunkText);
            }

            if (parserError) {
                throw parserError;
            }
        }
    } catch (streamError) {
        if (signal?.aborted) {
            return;
        }
        if (parserError) {
            throw parserError;
        }
        throw streamError;
    } finally {
        try {
            reader.releaseLock();
        } catch {
            // Ignore close errors
        }
    }
}
