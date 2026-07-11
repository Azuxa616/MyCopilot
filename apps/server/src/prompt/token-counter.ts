/**
 * Rough token estimation for conversation history truncation (T24).
 *
 * Uses the chars/4 approximation common to OpenAI-compatible tokenizers for
 * English text. CJK characters are slightly under-estimated but the budget
 * has generous reserves, so this is acceptable for truncation decisions.
 *
 * YAGNI: no tiktoken dependency. Precise counts are not worth the cost —
 * truncation only needs a conservative upper-bound to stay under the model
 * context window.
 */

/** Approximate characters per token for English text. */
const CHARS_PER_TOKEN = 4;

/** Per-message role/framing overhead (role tag, separators). */
const MESSAGE_OVERHEAD_TOKENS = 4;

/**
 * Estimate token count for a text string.
 *
 * @param text - input text (may be empty/nullish)
 * @returns ceiling of length / 4, minimum 0
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Estimate token cost of a single message, including role overhead.
 *
 * Accepts the minimal shape needed — works for both the persisted `Message`
 * (which always has a string content) and the internal `ChatMessage` (whose
 * content may be null for pure tool-call assistant turns).
 */
export function estimateMessageTokens(msg: {
  content: string | null;
  role: string;
}): number {
  return MESSAGE_OVERHEAD_TOKENS + estimateTokens(msg.content ?? '');
}

/**
 * Estimate total token cost for a list of messages.
 */
export function estimateMessagesTokens(
  messages: Array<{ content: string | null; role: string }>,
): number {
  return messages.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0);
}
