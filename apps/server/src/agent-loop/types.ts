/**
 * Agent Loop 共享类型。
 *
 * 从 runner.ts 原样迁移：runAgentLoop / runAgentLoopAsJob 的参数、事件与
 * 结果契约。runner.ts 继续 re-export 这些类型，既有导入路径不变。
 */
import type {
  Message,
  MessagePart,
  StreamEvent,
  Tool,
  ToolApproval,
} from '@my-copilot/shared';
import type {
  AdapterConfig,
  ProviderAdapter,
} from '../llm/base.js';
import type { AttachmentText, SkillInjection } from '../prompt/assembler.js';

/** Possible terminal states for the agent loop. */
export type AgentLoopStatus =
  | 'completed'
  | 'length_limited'
  | 'max_iterations'
  | 'aborted'
  | 'error';

/** Result returned by runAgentLoop after termination. */
export interface AgentLoopResult {
  status: AgentLoopStatus;
  /**
   * Accumulated textual content from the final iteration (may be partial).
   * Non-complete terminals (max_iterations / length_limited) carry an
   * appended stop notice so the truncation is visible to the user.
   */
  content: string;
  /** Synthetic messages added to history (for caller inspection). */
  messages: Message[];
  /** Populated when status === 'error'. */
  error?: string;
  /** 原始错误对象（如 ProviderError）——stringify 丢失的 statusCode/errorCode 供消费方判定。 */
  cause?: unknown;
}

/** Events emitted by the agent loop via the onEvent callback. */
export type AgentLoopEvent =
  | { type: 'llm_event'; event: StreamEvent }
  | {
      type: 'tool_result';
      toolResult: { callId: string; result: string; isError: boolean };
    }
  | { type: 'tool_confirmation_required'; approval: ToolApproval }
  | { type: 'tool_confirmation_settled'; approval: ToolApproval }
  | { type: 'agent_loop_end'; endReason: AgentLoopStatus };

/** Callback signature for `onEvent`. May be sync or async. */
export type AgentLoopEventCallback = (
  event: AgentLoopEvent,
) => void | Promise<void>;

/** Parameters for runAgentLoop. */
export interface RunAgentLoopParams {
  sessionId: string;
  agentId?: string;
  jobId?: string;
  runId?: string;
  /** The placeholder assistant message ID (for persisting streamed content). */
  userMessageId: string;
  /** Message history (mutated in-place with synthetic tool messages). */
  history: Message[];
  /** The user's message text. */
  userContent: string;
  attachments?: AttachmentText[];
  /** 当前轮用户消息的多模态 parts（图片；经 assembler 解析为 wire images）。 */
  currentUserParts?: MessagePart[];
  skills?: SkillInjection[];
  /**
   * `@会话` 引用（input-commands 设计）：本轮用户点名的会话 id 列表。
   * 携带时 runner 完成单点接线：摘要注入块拼入最终 user 消息前缀
   * （assembler 的 referencedSessions），并把 read_session 追加进本轮
   * 广告工具目录；缺省/为空时零行为变化。
   */
  referencedSessionIds?: string[];
  /** Enabled tools to advertise to the LLM. */
  tools: Tool[];
  adapter: ProviderAdapter;
  adapterConfig: AdapterConfig;
  /** AbortSignal for cancellation (read from registry's getStreamSignal). */
  abortSignal: AbortSignal;
  /**
   * Callback invoked for every event during the agent loop.
   * This is the sole mechanism for the caller (lifecycle) to write SSE events.
   * The runner awaits the callback to ensure SSE writes complete in order.
   */
  onEvent: AgentLoopEventCallback;
  /**
   * Maximum iterations override.
   * Defaults to AGENT_MAX_ITERATIONS env var or 10.
   */
  maxIterations?: number;
}

/**
 * Context payload needed to resume an agent loop inside a background job.
 *
 * Mirrors {@link RunAgentLoopParams} minus the runtime bits (`abortSignal`,
 * `onEvent`) which are provided by {@link runAgentLoopAsJob}. Includes
 * `userMessageId` because the placeholder assistant message is created by
 * the HTTP handler before the job is enqueued, and the runner needs it to
 * persist streamed content.
 */
export interface AgentLoopJobContext {
  sessionId: string;
  agentId?: string;
  /** Placeholder assistant message ID (created by the HTTP handler). */
  userMessageId: string;
  /** 学习闭环：最终生效模型（streamMessageHandler 写入）。 */
  modelId?: string;
  history: Message[];
  userContent: string;
  attachments?: AttachmentText[];
  /** 当前轮用户消息的多模态 parts（图片）。 */
  currentUserParts?: MessagePart[];
  skills?: SkillInjection[];
  /** `@会话` 引用携带的目标会话 id（透传 {@link runAgentLoop}）。 */
  referencedSessionIds?: string[];
  tools: Tool[];
  adapter: ProviderAdapter;
  adapterConfig: AdapterConfig;
}
