import type {
  ProviderAdapter,
  ChatMessage,
  AdapterConfig,
  AdapterStreamOptions,
} from './base.js';
import { ProviderError } from './base.js';
import type { StreamEvent } from '@my-copilot/shared';

const CHAT_COMPLETIONS_PATH = '/v1/chat/completions';

interface OpenAIToolCallDelta {
  index: number;
  id?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

interface OpenAIStreamChunk {
  choices?: Array<{
    delta?: {
      content?: string;
      role?: string;
      tool_calls?: OpenAIToolCallDelta[];
    };
    finish_reason?: string | null;
  }>;
  error?: {
    message: string;
    type: string;
    code?: string;
  };
}

export class OpenAIAdapter implements ProviderAdapter {
  readonly type = 'openai' as const;

  async *chatCompletionStream(
    messages: ChatMessage[],
    config: AdapterConfig,
    options?: AdapterStreamOptions,
  ): AsyncGenerator<StreamEvent, void, unknown> {
    const url = buildUrl(config.baseUrl);

    const serializedMessages = messages.map(serializeMessage);

    const body: Record<string, unknown> = {
      model: config.model,
      messages: serializedMessages,
      stream: true,
    };

    if (options?.temperature !== undefined) body.temperature = options.temperature;
    if (options?.maxTokens !== undefined) body.max_tokens = options.maxTokens;
    if (options?.topP !== undefined) body.top_p = options.topP;
    if (options?.tools) body.tools = options.tools;
    if (options?.toolChoice) body.tool_choice = options.toolChoice;
    if (options?.parallelToolCalls !== undefined) {
      body.parallel_tool_calls = options.parallelToolCalls;
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (config.apiKey) {
      headers['Authorization'] = `Bearer ${config.apiKey}`;
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: options?.signal,
      });
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        // Stream was aborted — silently exit
        return;
      }
      throw new ProviderError(
        `Failed to connect to OpenAI API: ${err instanceof Error ? err.message : String(err)}`,
        502,
      );
    }

    if (!response.ok) {
      await handleErrorResponse(response);
    }

    if (!response.body) {
      throw new ProviderError('OpenAI response body is empty', 502);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    // Accumulate tool calls across SSE chunks, keyed by index.
    const pendingToolCalls = new Map<
      number,
      { id: string; name: string; arguments: string }
    >();
    const seenToolCallIndexes = new Set<number>();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        if (value) {
          buffer += decoder.decode(value, { stream: true });

          // Process complete SSE lines
          const lines = buffer.split('\n');
          // Keep the last (potentially incomplete) line in buffer
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('data:')) continue;

            const data = trimmed.slice(5).trim();
            if (data === '[DONE]') {
              return; // Stream complete
            }

            if (!data) continue;

            try {
              const chunk: OpenAIStreamChunk = JSON.parse(data);

              // Check for error in-stream
              if (chunk.error) {
                throw new ProviderError(
                  chunk.error.message || 'OpenAI stream error',
                  502,
                  chunk.error,
                );
              }

              const delta = chunk.choices?.[0]?.delta;
              if (delta) {
                const content = delta.content;
                if (content) {
                  yield { type: 'content', text: content };
                }

                const toolCallDeltas = delta.tool_calls;
                if (toolCallDeltas) {
                  for (const tc of toolCallDeltas) {
                    if (!seenToolCallIndexes.has(tc.index)) {
                      seenToolCallIndexes.add(tc.index);
                      yield { type: 'tool_call_start', index: tc.index };
                    }
                    const id = tc.id;
                    const name = tc.function?.name;
                    const argsDelta = tc.function?.arguments;
                    if (id || name || argsDelta !== undefined) {
                      yield {
                        type: 'tool_call_delta',
                        index: tc.index,
                        ...(id !== undefined ? { id } : {}),
                        ...(name !== undefined ? { name } : {}),
                        ...(argsDelta !== undefined ? { argumentsDelta: argsDelta } : {}),
                      };
                    }
                    // Accumulate into pending map
                    const pending = pendingToolCalls.get(tc.index) ?? {
                      id: '',
                      name: '',
                      arguments: '',
                    };
                    if (id) pending.id = id;
                    if (name) pending.name = name;
                    if (argsDelta) pending.arguments += argsDelta;
                    pendingToolCalls.set(tc.index, pending);
                  }
                }
              }

              const finishReason = chunk.choices?.[0]?.finish_reason;
              if (finishReason === 'tool_calls') {
                for (const [index, tc] of pendingToolCalls) {
                  yield {
                    type: 'tool_call_done',
                    index,
                    id: tc.id,
                    name: tc.name,
                    arguments: tc.arguments,
                  };
                }
                yield { type: 'finish', reason: 'tool_calls' };
                return;
              }
              if (finishReason === 'stop') {
                yield { type: 'finish', reason: 'stop' };
                return;
              }
              if (finishReason === 'length') {
                yield { type: 'finish', reason: 'length' };
                return;
              }
            } catch (err) {
              if (err instanceof ProviderError) throw err;
              // Skip unparseable chunks (could be comments or keepalives)
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}

/** Serialize a ChatMessage into the OpenAI request body shape (omits null/undefined fields). */
function serializeMessage(msg: ChatMessage): Record<string, unknown> {
  const base: Record<string, unknown> = { role: msg.role };
  if (msg.content !== null) base.content = msg.content;
  if (msg.toolCalls) base.tool_calls = msg.toolCalls;
  if (msg.toolCallId) base.tool_call_id = msg.toolCallId;
  if (msg.name) base.name = msg.name;
  return base;
}

function buildUrl(baseUrl: string): string {
  // Normalize: strip trailing slash, ensure /v1 path is not duplicated
  const normalized = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  // Check if baseUrl already includes /v1 to avoid double-prefixing
  if (normalized.endsWith('/v1')) {
    return `${normalized}/chat/completions`;
  }
  return `${normalized}${CHAT_COMPLETIONS_PATH}`;
}

async function handleErrorResponse(response: Response): Promise<never> {
  let message = `HTTP ${response.status}: ${response.statusText}`;

  try {
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const body: unknown = await response.json();
      const errorBody = body as { error?: { message?: string }; message?: string };
      const errorMsg = errorBody?.error?.message ?? errorBody?.message;
      if (errorMsg) message = errorMsg;
    } else {
      const text = await response.text();
      if (text) message = text;
    }
  } catch {
    // ignore body parsing errors
  }

  const statusCode =
    response.status >= 400 && response.status < 600 ? response.status : 502;

  // Map common OpenAI errors
  if (response.status === 401 || response.status === 403) {
    throw new ProviderError(`Authentication failed: ${message}`, statusCode);
  }
  if (response.status === 429) {
    throw new ProviderError(`Rate limited: ${message}`, statusCode);
  }

  throw new ProviderError(`OpenAI request failed: ${message}`, statusCode);
}
