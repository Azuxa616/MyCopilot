import type {
  ProviderAdapter,
  ChatMessage,
  AdapterConfig,
  AdapterStreamOptions,
} from './base.js';
import { ProviderError } from './base.js';
import type { StreamEvent } from '@my-copilot/shared';

const OLLAMA_CHAT_PATH = '/api/chat';

interface OllamaStreamChunk {
  model?: string;
  message?: {
    role?: string;
    content?: string;
  };
  done?: boolean;
  error?: string;
}

export class OllamaAdapter implements ProviderAdapter {
  readonly type = 'ollama' as const;

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

    // Ollama uses 'options' object for generation params
    if (options?.temperature !== undefined || options?.maxTokens !== undefined || options?.topP !== undefined) {
      const ollamaOptions: Record<string, unknown> = {};
      if (options.temperature !== undefined) ollamaOptions.temperature = options.temperature;
      if (options.maxTokens !== undefined) ollamaOptions.num_predict = options.maxTokens;
      if (options.topP !== undefined) ollamaOptions.top_p = options.topP;
      body.options = ollamaOptions;
    }

    if (options?.tools) body.tools = options.tools;

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: options?.signal,
      });
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }
      throw new ProviderError(
        `Failed to connect to Ollama: ${err instanceof Error ? err.message : String(err)}`,
        502,
      );
    }

    if (!response.ok) {
      await handleErrorResponse(response);
    }

    if (!response.body) {
      throw new ProviderError('Ollama response body is empty', 502);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        if (value) {
          buffer += decoder.decode(value, { stream: true });

          // Process complete NDJSON lines
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            try {
              const chunk: OllamaStreamChunk = JSON.parse(trimmed);

              // Check for error
              if (chunk.error) {
                throw new ProviderError(`Ollama error: ${chunk.error}`, 502);
              }

              // Check if stream is done
              if (chunk.done) {
                yield { type: 'finish', reason: 'stop' };
                return;
              }

              const content = chunk.message?.content;
              if (content) {
                yield { type: 'content', text: content };
              }
            } catch (err) {
              if (err instanceof ProviderError) throw err;
              // Skip unparseable lines
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}

/** Serialize a ChatMessage into the Ollama request body shape (omits null/undefined fields). */
function serializeMessage(msg: ChatMessage): Record<string, unknown> {
  const base: Record<string, unknown> = { role: msg.role };
  if (msg.content !== null) base.content = msg.content;
  if (msg.toolCalls) base.tool_calls = msg.toolCalls;
  if (msg.toolCallId) base.tool_call_id = msg.toolCallId;
  if (msg.name) base.name = msg.name;
  return base;
}

function buildUrl(baseUrl: string): string {
  const normalized = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  return `${normalized}${OLLAMA_CHAT_PATH}`;
}

async function handleErrorResponse(response: Response): Promise<never> {
  let message = `HTTP ${response.status}: ${response.statusText}`;

  try {
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const body: unknown = await response.json();
      // Ollama error format: { "error": "model not found" }
      const errorBody = body as { error?: string; message?: string };
      const errorMsg = errorBody?.error ?? errorBody?.message;
      if (errorMsg) message = errorMsg;
    } else {
      const text = await response.text();
      if (text) message = text;
    }
  } catch {
    // ignore body parsing errors
  }

  throw new ProviderError(
    `Ollama request failed: ${message}`,
    response.status >= 400 && response.status < 600 ? response.status : 502,
  );
}
