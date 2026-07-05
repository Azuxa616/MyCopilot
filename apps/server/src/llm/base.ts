/**
 * Provider Adapter Interface
 *
 * Defines the contract for streaming chat completion adapters.
 * Each provider (OpenAI, Ollama, etc.) implements this interface
 * to normalize differences in API endpoints, request/response formats,
 * and error handling.
 */

/** OpenAI-compatible chat message format (internal to server, not exported to shared) */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Adapter configuration */
export interface AdapterConfig {
  /** API base URL (without trailing slash) */
  baseUrl: string;
  /** API key (optional, Ollama doesn't use one) */
  apiKey?: string;
  /** Model name */
  model: string;
}

/** Streaming options */
export interface AdapterStreamOptions {
  /** Temperature (0-2) */
  temperature?: number;
  /** Maximum tokens to generate */
  maxTokens?: number;
  /** Top-p sampling */
  topP?: number;
  /** Abort signal for cancellation */
  signal?: AbortSignal;
}

/**
 * Provider adapter interface.
 *
 * Each implementation handles:
 * - Endpoint differences (OpenAI /v1/chat/completions vs Ollama /api/chat)
 * - Request body format differences
 * - Response stream parsing differences
 * - Error format differences
 */
export interface ProviderAdapter {
  /** Provider type identifier */
  readonly type: 'openai' | 'ollama';

  /**
   * Stream a chat completion from the provider.
   *
   * Yields content chunks as they arrive from the upstream API.
   * The caller is responsible for SSE encoding and client delivery.
   *
   * @param messages - Chat messages in OpenAI format (system + history)
   * @param config - Provider connection configuration
   * @param options - Generation parameters
   * @throws ProviderError on connection/auth failures
   */
  chatCompletionStream(
    messages: ChatMessage[],
    config: AdapterConfig,
    options?: AdapterStreamOptions,
  ): AsyncGenerator<string, void, unknown>;
}

/** Provider error with HTTP status code */
export class ProviderError extends Error {
  public statusCode: number;
  public details?: unknown;

  constructor(message: string, statusCode: number, details?: unknown) {
    super(message);
    this.name = 'ProviderError';
    this.statusCode = statusCode;
    this.details = details;
  }
}
