/**
 * Agent Loop Runner (v2)
 *
 * Agent Loop v2 的编排核心：迭代「Context v2 装配 → LLM 流式调用 → 工具执行」
 * 直到模型给出终止信号、触发循环防护或被用户中断。
 *
 * 对应 RFC《Agent Loop v2》（docs/rfc/agent-loop-v2.md）：
 * - §1 Run 生命周期状态机：RunStateMachine 跟踪 queued → in_progress →
 *   requires_action → 终态；SSE 事件映射由 lifecycle（T14）完成，runner 只驱动转移。
 * - §3 Extended Thinking：reasoning 增量事件原样透传（llm_event），不计入回复内容。
 * - §5 LoopGuard v2：步前统一评估 user_interrupt > max_steps > max_tokens，
 *   并承担重复工具调用检测（digest 含工具名）。
 * - §6 stop_reason 路由表：finishReason → StopReason → routeStopReason 决定下一步。
 *
 * 上下文装配切换到 Context v2（T7 assembleMessagesV2，对应 RFC
 * 《Context Management v2》）：五桶预算、多策略调度、Memory 注入与降级链
 * 全部在装配函数内部完成，runner 只消费 RunContext{messages,budget,degraded}。
 *
 * DECOUPLED FROM SSE: All StreamEvent delivery to the outside world happens
 * through the `onEvent` callback. The runner never touches a stream object.
 * This makes it usable from a request-bound SSE handler today and from a
 * background job in Step B without changes.
 */
import { randomUUID } from 'node:crypto';
import type {
  BudgetBreakdown,
  Job,
  Message,
  RunStatus,
  RunStepRecord,
  StopReason,
  StreamEvent,
  Tool,
  ToolApproval,
  ToolCall,
  TraceCollector,
} from '@my-copilot/shared';
import type {
  ChatMessage,
  AdapterConfig,
  ProviderAdapter,
  JsonSchemaTool,
} from '../llm/base.js';
import type { AttachmentText, SkillInjection } from '../prompt/assembler.js';
import { assembleMessagesV2 } from '../prompt/assembler.js';
import { estimateMessagesTokens } from '../prompt/token-counter.js';
import { summarizeHistory } from '../prompt/summarizer.js';
import { createMessage, updateMessage } from '../repo/message.js';
import { createSummary, getLatestSummary } from '../repo/summary.js';
import { executeToolCall } from '../tools/executor.js';
import { toolInputSchemaToJsonSchema } from '../utils/schema-adapter.js';
import {
  resumeJobAfterConfirmation,
  setJobWaitingForConfirmation,
} from '../repo/job.js';
import { RunStateMachine } from './run-state.js';
import { createLoopGuard, digestToolCall } from './loop-guard.js';
import { extractReasoning, routeStopReason } from './stop-router.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
  /** Accumulated textual content from the final iteration (may be partial). */
  content: string;
  /** Synthetic messages added to history (for caller inspection). */
  messages: Message[];
  /** Populated when status === 'error'. */
  error?: string;
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
  skills?: SkillInjection[];
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
  /**
   * 可选轨迹采集器（旁路观察者，DECOUPLED 同 onEvent）：runner 只上报
   * run 开始 / 每步 / 终态，不感知落库；采集异常被吞掉，绝不影响循环。
   */
  trace?: TraceCollector;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MAX_ITERATIONS = 10;

/**
 * Token threshold above which the agent loop lazily summarizes history (T25).
 * Overridable via the `CONTEXT_SUMMARIZE_THRESHOLD` env var. Set to 0 to
 * disable summarization entirely.
 */
const DEFAULT_SUMMARY_THRESHOLD = 30_000;

/**
 * Minimum number of not-yet-summarized messages required before invoking the
 * summarizer. Avoids re-summarizing on every iteration after a summary is
 * first created.
 */
const MIN_MESSAGES_TO_SUMMARIZE = 5;

