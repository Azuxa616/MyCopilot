/**
 * `/` 与 `@` 的触发状态机（纯函数，无 React 依赖）。
 *
 * 单浮层互斥：状态只有一个 open 槽位，后触发者替换先触发者
 * （设计开放问题 2 的采纳结论）。键盘语义：↑↓ 移动、Enter/Tab 确认、
 * Esc 关闭；面板关闭时所有按键 ignore（走 textarea 默认行为）。
 */

import type { ReferenceCategory } from './model';

export type { ReferenceCategory };

export type TriggerKind = 'command' | 'reference';

interface TriggerOpenBase {
  open: true;
  /** 触发符（'/' 或 '@'）在 textarea 值中的位置。 */
  triggerStart: number;
  /** 触发符之后至 caret 的过滤词（不含触发符）。 */
  query: string;
  /** 当前选中候选下标（候选列表由组件层按 query 过滤后传入）。 */
  selectedIndex: number;
}

export type TriggerState =
  | { open: false }
  | (TriggerOpenBase & { kind: 'command' })
  | (TriggerOpenBase & {
      kind: 'reference';
      /** 一级：分类层（会话 / 文件）。 */
      stage: 'category';
    })
  | (TriggerOpenBase & {
      kind: 'reference';
      /** 二级：条目层（具体会话 / 文件）。 */
      stage: 'items';
      category: ReferenceCategory;
    });

export const CLOSED: TriggerState = { open: false };

/**
 * 输入后重算触发状态。规则：
 * - 从 caret 向左扫描：遇到 `/` 或 `@` 判定边界（位于 value 开头 / 行首 /
 *   前一字符为空格）→ 打开面板，query = 触发符到 caret 的连续文本；
 * - 遇到空白（空格/换行）终止扫描 → 关闭（过滤词被空格打断）；
 * - 遇到非边界触发符 → 关闭（如 `a/b`）；
 * - chip token 行内的触发符不触发（确认 chip 后面板应关闭，且用户点进
 *   chip 行编辑时不应弹出面板）——由 chipTokens 参数排除。
 */
export function updateTriggerOnInput(
  prev: TriggerState,
  value: string,
  caret: number,
  chipTokens: readonly string[] = [],
): TriggerState {
  let i = caret - 1;
  while (i >= 0) {
    const ch = value[i]!;
    if (ch === '/' || ch === '@') {
      const prevCh = i > 0 ? value[i - 1]! : '';
      const atBoundary = prevCh === '' || prevCh === '\n' || prevCh === ' ';
      if (!atBoundary) return CLOSED;

      // chip token 行整体是已确认的 chip：不再触发
      const lineEnd = value.indexOf('\n', i);
      const lineText = value.slice(i, lineEnd === -1 ? value.length : lineEnd);
      if (chipTokens.includes(lineText)) return CLOSED;

      const query = value.slice(i + 1, caret);
      if (ch === '/') {
        return { open: true, kind: 'command', triggerStart: i, query, selectedIndex: 0 };
      }
      // reference：同 triggerStart 的连续输入保留 prev 的层级（stage/category），
      // 仅重算 query 并重置选中项；新触发（或 prev 非 reference）从 category 层开始。
      if (prev.open && prev.kind === 'reference' && prev.triggerStart === i) {
        return { ...prev, query, selectedIndex: 0 };
      }
      return { open: true, kind: 'reference', triggerStart: i, query, selectedIndex: 0, stage: 'category' };
    }
    if (/\s/.test(ch)) return CLOSED;
    i -= 1;
  }
  return CLOSED;
}

export type TriggerKeyAction =
  | { type: 'ignore' }
  | { type: 'move'; delta: -1 | 1 }
  | { type: 'commit' }
  | { type: 'close' }
  | { type: 'back' };

/** 二级下钻：category 层 → items 层（query 清空、selectedIndex 归零）。非 category 层原样返回。 */
export function descendToItems(
  state: TriggerState,
  category: ReferenceCategory,
): TriggerState {
  if (!state.open || state.kind !== 'reference' || state.stage !== 'category') return state;
  return {
    open: true,
    kind: 'reference',
    triggerStart: state.triggerStart,
    query: '',
    selectedIndex: 0,
    stage: 'items',
    category,
  };
}

/** 返回一级分类层（selectedIndex 归零、移除 category）。非 items 层原样返回。 */
export function ascendToCategory(state: TriggerState): TriggerState {
  if (!state.open || state.kind !== 'reference' || state.stage !== 'items') return state;
  return {
    open: true,
    kind: 'reference',
    triggerStart: state.triggerStart,
    query: '',
    selectedIndex: 0,
    stage: 'category',
  };
}

/** 面板打开时的键盘路由；面板关闭时一律 ignore。 */
export function handleTriggerKeyDown(state: TriggerState, key: string): TriggerKeyAction {
  if (!state.open) return { type: 'ignore' };
  switch (key) {
    case 'ArrowUp':
      return { type: 'move', delta: -1 };
    case 'ArrowDown':
      return { type: 'move', delta: 1 };
    case 'Enter':
    case 'Tab':
      return { type: 'commit' };
    case 'Escape':
      // 逐层返回：引用条目层先退回分类层，其余场景直接关闭。
      return state.kind === 'reference' && state.stage === 'items'
        ? { type: 'back' }
        : { type: 'close' };
    default:
      return { type: 'ignore' };
  }
}

/** 移动选中项（越界回绕）；空候选恒为 0；关闭态原样返回。 */
export function moveSelection(
  state: Extract<TriggerState, { open: true }>,
  delta: -1 | 1,
  itemCount: number,
): Extract<TriggerState, { open: true }>;
export function moveSelection(
  state: TriggerState,
  delta: -1 | 1,
  itemCount: number,
): TriggerState;
export function moveSelection(
  state: TriggerState,
  delta: -1 | 1,
  itemCount: number,
): TriggerState {
  if (!state.open) return state;
  const next = state.selectedIndex + delta;
  const clamped = itemCount <= 0 ? 0 : (next + itemCount) % itemCount;
  return { ...state, selectedIndex: clamped };
}

/** 候选过滤：大小写不敏感子串匹配（空查询返回全量）。 */
export function filterCandidates<T extends { filterText: string }>(
  items: T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((item) => item.filterText.toLowerCase().includes(q));
}
