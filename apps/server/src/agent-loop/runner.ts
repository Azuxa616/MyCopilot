/**
 * Agent Loop Runner
 *
 * The orchestration core: iterates LLM calls + tool execution until the model
 * signals completion, hits max iterations, length-limits, or is aborted.
 *
 * DECOUPLED FROM SSE: All StreamEvent delivery to the outside world happens
 * through the `onEvent` callback. The runner never touches a stream object.
 * This makes it usable from a request-bound SSE handler today and from a
 * background job in Step B without changes.
 */
import type { Message, ToolCall, StreamEvent, Tool, Job } from '@my-copilot/shared';
import type {
  ChatMessage,
  AdapterConfig,
  ProviderAdapter,
  JsonSchemaTool,
} from '../llm/base.js';
import type { AttachmentText, SkillInjection } from '../prompt/assembler.js';
import { assembleMessages } from '../prompt/assembler.js';
import { estimateMessagesTokens } from '../prompt/token-counter.js';
import { summarizeHistory } from '../prompt/summarizer.js';
import { createMessage, updateMessage } from '../repo/message.js';
import { createSummary, getLatestSummary } from '../repo/summary.js';
import { executeToolCall } from '../tools/executor.js';
import { toolInputSchemaToJsonSchema } from '../utils/schema-adapter.js';

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
  | { type: 'agent_loop_end'; endReason: AgentLoopStatus };

/** Callback signature for `onEvent`. May be sync or async. */
export type AgentLoopEventCallback = (
  event: AgentLoopEvent,
) => void | Promise<void>;

