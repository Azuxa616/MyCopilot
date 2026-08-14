import type { Message, MessageRole, StrategyName } from '@my-copilot/shared';
import { estimateMessagesTokens } from './token-counter.js';

/**
 * 历史截断多策略注册表（T5）。对应 RFC §2 多策略调度（Multi-Strategy Scheduling）：
 * `docs/rfc/context-management-v2.md`。
 *
 * 现有贪心"最新链保留"算法保留为 `sliding_window` 策略（内部逻辑未改动），
 * 另注册 4 种新策略：`sliding_window_summary`、`head_tail`、`anchor`、`importance`。
 * 所有策略共享以下不变量：
 *
 * 1. **快速路径** — 总 token 估算已在预算内时原样返回（保持引用不变）。
 * 2. **预留** — 先扣除组装器注入 system prompt 的固定预留
 *    （`SYSTEM_RESERVE_TOKENS`），截断结果为历史留出 headroom。
 * 3. **头部 system 保留** — history 头部连续的 `system` 消息总是保留
 *    （通常是很小的指令）。
 * 4. **链完整性** — assistant 工具调用轮次与其 `tool` 结果不被拆散，
 *    否则 OpenAI 兼容 API 会拒绝该消息序列。
 *
 * 本模块是纯函数：不调用 LLM（摘要文本由调用方生成后经
 * `TruncateOptions.summaryText` 注入）。
 */

/** 为组装器注入的 system prompt + headroom 预留的 token 数。 */
const SYSTEM_RESERVE_TOKENS = 2000;

/** head_tail 策略默认保留的尾部消息条数。对应 RFC §2 head-tail-preserve。 */
const DEFAULT_TAIL_COUNT = 10;

/**
 * importance 策略的默认角色权重。对应 RFC §2 importance-preserve。
 * `system` 计 0 分：头部 system 由保留不变量处理，无需参与打分。
 */
const DEFAULT_ROLE_WEIGHTS: Record<MessageRole, number> = {
  user: 3,
  assistant: 2,
  tool: 1,
  system: 0,
};

export interface TruncationResult {
  /** 预算内的历史子集。 */
  truncated: Message[];
  /** 丢弃的消息数（未发生截断时为 0）。 */
  dropped: number;
}

/** 截断策略可选参数。对应 RFC §2 各策略的输入差异项。 */
export interface TruncateOptions {
  /** head_tail 策略保留的尾部消息条数（默认 10）。 */
  tailCount?: number;
  /** anchor 策略的锚点判定谓词（默认无锚点，此时退化为 sliding_window）。 */
  anchorPredicate?: (msg: Message) => boolean;
  /**
   * importance 策略的角色权重，覆盖合并到默认值
   * （user=3 / assistant=2 / tool=1）之上。
   */
  roleWeights?: Partial<Record<MessageRole, number>>;
  /**
   * sliding_window_summary 策略注入的摘要文本，由调用方（T7）生成后传入。
   * truncator 不调用 LLM，保持纯函数；合成摘要消息的 token 不从预算中
   * 扣除，由调用方负责在预算中预留。
   */
  summaryText?: string;
}

/** 截断策略契约。对应 RFC §2 的 ContextStrategy 接口在本模块的落位。 */
export interface TruncateStrategy {
  /** 策略名，与 shared 的 `StrategyName` 一一对应。 */
  name: StrategyName;
  /** 按预算截断历史，返回保留子集与丢弃计数。 */
  truncate(
    history: Message[],
    budgetTokens: number,
    options?: TruncateOptions,
  ): TruncationResult;
}

/**
 * sliding_window 策略内部实现（原 `truncateHistory` 算法，逻辑未改动）。
 * 对应 RFC §2 sliding-window。
 *
 * 1. **快速路径** — 总 token 已在预算内则原样返回。
 * 2. **预留** — 扣除 system prompt 固定预留。
 * 3. **头部 system 消息** — 始终保留。
 * 4. **链分组** — assistant 工具调用轮次与其 tool 结果保持在同一链。
 * 5. **保新弃旧** — 从最新到最旧贪心保留仍装得下的链。
 */
