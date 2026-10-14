import { describe, it, expect } from 'vitest';
import {
  annotateLines,
  createChip,
  deleteChipAtCaret,
  hasChipToken,
  insertChipToken,
  serializeDraft,
} from './model';

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
  it('chip 行剔除出 content；三类载荷归集', () => {
    const value = `${skillChip.token}\n帮我翻译这段\n${sessionChip.token}`;
    const draft = serializeDraft(value, [skillChip, sessionChip]);
    expect(draft).toEqual({
      content: '帮我翻译这段',
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

  it('@file chip 进 assetIds（plan A 管道消费）', () => {
    const draft = serializeDraft('@报告.pdf\n看看这个', [fileChip]);
    expect(draft.assetIds).toEqual(['a1']);
    expect(draft.content).toBe('看看这个');
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
});
