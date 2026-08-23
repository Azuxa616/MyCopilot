/**
 * LLM Providers Extension Point - TypeScript 类型。
 *
 * 自包含模块：无 import。可用
 * `tsc --noEmit docs/rfc/types/extension-points/llm-providers.d.ts` 独立通过类型检查。
 *
 * 镜像 docs/rfc/schemas/extension-points/llm-providers.schema.json。
 *
 * 桥接目标：apps/server/src/llm/base.ts (ProviderAdapter)。
 */

/** host 识别的 provider 类型；开放尾允许新的 id。 */
export type LlmProviderType =
  | 'openai'
  | 'ollama'
  | (string & {});

/** OpenAI 兼容的 chat message 格式（镜像 base.ts 的 ChatMessage）。 */
export interface LlmChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  toolCalls?: unknown[];
  toolCallId?: string;
  name?: string;
}

/** 交给 adapter 的连接配置。 */
export interface LlmAdapterConfig {
  baseUrl: string;
  apiKey?: string;
  model: string;
}

/** 流式选项；镜像 base.ts 中的 AdapterStreamOptions。 */
export interface LlmAdapterStreamOptions {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  signal?: AbortSignal;
  tools?: unknown[];
  toolChoice?: 'auto' | 'none' | 'required';
  parallelToolCalls?: boolean;
}

/** 不透明的流事件 chunk；host 原样转发。 */
export type LlmStreamEvent =
  | { type: 'content'; text: string }
  | { type: 'tool_call_done'; id: string; name: string; arguments: string }
  | { type: 'finish'; reason: 'stop' | 'tool_calls' | 'length' };

/** 在连接/鉴权/解析失败时抛出的错误。 */
export interface LlmProviderError {
  statusCode: number;
  message: string;
  details?: unknown;
}

/**
 * 插件实现的 adapter 接口。与 apps/server/src/llm/base.ts 中的
 * `ProviderAdapter` 结构相同，因此 apps/server/src/agent-loop/runner.ts 中的
 * agent loop 原样消费插件 adapter。
 */
export interface LlmProviderAdapter {
  readonly type: LlmProviderType;
  chatCompletionStream(
    messages: LlmChatMessage[],
    config: LlmAdapterConfig,
    options?: LlmAdapterStreamOptions,
  ): AsyncGenerator<LlmStreamEvent, void, unknown>;
}

/** host 在注册时按 provider id 调用一次的 factory。 */
export interface LlmProviderFactory {
  /** 稳定的 id；外部以 `pluginId:providerId` 寻址。 */
  id: string;
  /** 在 provider 选择器中展示的可读 label。 */
  label: string;
  /** 从一行 config 构建 adapter。不得保留可变状态。 */
  create(config: LlmAdapterConfig): LlmProviderAdapter;
}

/** 预算；LLM 流本身受调用方 abort signal 约束。 */
export interface LlmProviderBudget {
  /** factory create() 调用的最大 ms 数。默认 1000。 */
  factoryTimeoutMs: number;
}

export declare const DEFAULT_LLM_PROVIDER_BUDGET: LlmProviderBudget;
