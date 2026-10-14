import { describe, it, expect } from 'vitest';
import {
  CLOSED,
  filterCandidates,
  handleTriggerKeyDown,
  moveSelection,
  updateTriggerOnInput,
} from './triggers';

describe('updateTriggerOnInput（触发与互斥，表驱动）', () => {
  it.each([
    {
      name: '行首 /（value 开头）触发命令面板',
      value: '/', caret: 1,
      expected: { open: true, kind: 'command' as const, query: '' },
    },
    {
      name: '空格后 / 触发',
      value: 'a /', caret: 3,
      expected: { open: true, kind: 'command' as const, query: '' },
    },
    {
      name: '换行后 @ 触发引用浮层',
      value: 'hi\n@', caret: 4,
      expected: { open: true, kind: 'reference' as const, query: '' },
    },
    {
      name: '继续输入作为过滤词',
      value: '/tra', caret: 4,
      expected: { open: true, kind: 'command' as const, query: 'tra' },
    },
    {
      name: '非边界的 / 不触发（前字符为字母）',
      value: 'a/b', caret: 3,
      expected: { open: false },
    },
    {
      name: '过滤词中出现空格 → 关闭',
      value: '/a b', caret: 4,
      expected: { open: false },
    },
    {
      name: '过滤词中出现换行 → 关闭',
      value: '/a\nb', caret: 4,
      expected: { open: false },
    },
    {
      name: '单浮层互斥：先 / 后 @（空格分隔），@ 替换 /',
      value: '/a @b', caret: 5,
      expected: { open: true, kind: 'reference' as const, query: 'b' },
    },
    {
      name: 'chip token 行内的触发符不再触发（确认后面板关闭）',
      value: '/translate', caret: 10, chipTokens: ['/translate'],
      expected: { open: false },
    },
    {
      name: '普通文本不触发',
      value: 'hello world', caret: 11,
      expected: { open: false },
    },
  ])('$name', ({ value, caret, chipTokens, expected }) => {
    const state = updateTriggerOnInput(CLOSED, value, caret, chipTokens ?? []);
    if (expected.open) {
      expect(state).toMatchObject(expected);
      if (state.open) expect(typeof state.triggerStart).toBe('number');
    } else {
      expect(state).toEqual({ open: false });
    }
  });

  it('triggerStart 指向触发符位置', () => {
    const state = updateTriggerOnInput(CLOSED, 'a /tra', 6, []);
    expect(state).toMatchObject({ open: true, triggerStart: 2, query: 'tra' });
  });
});

describe('handleTriggerKeyDown（键盘路由，表驱动）', () => {
  it.each([
    { key: 'ArrowUp', open: true, expected: { type: 'move', delta: -1 } },
    { key: 'ArrowDown', open: true, expected: { type: 'move', delta: 1 } },
    { key: 'Enter', open: true, expected: { type: 'commit' } },
    { key: 'Tab', open: true, expected: { type: 'commit' } },
    { key: 'Escape', open: true, expected: { type: 'close' } },
    { key: 'a', open: true, expected: { type: 'ignore' } },
    { key: 'Enter', open: false, expected: { type: 'ignore' } },
    { key: 'Backspace', open: false, expected: { type: 'ignore' } },
  ])('$key (open=$open) → $expected.type', ({ key, open, expected }) => {
    const state = open
      ? { open: true as const, kind: 'command' as const, triggerStart: 0, query: '', selectedIndex: 0 }
      : CLOSED;
    expect(handleTriggerKeyDown(state, key)).toEqual(expected);
  });
});

describe('moveSelection', () => {
  const open = { open: true as const, kind: 'command' as const, triggerStart: 0, query: '', selectedIndex: 0 };

  it('下移与上移', () => {
    expect(moveSelection({ ...open, selectedIndex: 0 }, 1, 3).selectedIndex).toBe(1);
    expect(moveSelection({ ...open, selectedIndex: 1 }, -1, 3).selectedIndex).toBe(0);
  });

  it('越界回绕（循环导航）', () => {
    expect(moveSelection({ ...open, selectedIndex: 2 }, 1, 3).selectedIndex).toBe(0);
    expect(moveSelection({ ...open, selectedIndex: 0 }, -1, 3).selectedIndex).toBe(2);
  });

  it('空候选列表恒为 0；关闭态原样返回', () => {
    expect(moveSelection({ ...open }, 1, 0).selectedIndex).toBe(0);
    expect(moveSelection(CLOSED, 1, 3)).toBe(CLOSED);
  });
});

describe('filterCandidates', () => {
  const items = [
    { filterText: 'translate' },
    { filterText: 'code-review' },
    { filterText: '调研记录' },
  ];

  it('大小写不敏感子串匹配', () => {
    expect(filterCandidates(items, 'TRANS')).toEqual([items[0]]);
    expect(filterCandidates(items, 'review')).toEqual([items[1]]);
  });

  it('空查询返回全量；中文匹配', () => {
    expect(filterCandidates(items, '')).toEqual(items);
    expect(filterCandidates(items, '调研')).toEqual([items[2]]);
  });
});
