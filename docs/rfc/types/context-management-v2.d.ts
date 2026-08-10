/**
 * Context Management v2 — TypeScript 类型。
 *
 * 自包含：不从 @my-copilot/shared 或任何其他模块导入。
 * 这些类型镜像 `docs/rfc/context-management-v2.schema.json` 以及
 * `docs/rfc/context-management-v2.md` 中描述的契约。它们是规范类型，
 * 不是运行时代码，因此不携带任何实现。
 *
 * 权威的 `RunContext` 形状由 Agent Loop v2 RFC 拥有；
 * 此处仅为上下文层所要求的受约束子集重新声明，以便本文件无外部导入。
 */

/** 五个功能桶加上预留的 headroom。 */
export type BudgetBucket =
  | 'system'
  | 'tools'
  | 'history'
  | 'toolOutputs'
  | 'working'
  | 'headroom';

/** 当一个桶超出其配额时 assembler 所做的动作。 */
export type OverBudgetStrategy = 'truncate' | 'summarize' | 'drop' | 'error';

/** history 桶调度策略的标识符。 */
export type StrategyName =
  | 'sliding-window'
  | 'sliding-window-summary'
  | 'head-tail-preserve'
  | 'anchor-preserve'
  | 'importance-preserve';

/** assembler 所面向的 provider 端缓存机制。 */
export type CacheControlType =
  | 'anthropic-ephemeral'
  | 'openai-implicit'
  | 'none';

/** 跨会话记忆行的类型。 */
export type MemoryKind = 'preference' | 'fact' | 'entity_relation';

/** 解析器统一处理的附件类型。 */
export type AttachmentKind =
  | 'text'
  | 'markdown'
  | 'csv'
  | 'docx'
  | 'pdf'
  | 'image'
  | 'code'
  | 'audio';

/** RunContext 携带的状态。 */
export type RunContextStatus = 'ok' | 'context_overflow';

/** 策略和组装后上下文使用的最小消息角色。 */
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

/**
 * 策略使用的最小消息形状。有意保持宽松，以便同一类型
 * 同时接受已持久化的 DB Message 和内部 ChatMessage。
 */
export interface MessageLike {
  role: MessageRole;
  content?: string | null;
  toolCallId?: string;
  /** 由 anchor-preserve 策略置顶的轮次为 true。 */
  anchor?: boolean;
  [key: string]: unknown;
}

/** 某个桶的已配置份额及其超预算行为。 */
export interface BudgetShare {
  bucket: BudgetBucket;
  /** 分配给该桶的模型上下文窗口比例（0..1）。 */
  share: number;
  overBudget: OverBudgetStrategy;
  /** 可选的 token 硬上限；当其更小时覆盖由份额推导出的值。 */
  maxTokens?: number;
}

/** 跨五个桶加 headroom 的单次运行预算分配。 */
export interface BudgetConfig {
  /** 本次运行所选模型的 token 上限。 */
  modelContextWindow: number;
  /** 恰好六个条目，每个桶一个。份额总和必须为 1.0。 */
  shares: BudgetShare[];
  /** 在降级级 3 应用的每工具结果截断上限。 */
  toolOutputMaxTokens?: number;
}

/** 组装后每个桶实际花费的 token 数。 */
export interface BudgetUsage {
  perBucket: Partial<Record<BudgetBucket, number>>;
  total: number;
}

/** 每个调度策略接受的输入契约。 */
export interface StrategyInput {
  /** history 桶的候选历史消息。 */
  messages: MessageLike[];
  historyQuotaTokens: number;
  /** 标记已汇总前缀的消息 id（若有）。 */
  latestSummaryBoundary?: string | null;
  /** token 估算器的名称（保留为字符串以使类型保持可序列化）。 */
  estimator: 'estimateMessagesTokens';
}

/** 每个调度策略产生的输出契约。 */
export interface StrategyOutput {
  kept: MessageLike[];
  dropped: number;
  summaryRequested: boolean;
}

/** 某次运行解析出的策略及其参数。 */
export interface StrategyConfig {
  active: StrategyName;
  /** 针对 head-tail-preserve：置顶多少条开头的用户轮次。 */
  headTailPreserveFirstN?: number;
  /** 针对 anchor-preserve 标记一条置顶轮次的元数据 key。 */
  anchorPreserveTag?: string;
  /** 针对 importance-preserve：保留多少条打分后的轮次。 */
  importanceTopK?: number;
}

/** 一个调度策略实现。 */
export interface ContextStrategy {
  name: StrategyName;
  select(input: StrategyInput): StrategyOutput;
}

/** 组装后消息中单个 cache_control 断点的位置。 */
export interface CacheBreakpoint {
  bucket: BudgetBucket;
  /** 在 RunContext.messages 中附加 cache_control 的索引位置。 */
  messageIndex: number;
}

/** 某次运行解析出的缓存配置。 */
export interface CacheControlConfig {
  provider: CacheControlType;
  maxBreakpoints?: number;
  breakpoints?: CacheBreakpoint[];
}

/** memories 表的一行。 */
export interface MemoryRecord {
  id: string;
  userId: string;
  kind: MemoryKind;
  content: string;
  /** content 引用到的实体名；非关系类型时为空。 */
  entities?: string[];
  sourceSessionId?: string | null;
  confidence?: number;
  createdAt: number;
  updatedAt: number;
}

/** 由 assembler 针对 memories 表发起的检索请求。 */
export interface MemoryQuery {
  userId: string;
  keywords: string[];
  kinds?: MemoryKind[];
  limit?: number;
}

/** 一次记忆检索过程的结果。 */
export interface MemoryRetrievalResult {
  matches: MemoryRecord[];
  /** 为注入的记忆消息在 system 桶内花费的 token 数。 */
  tokensUsed: number;
}

/** 交给预算层的统一附件载体。 */
export interface AttachmentEnvelope {
  kind: AttachmentKind;
  name: string;
  mimeType?: string;
  tokens: number;
  /** text/markdown/csv/docx/pdf/code/audio(转录文本) 的文本形态内容。 */
  content?: string;
  /** image 类型的 data: URL。 */
  imageDataUrl?: string;
  /** audio 类型的转录文本（同时镜像到 content）。 */
  transcript?: string;
  truncated?: boolean;
}

/** 附件解析器返回的 fail-soft 结果。 */
export interface AttachmentParseResult {
  success: boolean;
  envelope?: AttachmentEnvelope;
  error?: string;
}

/** 附加到 RunContext 的单次运行元数据。 */
export interface RunContextMeta {
  strategy: StrategyName;
  dropped: number;
  summaryUsed: boolean;
}

/**
 * 由 assembleMessages 返回、被 Agent Loop v2 消费的契约。
 *
 * 权威的完整形状由 Agent Loop v2 RFC 拥有；本声明只捕获
 * 上下文层被要求填充的子集，以使本文件无外部导入。
 */
export interface RunContext {
  messages: MessageLike[];
  tools: Record<string, unknown>[];
  cacheControl: CacheControlConfig;
  budget: BudgetUsage;
  status: RunContextStatus;
  meta: RunContextMeta;
}
