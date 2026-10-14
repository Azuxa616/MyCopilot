import { describe, it, expect } from 'vitest';
import {
  annotateLines,
  buildReferenceItems,
  createChip,
  deleteChipAtCaret,
  hasChipToken,
  insertChipToken,
  serializeDraft,
  splitAfterChipToken,
} from './model';
import type { ReferenceCandidate } from './model';

const skillChip = createChip({ kind: 'skill', token: '/translate', skillName: 'translate' });
const fileChip = createChip({ kind: 'file', token: '@报告.pdf', assetId: 'a1' });
const sessionChip = createChip({ kind: 'session', token: '@调研记录', sessionId: 's9' });

describe('insertChipToken', () => {
  it.each([
    {
      name: '空输入：token 独占唯一一行',
      value: '/tra', start: 0, end: 4, token: '/translate',
      expected: '/translate', caret: 10,
    },
    {
      name: '行中触发：前文切上一行、后文切下一行',
      value: 'hello /tra world', start: 6, end: 11, token: '/translate',
      expected: 'hello\n/translate\nworld', caret: 16,
    },
    {
      name: '行首触发 + 同行后文：仅补尾部换行',
      value: '/tra world', start: 0, end: 5, token: '/translate',
      expected: '/translate\nworld', caret: 10,
    },
    {
      name: '前文已独立成行：不补头部换行',
      value: 'hello\n/tra', start: 6, end: 10, token: '/translate',
      expected: 'hello\n/translate', caret: 16,
    },
  ])('$name', ({ value, start, end, token, expected, caret }) => {
    expect(insertChipToken(value, start, end, token)).toEqual({ value: expected, caret });
  });
});

describe('deleteChipAtCaret（Backspace 整删 chip）', () => {
  it('caret 恰在 token 行尾：删除整行（含尾部换行）', () => {
    const result = deleteChipAtCaret('/translate\nnext', [skillChip], 10);
    expect(result).toEqual({ value: 'next', caret: 0, removedChipId: skillChip.id });
  });

  it('token 行是最后一行：删除整行（含前导换行）', () => {
    const result = deleteChipAtCaret('hello\n/translate', [skillChip], 16);
    expect(result).toEqual({ value: 'hello', caret: 5, removedChipId: skillChip.id });
  });

  it('唯一一行：清空', () => {
    const result = deleteChipAtCaret('/translate', [skillChip], 10);
    expect(result).toEqual({ value: '', caret: 0, removedChipId: skillChip.id });
  });

  it.each([
    { name: 'caret 在 token 中间', value: '/translate', caret: 5 },
    { name: 'caret 不在 chip 行', value: 'next line', caret: 4 },
    { name: '行内容与 token 不完全相等（悬空 chip）', value: '/translatex', caret: 11 },
  ])('$name：返回 null 走默认 Backspace', ({ value, caret }) => {
    expect(deleteChipAtCaret(value, [skillChip], caret)).toBeNull();
  });
});

describe('serializeDraft（发送序列化）', () => {
  it('skill token 行剔除出 content；ref chip 投影为正文开头 @标题 行', () => {
    // ref chip 不进 textarea（卡片化），value 中只有 skill token 行与正文
    const value = `${skillChip.token}\n帮我翻译这段`;
    const draft = serializeDraft(value, [skillChip, sessionChip]);
    expect(draft).toEqual({
      content: '@调研记录\n帮我翻译这段',
      enforcedSkillIds: ['translate'],
      referencedSessionIds: ['s9'],
      assetIds: [],
    });
  });

  it('悬空 chip（token 行被手动改写）不参与发送', () => {
    const draft = serializeDraft('正文', [skillChip]);
    expect(draft.content).toBe('正文');
    expect(draft.enforcedSkillIds).toEqual([]);
  });

  it('重复载荷去重；chip-only 输入 content 为空（发送按钮应禁用）', () => {
    const dup = createChip({ kind: 'skill', token: '/translate', skillName: 'translate' });
    const draft = serializeDraft('/translate', [skillChip, dup]);
    expect(draft.enforcedSkillIds).toEqual(['translate']);
    expect(draft.content).toBe('');
  });

  it('@file chip 进 assetIds（plan A 管道消费），正文含投影行', () => {
    const draft = serializeDraft('看看这个', [fileChip]);
    expect(draft.assetIds).toEqual(['a1']);
    expect(draft.content).toBe('@报告.pdf\n看看这个');
  });

  it('ref chip 无 token 行也归集（卡片化后无悬空概念）；投影保序', () => {
    const file2 = createChip({ kind: 'file', token: '@笔记.md', assetId: 'a2' });
    const draft = serializeDraft('正文', [sessionChip, fileChip, file2]);
    expect(draft.referencedSessionIds).toEqual(['s9']);
    expect(draft.assetIds).toEqual(['a1', 'a2']);
    expect(draft.content).toBe('@调研记录\n@报告.pdf\n@笔记.md\n正文');
  });

  it('仅引用无正文：content 为投影行（可直接发送）', () => {
    const draft = serializeDraft('', [sessionChip]);
    expect(draft.content).toBe('@调研记录');
    expect(draft.referencedSessionIds).toEqual(['s9']);
  });
});