/**
 * finish reason → StopReason 映射（RFC §6 路由表键）。
 * adapter 流式事件的 finish.reason 归一到 StopReason 后再查询路由表。
 */
const STOP_REASON_BY_FINISH: Readonly<
  Record<'stop' | 'tool_calls' | 'length', StopReason>
> = {
  stop: 'end_turn',
  tool_calls: 'tool_use',
  length: 'max_tokens',
};

/** Resolve max iterations from params → env → default. */
function resolveMaxIterations(override?: number): number {
  if (override !== undefined) return override;
  const env = Number.parseInt(process.env.AGENT_MAX_ITERATIONS ?? '', 10);
  return Number.isFinite(env) && env > 0 ? env : DEFAULT_MAX_ITERATIONS;
}

/**
 * AgentLoopStatus → runs 终态（RunStatus CHECK 域）+ StopReason 的映射表，
 * 供 trace 采集旁路使用（RFC §1 状态机映射的观察者视角）。
 */
const TRACE_TERMINAL_BY_STATUS: Readonly<
  Record<AgentLoopStatus, { status: RunStatus; stopReason: StopReason }>
> = {
  completed: { status: 'completed', stopReason: 'end_turn' },
  length_limited: { status: 'incomplete', stopReason: 'max_tokens' },
  max_iterations: { status: 'incomplete', stopReason: 'max_steps' },
  aborted: { status: 'cancelled', stopReason: 'user_interrupt' },
  error: { status: 'failed', stopReason: 'error' },
};

/**
 * 执行一次采集回调并吞掉异常：trace 是旁路观察者，采集器故障只允许
 * 降级为 console.warn，绝不中断 agent loop 主流程。
 */
