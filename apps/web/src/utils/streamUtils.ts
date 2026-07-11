import { createParser } from 'eventsource-parser';

export interface SSEStreamParams {
    stream: ReadableStream<Uint8Array>;
    signal?: AbortSignal;
    onPlaceholder: (msgId: string) => void;
    onDelta: (content: string) => void;
    onDone: (title: string) => void;
    onError: (message: string) => void;
    onAborted: () => void;
    // Phase 2 tool-call / job events — optional, no-op if not provided.
    onToolCallStart?: (msgId: string, index: number) => void;
    onToolCallDelta?: (
        msgId: string,
        index: number,
        id?: string,
        name?: string,
        argumentsDelta?: string,
    ) => void;
    onToolCallDone?: (
        msgId: string,
        index: number,
        id: string,
        name: string,
        args: string,
    ) => void;
    onToolResult?: (
        msgId: string,
        toolCallId: string,
        result: string,
        isError: boolean,
    ) => void;
    onConfirmationRequired?: (
        msgId: string,
        toolCallId: string,
        toolName: string,
        args: string,
        safetyLevel: string,
    ) => void;
    onJobStatus?: (jobId: string, status: string, progress?: number, error?: string) => void;
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
    onToolCallStart,
    onToolCallDelta,
    onToolCallDone,
    onToolResult,
    onConfirmationRequired,
    onJobStatus,
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
            case 'tool_call_start': {
                try {
                    const data = JSON.parse(event.data || '{}');
                    if (data.messageId !== undefined && data.index !== undefined) {
                        onToolCallStart?.(data.messageId, data.index);
                    }
                } catch {
                    // Ignore parse errors
                }
                break;
            }
            case 'tool_call_delta': {
                try {
                    const data = JSON.parse(event.data || '{}');
                    if (data.messageId !== undefined && data.index !== undefined) {
                        onToolCallDelta?.(
                            data.messageId,
                            data.index,
                            data.id,
                            data.name,
                            data.argumentsDelta,
                        );
                    }
                } catch {
                    // Ignore parse errors
                }
                break;
            }
            case 'tool_call_done': {
                try {
                    const data = JSON.parse(event.data || '{}');
                    if (
                        data.messageId !== undefined &&
                        data.index !== undefined &&
                        data.id !== undefined &&
                        data.name !== undefined &&
                        data.arguments !== undefined
                    ) {
                        onToolCallDone?.(
                            data.messageId,
                            data.index,
                            data.id,
                            data.name,
                            data.arguments,
                        );
                    }
                } catch {
                    // Ignore parse errors
                }
                break;
            }
            case 'tool_result': {
                try {
                    const data = JSON.parse(event.data || '{}');
                    if (
                        data.messageId !== undefined &&
                        data.toolCallId !== undefined &&
                        data.result !== undefined &&
                        data.isError !== undefined
                    ) {
                        onToolResult?.(
                            data.messageId,
                            data.toolCallId,
                            data.result,
                            data.isError,
                        );
                    }
                } catch {
                    // Ignore parse errors
                }
                break;
            }
            case 'confirmation_required': {
                try {
                    const data = JSON.parse(event.data || '{}');
                    if (
                        data.messageId !== undefined &&
                        data.toolCallId !== undefined &&
                        data.toolName !== undefined &&
                        data.arguments !== undefined &&
                        data.safetyLevel !== undefined
                    ) {
                        onConfirmationRequired?.(
                            data.messageId,
                            data.toolCallId,
                            data.toolName,
                            data.arguments,
                            data.safetyLevel,
                        );
                    }
                } catch {
                    // Ignore parse errors
                }
                break;
            }
            case 'job_status': {
                try {
                    const data = JSON.parse(event.data || '{}');
                    if (data.jobId !== undefined && data.status !== undefined) {
                        onJobStatus?.(data.jobId, data.status, data.progress, data.error);
                    }
                } catch {
                    // Ignore parse errors
                }
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
