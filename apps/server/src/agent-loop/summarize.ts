/**
 * Agent Loop 的迭代收敛提醒与惰性历史摘要助手。
 *
 * 从 runner.ts 原样迁移（零行为变化）：buildIterationReminder /
 * appendStopNotice / resolveMaxIterations / maybeSummarizeHistory 及其常量。
 */
import type { Message } from '@my-copilot/shared';
import type {
  AdapterConfig,
  ChatMessage,
  ProviderAdapter,
} from '../llm/base.js';
import { estimateMessagesTokens } from '../prompt/token-counter.js';
import { summarizeHistory } from '../prompt/summarizer.js';
import { createSummary, getLatestSummary } from '../repo/summary.js';

const DEFAULT_MAX_ITERATIONS = 10;

/**
 * 从第几轮 LLM 调用起注入渐进式收敛提醒（迭代感知收敛机制）。
 *
 * 参考 Cursor Ralph Loop 的 iteration/max_iterations 状态注入与 GitHub
 * Copilot SDK 的渐进施压模式：演示型/模糊目标请求（如"调用一下某工具"）
 * 缺少天然完成条件，弱指令遵循模型会持续选择"再调用一轮"直至步数上限
 * （回归案例：会话 ee176efb / a2dcd2d0，10 轮耗尽仍无最终回答）。
 */
const ITERATION_REMINDER_THRESHOLD = 3;

/**
 * 构造第 iteration 轮（共 maxSteps 轮）的收敛提醒文本。
 *
 * - 最后一轮（iteration === maxSteps）：强提醒，明确下一轮必须交付最终回答；
 * - 第 ITERATION_REMINDER_THRESHOLD 轮起：渐进提醒，含轮次进度 X/Y；
 * - 之前：null（不注入）。
 *
 * 提醒以临时 system 消息进入本次 LLM 请求——不落库、不推送前端、
 * 不进 history，对持久化与 SSE 协议零影响。
 */
export function buildIterationReminder(
  iteration: number,
  maxSteps: number,
): string | null {
  if (iteration >= maxSteps) {
    return (
      '[系统提醒] 这是最后一次工具调用机会。下一轮输出必须是不含任何工具调用的' +
      '最终回答：请基于已获得的全部结果，完成对用户的回答（说明调用了什么、' +
      '返回了什么、结论是什么）。'
    );
  }
  if (iteration >= ITERATION_REMINDER_THRESHOLD) {
    return (
      `[系统提醒] 本次运行已进行到第 ${iteration}/${maxSteps} 轮工具调用。` +
      '请评估任务是否已完成；除非新的调用会改变你的回答，否则请基于已有结果' +
      '直接输出最终回答。'
    );
  }
  return null;
}

/**
 * 非完整终态（步数/预算/长度截断）在最终内容后追加的可见提示。
 *
 * 这些终态的最后一段文本通常是"接下来调用 X…"式的前导语——模型正在为下一轮
 * 工具调用做准备时被截断（真实案例：会话 ee176efb 以"…查询文档："收尾并
 * 被当作正常回答展示）。提示随内容一起持久化（占位消息）并经 done 事件下发，
 * 前端与刷新后的 DB 读取看到的都是同一份带提示的内容。
 */
export function appendStopNotice(
  content: string,
  reason: 'max_iterations' | 'max_tokens' | 'length_limited',
  maxSteps: number,
): string {
  const notice =
    reason === 'max_iterations'
      ? `⚠️ 已达到单次运行的最大工具调用轮次（${maxSteps} 轮），回复自动停止；可发送新消息继续。`
      : reason === 'max_tokens'
        ? '⚠️ 对话上下文接近预算上限，回复自动停止；可开启新会话或精简上下文后继续。'
        : '⚠️ 输出因模型长度上限被截断，内容可能不完整。';
  return content.trim().length > 0 ? `${content}\n\n---\n${notice}` : notice;
}

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

/** Resolve max iterations from params → env → default. */
export function resolveMaxIterations(override?: number): number {
  if (override !== undefined) return override;
  const env = Number.parseInt(process.env.AGENT_MAX_ITERATIONS ?? '', 10);
  return Number.isFinite(env) && env > 0 ? env : DEFAULT_MAX_ITERATIONS;
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
export async function maybeSummarizeHistory(params: {
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
