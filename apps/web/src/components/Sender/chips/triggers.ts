/**
 * `/` 与 `@` 的触发状态机（纯函数，无 React 依赖）。
 *
 * 单浮层互斥：状态只有一个 open 槽位，后触发者替换先触发者
 * （设计开放问题 2 的采纳结论）。键盘语义：↑↓ 移动、Enter/Tab 确认、
 * Esc 关闭；面板关闭时所有按键 ignore（走 textarea 默认行为）。
 */

export type TriggerKind = 'command' | 'reference';

export type TriggerState =
  | { open: false }
  | {
      open: true;
      kind: TriggerKind;
      /** 触发符（'/' 或 '@'）在 textarea 值中的位置。 */
      triggerStart: number;
      /** 触发符之后至 caret 的过滤词（不含触发符）。 */
      query: string;
      /** 当前选中候选下标（候选列表由组件层按 query 过滤后传入）。 */
      selectedIndex: number;
    };

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
  _state: TriggerState,
  value: string,
  caret: number,
  chipTokens: readonly string[] = [],
): TriggerState {
  let i = caret - 1;
  while (i >= 0) {
    const ch = value[i]!;
    if (ch === '/' || ch === '@') {
      const prev = i > 0 ? value[i - 1]! : '';
      const atBoundary = prev === '' || prev === '\n' || prev === ' ';
      if (!atBoundary) return CLOSED;

      // chip token 行整体是已确认的 chip：不再触发
      const lineEnd = value.indexOf('\n', i);
      const lineText = value.slice(i, lineEnd === -1 ? value.length : lineEnd);
      if (chipTokens.includes(lineText)) return CLOSED;

      const kind: TriggerKind = ch === '/' ? 'command' : 'reference';
      return {
        open: true,
        kind,
        triggerStart: i,
        query: value.slice(i + 1, caret),
        selectedIndex: 0,
      };
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
  | { type: 'close' };

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
      return { type: 'close' };
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