function slidingWindowTruncate(
  history: Message[],
  budgetTokens: number,
): TruncationResult {
  if (history.length === 0) return { truncated: [], dropped: 0 };

  // Fast path — everything fits, no work needed.
  const totalTokens = estimateMessagesTokens(history);
  if (totalTokens <= budgetTokens) {
    return { truncated: history, dropped: 0 };
  }

  // Budget for history excludes the assembler's system prompt reserve.
  const historyBudget = Math.max(0, budgetTokens - SYSTEM_RESERVE_TOKENS);

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

/** 剥离 history 头部连续的 system 消息（总是保留），返回头部与剩余部分。 */
function peelLeadingSystem(history: Message[]): {
  leadingSystem: Message[];
  rest: Message[];
} {
  const leadingSystem: Message[] = [];
  let i = 0;
  while (i < history.length && history[i].role === 'system') {
    leadingSystem.push(history[i]);
    i++;
  }
  return { leadingSystem, rest: history.slice(i) };
}

/**
 * 将消息按 assistant 工具调用链分组，边界规则与 sliding_window 一致：
 * - `user` 消息闭合当前链；
 * - `tool` 消息在已有 assistant 父消息时闭合当前链。
 */
function groupIntoChains(rest: Message[]): Message[][] {
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
  return chains;
}

/**
 * sliding_window_summary 策略内部实现。对应 RFC §2 sliding-window-summary：
 * 先按 sliding_window 截断，再在结果头部（system 消息之后）注入一条合成摘要
 * 消息。丢弃计数与 sliding_window 一致；摘要文本由调用方注入，本函数不调 LLM。
 */
function slidingWindowSummaryTruncate(
  history: Message[],
  budgetTokens: number,
  options?: TruncateOptions,
): TruncationResult {
  const base = slidingWindowTruncate(history, budgetTokens);
  const summaryText = options?.summaryText;
  // 无摘要文本（或空 history 无 sessionId 可沿用）时不注入，
  // 结果与 sliding_window 完全一致。
  if (!summaryText || history.length === 0) return base;

  // 插入点：结果头部连续 system 消息之后。
  let insertAt = 0;
  while (
    insertAt < base.truncated.length &&
    base.truncated[insertAt].role === 'system'
  ) {
    insertAt++;
  }

  const summaryMsg: Message = {
    id: `syn-summary-${Date.now().toString(36)}`,
    sessionId: history[0].sessionId,
    role: 'assistant',
    content: `[Previous conversation summary]\n\n${summaryText}`,
    attachments: [],
    status: 'sent',
    createdAt: Date.now(),
  };

  return {
    truncated: [
      ...base.truncated.slice(0, insertAt),
      summaryMsg,
      ...base.truncated.slice(insertAt),
    ],
    dropped: base.dropped,
  };
}

/**
 * head_tail 策略内部实现。对应 RFC §2 head-tail-preserve：
 * 保留头部所有 system 角色 + 尾部 `tailCount` 条（按消息边界），其余丢弃。
 * 若尾部截断处切断 assistant→tool 链（截断点落在 tool 消息上），
 * 则向前扩展到链首（拥有该 tool 调用的 assistant 消息）。
 * 保留集合按位置决定，不按预算进一步收缩。
 */
function headTailTruncate(
  history: Message[],
  budgetTokens: number,
  options?: TruncateOptions,
): TruncationResult {
  if (history.length === 0) return { truncated: [], dropped: 0 };

  // 快速路径 — 未超预算时不做位置性丢弃。
  if (estimateMessagesTokens(history) <= budgetTokens) {
    return { truncated: history, dropped: 0 };
  }

  const tailCount = options?.tailCount ?? DEFAULT_TAIL_COUNT;
  const { leadingSystem } = peelLeadingSystem(history);
  const sysEnd = leadingSystem.length;

  // 尾部起点：最后 tailCount 条（不侵入头部 system 区）。
  let tailStart = Math.max(sysEnd, history.length - tailCount);
  // 链首扩展：截断点落在 tool 消息上说明切断了 assistant→tool 链。
  while (tailStart > sysEnd && history[tailStart].role === 'tool') {
    tailStart--;
  }

  return {
    truncated: [...leadingSystem, ...history.slice(tailStart)],
    dropped: tailStart - sysEnd,
  };
}

/**
 * anchor 策略内部实现。对应 RFC §2 anchor-preserve：
 * 保留所有满足 `anchorPredicate` 的消息（所在链整体保留，保证链完整性；
 * 锚点链即使超预算也保留——锚点是显式标记）+ 头部 system + 尾部消息
 * （从最新链向最旧链贪心装剩余预算）。无锚点时退化为 sliding_window。
 */
function anchorTruncate(
  history: Message[],
  budgetTokens: number,
  options?: TruncateOptions,
): TruncationResult {
  if (history.length === 0) return { truncated: [], dropped: 0 };

  // 快速路径 — 未超预算时无需截断。
  if (estimateMessagesTokens(history) <= budgetTokens) {
    return { truncated: history, dropped: 0 };
  }

  const pred = options?.anchorPredicate;
  // 无锚点（未提供谓词，或谓词在整段历史上无命中）→ 退化为 sliding_window。
  if (!pred || !history.some(pred)) {
    return slidingWindowTruncate(history, budgetTokens);
  }

  const { leadingSystem, rest } = peelLeadingSystem(history);
  const chains = groupIntoChains(rest);
  const chainCosts = chains.map((chain) => estimateMessagesTokens(chain));
  const isAnchorChain = chains.map((chain) => chain.some(pred));

  let remainingBudget =
    Math.max(0, budgetTokens - SYSTEM_RESERVE_TOKENS) -
    estimateMessagesTokens(leadingSystem);

  // 锚点链无条件保留，即使把预算打穿（可能为负——锚点是显式标记）。
  const kept = new Array<boolean>(chains.length).fill(false);
  for (let i = 0; i < chains.length; i++) {
    if (isAnchorChain[i]) {
      kept[i] = true;
      remainingBudget -= chainCosts[i];
    }
  }

  // 尾部：从最新链向最旧链贪心装剩余预算。
  for (let i = chains.length - 1; i >= 0; i--) {
    if (kept[i]) continue;
    if (chainCosts[i] <= remainingBudget) {
      kept[i] = true;
      remainingBudget -= chainCosts[i];
    }
  }

  const keptChains = chains.filter((_, i) => kept[i]);
  const dropped = rest.length - keptChains.reduce((n, c) => n + c.length, 0);
  return { truncated: [...leadingSystem, ...keptChains.flat()], dropped };
}

/**
 * importance 策略内部实现。对应 RFC §2 importance-preserve：
 * 按 `roleWeights`（默认 user=3 / assistant=2 / tool=1）给消息打分，
 * 以链为单位（链得分 = 成员最高分）从高分到低分贪心装包；同分按新旧
 * （新者优先）。输出保持原时间顺序，链完整性由链分组保证。
 */
function importanceTruncate(
  history: Message[],
  budgetTokens: number,
  options?: TruncateOptions,
): TruncationResult {
  if (history.length === 0) return { truncated: [], dropped: 0 };

  // 快速路径 — 未超预算时无需截断。
  if (estimateMessagesTokens(history) <= budgetTokens) {
    return { truncated: history, dropped: 0 };
  }

  const weights: Record<MessageRole, number> = {
    ...DEFAULT_ROLE_WEIGHTS,
    ...options?.roleWeights,
  };

  const { leadingSystem, rest } = peelLeadingSystem(history);
  const chains = groupIntoChains(rest);
  const chainCosts = chains.map((chain) => estimateMessagesTokens(chain));
  // 链得分取成员最高分：user 提问驱动其后的 assistant/tool 跟随，
  // 一条链与其最重要的消息同等重要。
  const chainScores = chains.map((chain) =>
    Math.max(...chain.map((m) => weights[m.role] ?? 0)),
  );

  // 装包顺序：分高优先；同分按新旧（新者在前，即原索引大者在前）。
  const order = chains
    .map((_, i) => i)
    .sort((a, b) => chainScores[b] - chainScores[a] || b - a);

  let remainingBudget =
    Math.max(0, budgetTokens - SYSTEM_RESERVE_TOKENS) -
    estimateMessagesTokens(leadingSystem);

  const kept = new Array<boolean>(chains.length).fill(false);
  for (const i of order) {
    if (chainCosts[i] <= remainingBudget) {
      kept[i] = true;
      remainingBudget -= chainCosts[i];
    }
  }

  // filter 保持原时间顺序。
  const keptChains = chains.filter((_, i) => kept[i]);
  const dropped = rest.length - keptChains.reduce((n, c) => n + c.length, 0);
  return { truncated: [...leadingSystem, ...keptChains.flat()], dropped };
}

/** 策略注册表。对应 RFC §2 的可插拔策略槽位，每次运行只有一个策略处于活动状态。 */
export const STRATEGIES: Readonly<Record<StrategyName, TruncateStrategy>> = {
  sliding_window: { name: 'sliding_window', truncate: slidingWindowTruncate },
  sliding_window_summary: {
    name: 'sliding_window_summary',
    truncate: slidingWindowSummaryTruncate,
  },
  head_tail: { name: 'head_tail', truncate: headTailTruncate },
  anchor: { name: 'anchor', truncate: anchorTruncate },
  importance: { name: 'importance', truncate: importanceTruncate },
};

/**
 * 按名称查表调用截断策略。对应 RFC §2 多策略调度的分发入口。
 *
 * @throws 策略名未注册时抛出 `Error`（中文消息）
 */
export function truncateWithStrategy(
  history: Message[],
  budgetTokens: number,
  strategyName: StrategyName,
  options?: TruncateOptions,
): TruncationResult {
  const strategy = STRATEGIES[strategyName];
  if (!strategy) {
    throw new Error(
      `未知的截断策略：${String(strategyName)}（可用策略：${Object.keys(STRATEGIES).join(', ')}）`,
    );
  }
  return strategy.truncate(history, budgetTokens, options);
}

/**
 * 兼容入口：保留原有签名（现有测试与 assembler.ts 依赖），
 * 内部委托 `truncateWithStrategy` 以 `sliding_window` 策略执行。
 */
export function truncateHistory(params: {
  history: Message[];
  maxTokens: number;
}): TruncationResult {
  return truncateWithStrategy(
    params.history,
    params.maxTokens,
    'sliding_window',
  );
}