function emitTrace(call: () => void): void {
  try {
    call();
  } catch (err) {
    console.warn(
      '[runner] trace collector error:',
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * Lazy history summarization (T25).
 *
 * If the current history exceeds the configured token threshold, generate a
 * summary of the not-yet-summarized tail and persist it. Self-limiting: after
 * a summary is created, subsequent iterations see a large
 * `summarizedUpToMessageId` offset and skip until the tail grows past
 * {@link MIN_MESSAGES_TO_SUMMARIZE} again.
 *
 * Context v2 定位：惰性摘要是 assembleMessagesV2 降级链的补充而非替代——
 * 前者跨迭代持久化摘要（repo/summary），后者在单次装配内兜底压缩。
 *
 * Fail-soft: the summarizer itself never throws, and we swallow any unexpected
 * error here so the agent loop always continues (falling back to plain
 * truncation). No abort signal is forwarded — the summarizer uses its own
 * 30s timeout so a stuck LLM call cannot block the loop indefinitely, and the
 * persisted summary remains useful even if the current request is cancelled.
 */
async function maybeSummarizeHistory(params: {
  sessionId: string;
  history: Message[];
  adapter: ProviderAdapter;
  adapterConfig: AdapterConfig;
}): Promise<void> {
  const { sessionId, history, adapter, adapterConfig } = params;

  const threshold =
    Number.parseInt(process.env.CONTEXT_SUMMARIZE_THRESHOLD ?? '', 10) ||
    DEFAULT_SUMMARY_THRESHOLD;
  if (threshold <= 0) return; // explicitly disabled

  if (history.length === 0) return;

  const historyTokens = estimateMessagesTokens(history);
  if (historyTokens <= threshold) return;

  // Locate the not-yet-summarized tail using the persisted boundary marker.
  const latest = getLatestSummary(sessionId);
  let startIndex = 0;
  if (latest) {
    const idx = history.findIndex(
      (m) => m.id === latest.summarizedUpToMessageId,
    );
    if (idx >= 0) startIndex = idx + 1;
  }
  const unsummarized = history.slice(startIndex);
  if (unsummarized.length < MIN_MESSAGES_TO_SUMMARIZE) return;

  // Only user + assistant prose is meaningful input for a conversation summary.
  const messagesForSummary: ChatMessage[] = unsummarized
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .filter((m) => m.content.trim().length > 0)
    .map(
      (m): ChatMessage => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }),
    );
  if (messagesForSummary.length === 0) return;

  const lastMessage = unsummarized[unsummarized.length - 1]!;
  try {
    const result = await summarizeHistory({
      messages: messagesForSummary,
      adapter,
      adapterConfig,
    });
    if (result) {
      createSummary({
        sessionId,
        summary: result.summary,
        summarizedUpToMessageId: lastMessage.id,
        tokenCount: result.tokenCount,
      });
    }
  } catch (err) {
    // Defensive: summarizeHistory already swallows errors, but we guard again
    // here so a future code change can never break the agent loop.
    console.warn('[runner] Lazy summarization failed:', err);
  }
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

/**
 * Run the agent loop (v2): Context 装配 → LLM call → consume stream → maybe
 * execute tools → repeat.
 *
 * Termination conditions（旧外部状态名保留，Run 状态机映射见括号）:
 *   - `finish.reason === 'stop'`           → status 'completed'   (Run completed)
 *   - `finish.reason === 'length'`         → status 'length_limited' (Run incomplete)
 *   - 步数上限（LoopGuard max_steps）      → status 'max_iterations' (Run incomplete)
 *   - token 预算（LoopGuard max_tokens）   → status 'max_iterations' (Run incomplete)
 *   - abortSignal.aborted                  → status 'aborted'     (Run cancelled)
 *   - unexpected exception                 → status 'error'       (Run failed)
 *
 * Side effects per round:
 *   - Forwards every StreamEvent via onEvent({ type: 'llm_event', event })
 *     （含 Extended Thinking 的 reasoning 事件，RFC §3）
 *   - Persists assistant message (with toolCalls) to DB on tool-call rounds
 *   - Persists each tool result to DB as role='tool' message
 *   - Pushes synthetic assistant + tool messages onto `history` so the next
 *     iteration's `assembleMessagesV2` sees them
 */
export async function runAgentLoop(
  params: RunAgentLoopParams,
): Promise<AgentLoopResult> {
  const {
    sessionId,
    agentId = 'default',
    jobId,
    userMessageId,
    runId = userMessageId,
    history,
    userContent,
    attachments,
    skills,
    tools,
    adapter,
    adapterConfig,
    abortSignal,
    onEvent,
    trace,
  } = params;

  // Run 生命周期状态机（RFC §1）：内存态跟踪，SSE 事件映射由 lifecycle（T14）
  // 完成，这里只负责在终止/确认路径上驱动合法转移。
  const runState = new RunStateMachine(runId);
  runState.transition('start'); // queued → in_progress

  // Trace 采集（旁路观察者）：真实 userMessageId 由采集器构造方注入
  // （RunAgentLoopParams.userMessageId 是 assistant 占位 id，语义澄清见
  // todo 3 计划——不得落入 runs.user_message_id）；此处只上报 runner
  // 语境的标识字段与生命周期。
  if (trace) {
    emitTrace(() => {
      trace.onRunStart({
        sessionId,
        assistantMessageId: userMessageId,
        agentId,
        jobId,
        status: 'in_progress',
      });
    });
  }

  // Trace 终态/步骤的累积上下文（无 trace 时零开销地保持未用）。
  let iterations = 0;
  let lastBudget: BudgetBreakdown | null = null;
  let lastDegraded = false;
  let lastTokenEstimate = 0;
  let traceSeq = 0;

  const recordStep = (
    step: Omit<RunStepRecord, 'id' | 'runId' | 'seq' | 'createdAt'>,
  ): void => {
    if (!trace) return;
    traceSeq += 1;
    const record: RunStepRecord = {
      id: randomUUID(),
      runId,
      seq: traceSeq,
      createdAt: new Date().toISOString(),
      ...step,
    };
    emitTrace(() => trace.onStep(record));
  };

  const endTrace = (
    status: AgentLoopStatus,
    overrides?: { stopReason?: StopReason; error?: string },
  ): void => {
    if (!trace) return;
    const terminal = TRACE_TERMINAL_BY_STATUS[status];
    emitTrace(() => {
      trace.onRunEnd({
        status: terminal.status,
        stopReason: overrides?.stopReason ?? terminal.stopReason,
        iterations,
        budgetSnapshot: lastBudget,
        degraded: lastDegraded,
        totalTokens: lastTokenEstimate,
        endedAt: new Date().toISOString(),
        error: overrides?.error ?? null,
      });
    });
  };

  // LoopGuard v2（RFC §5）：maxSteps 由 resolveMaxIterations 解析
  // （params.maxIterations → AGENT_MAX_ITERATIONS env → 默认 10，
  // 与 DEFAULT_LOOP_GUARD_CONFIG.maxSteps 的默认约定一致）。
  const guard = createLoopGuard({
    maxSteps: resolveMaxIterations(params.maxIterations),
  });

  let lastIterationContent = '';
  const addedMessages: Message[] = [];
  const toolsByName = new Map(tools.map((tool) => [tool.name, tool]));

  // 已尝试工具调用 digest 的镜像集合：LoopGuard 内部由 markAttempted 维护，
  // 此处同步记录以填充 check() 的 attemptedDigests 快照（当前 runtime 侧
  // 配置无 maxRepeatCalls，check() 不基于该集合触发停止，仅作输入约定）。
  const attemptedDigests = new Set<string>();

  // Convert Tool[] to JsonSchemaTool[] for LLM adapter
  const jsonTools: JsonSchemaTool[] = tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: toolInputSchemaToJsonSchema(t.inputSchema),
    },
  }));

  try {
    while (iterations < guard.config.maxSteps) {
      // Per-iteration content accumulator. Reset every iteration so the
      // placeholder message and persisted assistant messages contain only
      // the current round's text — NOT a cross-iteration concatenation.
      // (Previously this lived outside the while, which produced
      // "好的，我来调用一下…好的，我再调用一次…" 5x repetitions on every
      // tool-call round because each round's full text was appended.)
      let iterationContent = '';

      // 1. LoopGuard v2 步前检查（RFC §5 → §6）：优先级
      //    user_interrupt > max_steps > max_tokens。user_interrupt 同时承担了
      //    v1 的循环顶 abortSignal.aborted 检查；max_steps 因 while 条件已用
      //    guard.config.maxSteps 封顶而由循环底部常规路径兜底。
      const historyTokens = estimateMessagesTokens(history);
      const guardDecision = guard.check({
        iterations,
        historyTokens,
        abortSignal,
        attemptedDigests,
      });
      lastTokenEstimate = historyTokens;
      if (guardDecision.stop && guardDecision.reason !== undefined) {
        const action = routeStopReason(guardDecision.reason);
        if (action === 'terminate_cancelled') {
          // user_interrupt（RFC §6）：Run → cancelled，外部 status 'aborted'。
          updateMessage(userMessageId, {
            content: lastIterationContent,
            status: 'aborted',
          });
          runState.transition('abort');
          endTrace('aborted');
          await safeEmit(onEvent, { type: 'agent_loop_end', endReason: 'aborted' });
          return {
            status: 'aborted',
            content: lastIterationContent,
            messages: addedMessages,
          };
        }
        // max_steps（terminate_incomplete）与 max_tokens（compress_context）：
        // Context v2（assembleMessagesV2）内部已实现压缩降级链，此处不再
        // 二次压缩、直接终止；两种 StopReason 都映射到旧外部状态
        // 'max_iterations'（Run → incomplete）。
        updateMessage(userMessageId, {
          content: lastIterationContent,
          status: 'sent',
        });
        runState.transition('max_steps');
        endTrace('max_iterations', { stopReason: guardDecision.reason });
        await safeEmit(onEvent, {
          type: 'agent_loop_end',
          endReason: 'max_iterations',
        });
        return {
          status: 'max_iterations',
          content: lastIterationContent,
          messages: addedMessages,
        };
      }

      // 1b. Lazy summarization — compact long histories before assembling the
      //     prompt. No-op when under the token threshold; fail-soft otherwise.
      //     （Context v2 的补充而非替代，逻辑保持 v1 原样。）
      await maybeSummarizeHistory({ sessionId, history, adapter, adapterConfig });

      iterations++;

      // 2. Context v2 装配（T7，RFC《Context Management v2》）：五桶预算、
      //    多策略调度、Memory 注入与超预算降级链全部在 assembleMessagesV2
      //    内部完成，runner 只消费 RunContext{messages, budget, degraded}。
      const runContext = await assembleMessagesV2({
        history,
        userContent,
        attachments,
        skills,
        sessionId,
        adapter,
        adapterConfig,
        strategy: 'sliding_window',
      });
      lastBudget = runContext.budget;
      lastDegraded = runContext.degraded;
      if (runContext.degraded) {
        // 仅在降级时输出一条中文 debug（预算与降级状态），正常路径零噪音。
        console.debug(
          `[runner] Context v2 装配处于降级模式（degraded）：history 桶预算 ` +
            `${runContext.budget.history} / total ${runContext.budget.total} ` +
            `tokens，降级链已在装配内部完成压缩。`,
        );
      }
      // RunChatMessage 与 ChatMessage 字段一一兼容（role/content 为
      // string|null/toolCalls/toolCallId），做一次直通转换以贴合 adapter
      // 层的入参类型；不改变任何字段值。
      const chatMessages: ChatMessage[] = runContext.messages.map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.toolCalls ? { toolCalls: m.toolCalls } : {}),
        ...(m.toolCallId ? { toolCallId: m.toolCallId } : {}),
      }));

      // 3. Open the LLM stream.
      const llmCallStartedAt = Date.now();
      const generator = adapter.chatCompletionStream(chatMessages, adapterConfig, {
        tools: jsonTools.length > 0 ? jsonTools : undefined,
        toolChoice: 'auto',
        parallelToolCalls: true,
        signal: abortSignal,
      });

      // 4. Consume the stream, collecting tool calls + finish reason.
      const toolCalls: ToolCall[] = [];
      let finishReason: 'stop' | 'tool_calls' | 'length' | null = null;

      for await (const event of generator) {
        // Extended Thinking（RFC §3）：reasoning 增量经 extractReasoning 识别
        // 后照常以 llm_event 透传（SSE wire 映射由 lifecycle/T14 完成），
        // 但不计入 iterationContent —— 推理文本不是用户可见的回复内容。
        const reasoningText = extractReasoning(event);
        if (reasoningText !== null) {
          await onEvent({ type: 'llm_event', event });
          continue;
        }

        // Forward every event to the caller.
        await onEvent({ type: 'llm_event', event });

        if (event.type === 'content') {
          iterationContent += event.text;
        } else if (event.type === 'tool_call_done') {
          toolCalls.push({
            id: event.id,
            name: event.name,
            arguments: event.arguments,
          });
        } else if (event.type === 'finish') {
          finishReason = event.reason;
        }
      }

      // llm_call 轨迹步骤：耗时 + 该轮 history token 估算（guard.check 的
      // 输入值；budget 维度的分配快照由 run 级 budgetSnapshot 承担）。
      recordStep({
        type: 'llm_call',
        toolName: null,
        argsPreview: null,
        resultPreview: `~${historyTokens} tokens`,
        isError: false,
        durationMs: Date.now() - llmCallStartedAt,
      });

      // Remember this iteration's content for terminal / fallback paths
      // outside the loop (max_iterations, exception handler).
      lastIterationContent = iterationContent;

      // 5. Check abort after LLM stream consumed.
      if (abortSignal.aborted) {
        updateMessage(userMessageId, { content: iterationContent, status: 'aborted' });
        runState.transition('abort');
        endTrace('aborted');
        await safeEmit(onEvent, { type: 'agent_loop_end', endReason: 'aborted' });
        return { status: 'aborted', content: iterationContent, messages: addedMessages };
      }

      // 6. finish 路由（RFC §6）：finishReason → StopReason（STOP_REASON_BY_FINISH）
      //    → routeStopReason 决定下一步：
      //    - 'stop'→end_turn→terminate_completed：终止，status 'completed'
      //    - 'length'→max_tokens→compress_context：Context v2 装配内部已完成
      //      压缩降级链，此处直接终止并保持 v1 外部行为 'length_limited'
      if (finishReason === 'stop' || finishReason === 'length') {
        updateMessage(userMessageId, { content: iterationContent, status: 'sent' });
        const action = routeStopReason(STOP_REASON_BY_FINISH[finishReason]);
        let status: AgentLoopStatus;
        if (action === 'terminate_completed') {
          runState.transition('stop'); // in_progress → completed
          status = 'completed';
        } else {
          runState.transition('max_steps'); // in_progress → incomplete
          status = 'length_limited';
        }
        endTrace(status);
        await safeEmit(onEvent, { type: 'agent_loop_end', endReason: status });
        return { status, content: iterationContent, messages: addedMessages };
      }

      // 7. No tool calls and no explicit finish — treat as complete to avoid
      //    looping forever on a degenerate adapter response.
      //    （finish 缺失时无从查询路由表，按 end_turn 语义收尾。）
      if (toolCalls.length === 0) {
        updateMessage(userMessageId, { content: iterationContent, status: 'sent' });
        runState.transition('stop');
        endTrace('completed');
        await safeEmit(onEvent, { type: 'agent_loop_end', endReason: 'completed' });
        return { status: 'completed', content: iterationContent, messages: addedMessages };
      }

      // finishReason === 'tool_calls' → StopReason 'tool_use' →
      // routeStopReason === 'continue'：进入工具执行路径（下方）。

      // 8. Persist the assistant message that requested tool calls (once per
      //    round, NOT once per tool call) and add it to history.
      createMessage({
        sessionId,
        role: 'assistant',
        content: iterationContent,
        toolCalls,
        status: 'sent',
      });

      const assistantMsg: Message = {
        id: `syn-assistant-${iterations}-${Date.now().toString(36)}`,
        sessionId,
        role: 'assistant',
        content: iterationContent,
        toolCalls,
        status: 'sent',
        createdAt: Date.now(),
        attachments: [],
      };
      history.push(assistantMsg);
      addedMessages.push(assistantMsg);

      // 9. 重复调用检测（RFC §5，LoopGuard v2）：digest 切换到含工具名的
      //    loop-guard digestToolCall（修复 v1 digestToolCallArguments 不含
      //    工具名、不同工具同参数被误杀的 bug）。markAttempted 返回 false
      //    （本 Run 内已尝试过）→ 进 skipped 名单，合成 "already attempted"
      //    结果让 LLM 看到显式停止信号，而不是把原失败无限重试到步数上限。
      const pendingToolCalls: ToolCall[] = [];
      const skippedToolCalls: ToolCall[] = [];
      for (const tc of toolCalls) {
        if (guard.markAttempted(tc.name, tc.arguments)) {
          pendingToolCalls.push(tc);
          // 镜像 guard 内部集合，供下一轮 check() 的 attemptedDigests 快照。
          attemptedDigests.add(digestToolCall(tc.name, tc.arguments));
        } else {
          skippedToolCalls.push(tc);
        }
      }

      // 10. Execute non-skipped tool calls in parallel. 确认流回调内同步驱动
      //     Run 状态机（RFC §1：in_progress ↔ requires_action）；并行工具可能
      //     连续触发确认，已处于目标状态时跳过重复转移以免非法转移抛错。
      //     tool_exec 轨迹步骤在 per-tool 包装内独立计时（并行执行下各自
      //     的 durationMs 才是真实耗时，串行累加会虚增）。
      const toolResults = await Promise.all(
        pendingToolCalls.map(async (tc) => {
          const toolStartedAt = Date.now();
          try {
            const result = await executeToolCall(tc, {
              sessionId,
              agentId,
              jobId,
              runId,
              signal: abortSignal,
              advertisedTool: toolsByName.get(tc.name),
              onConfirmationRequired: (approval) => {
                if (runState.getStatus() === 'in_progress') {
                  runState.transition('await_confirmation');
                }
                onEvent({ type: 'tool_confirmation_required', approval });
              },
              onConfirmationSettled: (approval) => {
                if (runState.getStatus() === 'requires_action') {
                  runState.transition('confirmation_granted');
                }
                onEvent({ type: 'tool_confirmation_settled', approval });
              },
            });
            recordStep({
              type: 'tool_exec',
              toolName: tc.name,
              argsPreview: tc.arguments,
              resultPreview: JSON.stringify(result.content),
              isError: result.isError ?? false,
              durationMs: Date.now() - toolStartedAt,
            });
            return result;
          } catch (err) {
            recordStep({
              type: 'tool_exec',
              toolName: tc.name,
              argsPreview: tc.arguments,
              resultPreview: err instanceof Error ? err.message : String(err),
              isError: true,
              durationMs: Date.now() - toolStartedAt,
            });
            throw err;
          }
        }),
      );

      // 11. Persist each executed tool result, push to history, notify caller.
      for (let i = 0; i < pendingToolCalls.length; i++) {
        const tc = pendingToolCalls[i]!;
        const result = toolResults[i]!;
        const resultJson = JSON.stringify(result.content);

        createMessage({
          sessionId,
          role: 'tool',
          content: resultJson,
          toolCallId: tc.id,
          status: 'sent',
        });

        const toolMsg: Message = {
          id: `syn-tool-${tc.id}`,
          sessionId,
          role: 'tool',
          content: resultJson,
          toolCallId: tc.id,
          status: 'sent',
          createdAt: Date.now(),
          attachments: [],
        };
        history.push(toolMsg);
        addedMessages.push(toolMsg);

        await onEvent({
          type: 'tool_result',
          toolResult: {
            callId: tc.id,
            result: resultJson,
            isError: result.isError ?? false,
          },
        });
      }

      // 12. Persist synthetic "skipped" results for deduped tool calls so
      //     the LLM receives an explicit signal instead of retrying blindly.
      for (const tc of skippedToolCalls) {
        const skippedContent = [
          {
            type: 'text' as const,
            text: 'Tool execution skipped: a tool call with identical arguments was already attempted in this run. Do not retry the same arguments; choose different arguments or stop.',
          },
        ];
        const resultJson = JSON.stringify(skippedContent);

        recordStep({
          type: 'tool_exec',
          toolName: tc.name,
          argsPreview: tc.arguments,
          resultPreview: resultJson,
          isError: true,
          durationMs: 0,
        });

        createMessage({
          sessionId,
          role: 'tool',
          content: resultJson,
          toolCallId: tc.id,
          status: 'sent',
        });

        const toolMsg: Message = {
          id: `syn-tool-skip-${tc.id}`,
          sessionId,
          role: 'tool',
          content: resultJson,
          toolCallId: tc.id,
          status: 'sent',
          createdAt: Date.now(),
          attachments: [],
        };
        history.push(toolMsg);
        addedMessages.push(toolMsg);

        await onEvent({
          type: 'tool_result',
          toolResult: {
            callId: tc.id,
            result: resultJson,
            isError: true,
          },
        });
      }

      // 13. Re-check abort after (potentially slow) tool execution.
      if (abortSignal.aborted) {
        updateMessage(userMessageId, { content: iterationContent, status: 'aborted' });
        runState.transition('abort');
        endTrace('aborted');
        await safeEmit(onEvent, { type: 'agent_loop_end', endReason: 'aborted' });
        return { status: 'aborted', content: iterationContent, messages: addedMessages };
      }
    }

    // 14. 步数上限耗尽（guard.config.maxSteps）：对应 LoopGuard 的 max_steps
    //     语义（RFC §5/§6 terminate_incomplete），映射旧外部状态
    //     'max_iterations'（Run → incomplete）。
    updateMessage(userMessageId, { content: lastIterationContent, status: 'sent' });
    runState.transition('max_steps');
    endTrace('max_iterations');
    await safeEmit(onEvent, { type: 'agent_loop_end', endReason: 'max_iterations' });
    return { status: 'max_iterations', content: lastIterationContent, messages: addedMessages };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    // Distinguish abort-driven exceptions from real errors.
    if (abortSignal.aborted) {
      runState.transition('abort');
      updateMessage(userMessageId, { content: lastIterationContent, status: 'aborted' });
      endTrace('aborted');
      await safeEmit(onEvent, { type: 'agent_loop_end', endReason: 'aborted' });
      return { status: 'aborted', content: lastIterationContent, messages: addedMessages };
    }

    runState.transition('fail');
    updateMessage(userMessageId, {
      content: lastIterationContent,
      status: 'failed',
      error: message,
    });
    endTrace('error', { error: message });
    await safeEmit(onEvent, { type: 'agent_loop_end', endReason: 'error' });
    return {
      status: 'error',
      content: lastIterationContent,
      messages: addedMessages,
      error: message,
    };
  }
}

