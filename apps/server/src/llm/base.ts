/**
 * Provider Adapter Interface
 *
 * Defines the contract for streaming chat completion adapters.
 * Each provider (OpenAI, Ollama, etc.) implements this interface
 * to normalize differences in API endpoints, request/response formats,
 * and error handling.
 */
import type { StreamEvent, ToolCall } from '@my-copilot/shared';

/** OpenAI-compatible chat message format (internal to server, not exported to shared) */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  /** null for assistant messages that only contain tool_calls (no textual content). */
  content: string | null;
  /** Assistant messages that requested tool calls. */
  toolCalls?: ToolCall[];
  /** Tool-role messages reference the parent tool call id. */
  toolCallId?: string;
  /** Function name for tool-role messages (OpenAI `name` field). */
  name?: string;
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

/** OpenAI-compatible tool definition for function calling. */
export interface JsonSchemaTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
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
  /** Tool definitions exposed to the model for function calling. */
  tools?: JsonSchemaTool[];
  /** Controls whether/when the model may invoke tools. */
  toolChoice?: 'auto' | 'none' | 'required';
  /** Allow the model to emit multiple tool calls in one turn. */
  parallelToolCalls?: boolean;
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
   * Yields structured StreamEvent chunks as they arrive from the upstream API.
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
  ): AsyncGenerator<StreamEvent, void, unknown>;
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
