/**
 * History summarizer (T25).
 *
 * Calls the LLM (via the existing streaming adapter) to produce a concise
 * summary of conversation history. The summary is then persisted by the agent
 * loop through {@link repo/summary.ts} so that future iterations can replace
 * the rolled-up prefix with a single system-style message.
 *
 * Design notes:
 * - **Fail-soft**: any error returns `null`. Summarization is an optimization,
 *   not a correctness requirement — the agent loop falls back to plain
 *   truncation when no summary is produced.
 * - **Streaming adapter reuse**: the codebase only exposes
 *   `chatCompletionStream`. We collect `content` chunks into a string instead
 *   of adding a non-streaming code path, keeping the adapter surface small.
 * - **No tools**: the summarizer advertises no tools so the model is forced to
 *   emit prose rather than tool calls.
 */
import type {
  ChatMessage,
  ProviderAdapter,
  AdapterConfig,
} from '../llm/base.js';
import { estimateMessagesTokens } from './token-counter.js';

/** System instruction asking the model for a faithful, language-matched summary. */
const SUMMARIZE_PROMPT =
  'Summarize the following conversation concisely, preserving key facts, ' +
  'decisions, and any unresolved context. Write in the same language as the ' +
  'conversation. Do not add information that was not present in the original.';

export interface SummarizeResult {
  summary: string;
  /** Estimated token count of the summarized input (not the summary itself). */
  tokenCount: number;
}

export interface SummarizeHistoryParams {
  /** Conversation messages to summarize (typically user + assistant turns). */
  messages: ChatMessage[];
  /** Provider adapter used to reach the LLM. */
  adapter: ProviderAdapter;
  /** Provider connection configuration. */
  adapterConfig: AdapterConfig;
  /**
   * Optional abort signal. When omitted, a 30-second timeout is used so a
   * stuck summarizer never blocks the agent loop indefinitely.
   */
  signal?: AbortSignal;
}

/** Fallback timeout when the caller does not provide a signal. */
const DEFAULT_SUMMARY_TIMEOUT_MS = 30_000;

/**
 * Generate a summary of the supplied messages via the LLM adapter.
 *
 * @returns `{ summary, tokenCount }` on success, or `null` if the call failed
 *          or produced empty output. Never throws.
 */
export async function summarizeHistory(
  params: SummarizeHistoryParams,
): Promise<SummarizeResult | null> {
  const { messages, adapter, adapterConfig, signal } = params;

  // Nothing to summarize — bail early so we don't make an empty LLM call.
  if (messages.length === 0) return null;

  const effectiveSignal: AbortSignal =
    signal ?? AbortSignal.timeout(DEFAULT_SUMMARY_TIMEOUT_MS);

  try {
    const allMessages: ChatMessage[] = [
      { role: 'system', content: SUMMARIZE_PROMPT },
      ...messages,
    ];

    const generator = adapter.chatCompletionStream(allMessages, adapterConfig, {
      // No tools — we want prose, not function calls.
      tools: undefined,
      signal: effectiveSignal,
    });

    let fullText = '';
    for await (const event of generator) {
      if (event.type === 'content') {
        fullText += event.text;
      } else if (event.type === 'finish') {
        break;
      }
    }

    if (!fullText.trim()) return null;

    return {
      summary: fullText,
      tokenCount: estimateMessagesTokens(messages),
    };
  } catch (err) {
    // Non-blocking: log and return null so the caller falls back to truncation.
    console.warn('[summarizer] Failed to generate summary:', err);
    return null;
  }
}