/**
 * Emit the terminal event, swallowing callback errors so a faulty caller
 * cannot crash the loop mid-shutdown.
 */
async function safeEmit(
  onEvent: AgentLoopEventCallback,
  event: AgentLoopEvent,
): Promise<void> {
  try {
    await onEvent(event);
  } catch {
    // ignored — we're terminating anyway
  }
}

// ---------------------------------------------------------------------------
// Job-mode entry point (Step B — async agent loop decoupled from SSE)
// ---------------------------------------------------------------------------

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
  history: Message[];
  userContent: string;
  attachments?: AttachmentText[];
  skills?: SkillInjection[];
  tools: Tool[];
  adapter: ProviderAdapter;
  adapterConfig: AdapterConfig;
  /** 可选轨迹采集器（由 worker 构造注入，透传给 runAgentLoop）。 */
  trace?: TraceCollector;
}

/**
 * Run the agent loop as a background job, decoupled from any SSE connection.
 *
 * This is the Step B entry point: instead of bridging events to a live SSE
 * stream, it collects every {@link AgentLoopEvent} into an in-memory array
 * and returns them as part of the job result. The result JSON is then
 * stored on the `jobs.result` column by the worker, and clients can poll
 * `/api/jobs/:id` (or `/api/jobs/:id/stream`) to observe progress.
 *
 * Reuses the core {@link runAgentLoop} so sync and async modes share the
 * exact same orchestration, termination, and persistence semantics
 * （v2 的 Run 状态机与确认联动随之自动生效）。
 */
export async function runAgentLoopAsJob(
  job: Job,
  context: AgentLoopJobContext,
  signal: AbortSignal,
): Promise<Record<string, unknown>> {
  const events: AgentLoopEvent[] = [];

  const result = await runAgentLoop({
    ...context,
    jobId: job.id,
    runId: job.id,
    abortSignal: signal,
    onEvent: (event) => {
      events.push(event);
      if (event.type === 'tool_confirmation_required') {
        setJobWaitingForConfirmation(
          job.id,
          event.approval as unknown as Record<string, unknown>,
        );
      } else if (event.type === 'tool_confirmation_settled') {
        resumeJobAfterConfirmation(job.id);
      }
    },
  });

  return {
    status: result.status,
    content: result.content,
    events,
    ...(result.error !== undefined ? { error: result.error } : {}),
  };
}