/** Parameters for runAgentLoop. */
export interface RunAgentLoopParams {
  sessionId: string;
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

/** Resolve max iterations from params → env → default. */
function resolveMaxIterations(override?: number): number {
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
 * Run the agent loop: LLM call → consume stream → maybe execute tools → repeat.
 *
 * Termination conditions:
 *   - `finish.reason === 'stop'`           → status 'completed'
 *   - `finish.reason === 'length'`         → status 'length_limited'
 *   - iterations > maxIterations           → status 'max_iterations'
 *   - abortSignal.aborted                  → status 'aborted'
 *   - unexpected exception                 → status 'error'
 *
 * Side effects per round:
 *   - Forwards every StreamEvent via onEvent({ type: 'llm_event', event })
 *   - Persists assistant message (with toolCalls) to DB on tool-call rounds
 *   - Persists each tool result to DB as role='tool' message
 *   - Pushes synthetic assistant + tool messages onto `history` so the next
 *     iteration's `assembleMessages` sees them
 */
export async function runAgentLoop(
  params: RunAgentLoopParams,
): Promise<AgentLoopResult> {
  const {
    sessionId,
    userMessageId,
    history,
    userContent,
    attachments,
    skills,
    tools,
    adapter,
    adapterConfig,
    abortSignal,
    onEvent,
  } = params;

  const maxIter = resolveMaxIterations(params.maxIterations);

  let fullContent = '';
  const addedMessages: Message[] = [];

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
    let iterations = 0;

    while (iterations < maxIter) {
      // 1. Check abort at the top of every iteration.
      if (abortSignal.aborted) {
        updateMessage(userMessageId, { content: fullContent, status: 'aborted' });
        await safeEmit(onEvent, { type: 'agent_loop_end', endReason: 'aborted' });
        return { status: 'aborted', content: fullContent, messages: addedMessages };
      }

      // 1b. Lazy summarization — compact long histories before assembling the
      //     prompt. No-op when under the token threshold; fail-soft otherwise.
      await maybeSummarizeHistory({ sessionId, history, adapter, adapterConfig });

      iterations++;

      // 2. Assemble chat messages from the current history snapshot.
      const chatMessages: ChatMessage[] = assembleMessages({
        history,
        userContent,
        attachments,
        skills,
      });

      // 3. Open the LLM stream.
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
        // Forward every event to the caller.
        await onEvent({ type: 'llm_event', event });

        if (event.type === 'content') {
          fullContent += event.text;
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

      // 5. Check abort after LLM stream consumed.
      if (abortSignal.aborted) {
        updateMessage(userMessageId, { content: fullContent, status: 'aborted' });
        await safeEmit(onEvent, { type: 'agent_loop_end', endReason: 'aborted' });
        return { status: 'aborted', content: fullContent, messages: addedMessages };
      }

      // 6. Terminal finish reasons — no further tool execution.
      if (finishReason === 'stop' || finishReason === 'length') {
        updateMessage(userMessageId, { content: fullContent, status: 'sent' });
        const status: AgentLoopStatus =
          finishReason === 'length' ? 'length_limited' : 'completed';
        await safeEmit(onEvent, { type: 'agent_loop_end', endReason: status });
        return { status, content: fullContent, messages: addedMessages };
      }

      // 7. No tool calls and no explicit finish — treat as complete to avoid
      //    looping forever on a degenerate adapter response.
      if (toolCalls.length === 0) {
        updateMessage(userMessageId, { content: fullContent, status: 'sent' });
        await safeEmit(onEvent, { type: 'agent_loop_end', endReason: 'completed' });
        return { status: 'completed', content: fullContent, messages: addedMessages };
      }

      // 8. Persist the assistant message that requested tool calls (once per
      //    round, NOT once per tool call) and add it to history.
      createMessage({
        sessionId,
        role: 'assistant',
        content: fullContent,
        toolCalls,
        status: 'sent',
      });

      const assistantMsg: Message = {
        id: `syn-assistant-${iterations}-${Date.now().toString(36)}`,
        sessionId,
        role: 'assistant',
        content: fullContent,
        toolCalls,
        status: 'sent',
        createdAt: Date.now(),
        attachments: [],
      };
      history.push(assistantMsg);
      addedMessages.push(assistantMsg);

      // 9. Execute all tool calls in parallel.
      const toolResults = await Promise.all(
        toolCalls.map((tc) =>
          executeToolCall(tc, { sessionId, signal: abortSignal }),
        ),
      );

      // 10. Persist each tool result, push to history, notify caller.
      for (let i = 0; i < toolCalls.length; i++) {
        const tc = toolCalls[i]!;
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

      // 11. Re-check abort after (potentially slow) tool execution.
      if (abortSignal.aborted) {
        updateMessage(userMessageId, { content: fullContent, status: 'aborted' });
        await safeEmit(onEvent, { type: 'agent_loop_end', endReason: 'aborted' });
        return { status: 'aborted', content: fullContent, messages: addedMessages };
      }
    }

    // 12. Exhausted maxIterations.
    updateMessage(userMessageId, { content: fullContent, status: 'sent' });
    await safeEmit(onEvent, { type: 'agent_loop_end', endReason: 'max_iterations' });
    return { status: 'max_iterations', content: fullContent, messages: addedMessages };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    // Distinguish abort-driven exceptions from real errors.
    if (abortSignal.aborted) {
      updateMessage(userMessageId, { content: fullContent, status: 'aborted' });
      await safeEmit(onEvent, { type: 'agent_loop_end', endReason: 'aborted' });
      return { status: 'aborted', content: fullContent, messages: addedMessages };
    }

    updateMessage(userMessageId, {
      content: fullContent,
      status: 'failed',
      error: message,
    });
    await safeEmit(onEvent, { type: 'agent_loop_end', endReason: 'error' });
    return {
      status: 'error',
      content: fullContent,
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
  /** Placeholder assistant message ID (created by the HTTP handler). */
  userMessageId: string;
  history: Message[];
  userContent: string;
  attachments?: AttachmentText[];
  skills?: SkillInjection[];
  tools: Tool[];
  adapter: ProviderAdapter;
  adapterConfig: AdapterConfig;
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
 * exact same orchestration, termination, and persistence semantics.
 */
export async function runAgentLoopAsJob(
  job: Job,
  context: AgentLoopJobContext,
  signal: AbortSignal,
): Promise<Record<string, unknown>> {
  const events: AgentLoopEvent[] = [];

  const result = await runAgentLoop({
    ...context,
    abortSignal: signal,
    onEvent: (event) => {
      events.push(event);
    },
  });

  return {
    status: result.status,
    content: result.content,
    events,
    ...(result.error !== undefined ? { error: result.error } : {}),
  };
}