describe('annotateLines（overlay 渲染源）', () => {
  it('chip 行标记为 chip，其余原样；空行保高', () => {
    const lines = annotateLines('/translate\n\n正文', [skillChip]);
    expect(lines).toEqual([
      { type: 'chip', chip: skillChip },
      { type: 'text', text: '' },
      { type: 'text', text: '正文' },
    ]);
  });

  it('同名 token 只消费一次（与 serialize 口径一致）', () => {
    const lines = annotateLines('/translate\n/translate', [skillChip]);
    expect(lines.filter((l) => l.type === 'chip')).toHaveLength(1);
  });
});

describe('hasChipToken', () => {
  it('按 token 查重（插入去重依据）', () => {
    expect(hasChipToken([skillChip], '/translate')).toBe(true);
    expect(hasChipToken([skillChip], '/review')).toBe(false);
  });

describe('buildReferenceItems（@ 面板候选：两级 + 一级全局搜索）', () => {
  const refs: ReferenceCandidate[] = [
    { id: 's1', kind: 'session', title: '调研记录', subtitle: '12 条消息', token: '@调研记录', sessionId: 's1' },
    { id: 's2', kind: 'session', title: '长会话压测', subtitle: '122 条消息', token: '@长会话压测', sessionId: 's2' },
    { id: 'a1', kind: 'file', title: '报告.pdf', subtitle: '10 KB', token: '@报告.pdf', assetId: 'a1' },
  ];

  it('category 层空 query → 分类条目（带数量、无 chip）', () => {
    const items = buildReferenceItems('category', null, '', refs);
    expect(items.map((i) => [i.title, i.subtitle])).toEqual([
      ['会话', '2 个'],
      ['文件', '1 个'],
    ]);
    expect(items[0]!.category).toBe('session');
    expect(items[0]!.chip).toBeUndefined();
  });

  it('category 层非空 query → 全局扁平条目（不限类型、带 chip 载荷）', () => {
    const items = buildReferenceItems('category', null, '报', refs);
    // 过滤由调用方 filterCandidates 完成，此处返回全量扁平条目
    expect(items).toHaveLength(3);
    expect(items.every((i) => i.chip)).toBe(true);
    expect(items.map((i) => i.badge)).toEqual(['session', 'session', 'file']);
  });

  it('items 层 → 仅该分类条目', () => {
    const items = buildReferenceItems('items', 'session', '', refs);
    expect(items).toHaveLength(2);
    expect(items.every((i) => i.badge === 'session' && i.chip)).toBe(true);
  });

  it('items 层空分类 → 空数组（空态提示由组件渲染）', () => {
    expect(buildReferenceItems('items', 'file', '', [])).toEqual([]);
  });
});

describe('splitAfterChipToken（skill chip 行尾输入保护）', () => {
  const tokens = ['/translate'];

  it('行尾输入普通字符 → 拆行并保留字符', () => {
    expect(splitAfterChipToken('/translate', '/translate!', 11, tokens)).toEqual({
      value: '/translate\n!',
      caret: 12,
    });
  });

  it('行尾输入空格 → 仅换行（空格无意义被吞掉）', () => {
    expect(splitAfterChipToken('/translate', '/translate ', 11, tokens)).toEqual({
      value: '/translate\n',
      caret: 11,
    });
  });

  it('chip 在第二行：行尾输入同样拆行', () => {
    expect(splitAfterChipToken('hello\n/translate', 'hello\n/translate@', 17, tokens)).toEqual({
      value: 'hello\n/translate\n@',
      caret: 18,
    });
  });

  it('IME 组合输入（多字符插入块）同样拆行', () => {
    expect(splitAfterChipToken('/translate', '/translate你好', 12, tokens)).toEqual({
      value: '/translate\n你好',
      caret: 13,
    });
  });

  it.each([
    { name: 'token 行中间插入', prev: '/translate', next: '/transXlate', caret: 7 },
    { name: '非 chip 行', prev: 'hello', next: 'hello!', caret: 6 },
    { name: '删除（长度变短）', prev: '/translate', next: '/translat', caret: 9 },
    { name: '多行粘贴（插入块含换行）', prev: '/translate', next: '/translatea\nb', caret: 13 },
  ])('$name：返回 null 不干预', ({ prev, next, caret }) => {
    expect(splitAfterChipToken(prev, next, caret, tokens)).toBeNull();
  });
});
});
