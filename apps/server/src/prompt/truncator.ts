import type { Message } from '@my-copilot/shared';
import { estimateMessagesTokens } from './token-counter.js';

/**
 * History truncation strategy (T24).
 *
 * Keeps the conversation within a token budget so assembled prompts fit inside
 * the model's context window. The strategy:
 *
 * 1. **Fast path** — if total estimated tokens already fit, return unchanged.
 * 2. **Reserve** — subtract a fixed reserve for the system prompt (added by
 *    the assembler) so truncation leaves headroom for it.
 * 3. **Preserve leading system messages** — any `system`-role messages at the
 *    head of history are always kept (they are typically small instructions).
 * 4. **Group into chains** — the remaining messages are split into chains
 *    where an assistant tool-call turn and its `tool`-result stay together.
 * 5. **Keep recent, drop oldest** — iterate newest → oldest, keeping each
 *    chain that still fits the remaining budget.
 */

/** Tokens reserved for the assembler-injected system prompt + headroom. */
const SYSTEM_RESERVE_TOKENS = 2000;

export interface TruncationResult {
  /** History subset that fits within the budget. */
  truncated: Message[];
  /** Number of messages dropped (0 when no truncation occurred). */
  dropped: number;
}

export function truncateHistory(params: {
  history: Message[];
  maxTokens: number;
}): TruncationResult {
  const { history, maxTokens } = params;
  if (history.length === 0) return { truncated: [], dropped: 0 };

  // Fast path — everything fits, no work needed.
  const totalTokens = estimateMessagesTokens(history);
  if (totalTokens <= maxTokens) {
    return { truncated: history, dropped: 0 };
  }

  // Budget for history excludes the assembler's system prompt reserve.
  const historyBudget = Math.max(0, maxTokens - SYSTEM_RESERVE_TOKENS);

  // 1. Peel off leading system messages — always preserved.
  const leadingSystem: Message[] = [];
  let i = 0;
  while (i < history.length && history[i].role === 'system') {
    leadingSystem.push(history[i]);
    i++;
  }
  const rest = history.slice(i);

  // Remaining budget after accounting for the always-kept system messages.
  let remainingBudget = historyBudget - estimateMessagesTokens(leadingSystem);

  // 2. Group remaining messages into chains. An assistant turn that requests
  //    tool calls and the following tool result must stay together, otherwise
  //    the API rejects the sequence. Boundary rule:
  //      - a `user` message closes the current chain
  //      - a `tool` message closes the chain once it has an assistant parent
  const chains: Message[][] = [];
  let currentChain: Message[] = [];
  for (const msg of rest) {
    currentChain.push(msg);
    if (msg.role === 'user' || (msg.role === 'tool' && currentChain.length >= 2)) {
      chains.push(currentChain);
      currentChain = [];
    }
  }
  if (currentChain.length > 0) chains.push(currentChain);

  const chainCosts = chains.map((chain) => estimateMessagesTokens(chain));

  // 3. Walk newest → oldest, keeping each chain that fits the remaining budget.
  const keptChains: Message[][] = [];
  let dropped = 0;
  for (let j = chains.length - 1; j >= 0; j--) {
    if (chainCosts[j] <= remainingBudget) {
      keptChains.unshift(chains[j]);
      remainingBudget -= chainCosts[j];
    } else {
      dropped += chains[j].length;
    }
  }

  return {
    truncated: [...leadingSystem, ...keptChains.flat()],
    dropped,
  };
}
