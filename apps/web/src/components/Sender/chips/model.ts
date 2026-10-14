/**
 * 输入框 chip 模型（纯函数，无 React 依赖）。
 *
 * chip 在 textarea 中的承载是 token 整行：某行内容恰好等于 chip.token 时该行
 * 渲染为 chip（overlay），发送时剔除出 content 投影。段落边界约束（chip 独占
 * 一行）由 insertChipToken 的切行规则单向保证；用户手动改写 token 行会使
 * chip 悬空，序列化时自动剔除（fail-soft）。
 */

export type ChipKind = 'skill' | 'file' | 'session';

/** @ 引用分类（一级分类层的可选项；triggers 状态机与面板共用）。 */
export type ReferenceCategory = 'file' | 'session';

export interface InputChip {
  id: string;
  kind: ChipKind;
  /** textarea 中的整行承载文本（chip 行 = 内容恰好等于 token 的一行）。 */
  token: string;
  /** chip 展示文本。v1 = token 原文（保证 overlay 完整覆盖底层文本）。 */
  label: string;
  /** kind='skill'：skill 名（enforcedSkillIds 载荷）。 */
  skillName?: string;
  /** kind='file'：资产 id（assetIds 载荷，plan A 管道消费）。 */
  assetId?: string;
  /** kind='session'：目标会话 id（referencedSessionIds 载荷）。 */
  sessionId?: string;
}

/** 发送序列化结果（content 为剔除 chip 行后的纯文本投影）。 */
export interface SerializedDraft {
  content: string;
  enforcedSkillIds: string[];
  referencedSessionIds: string[];
  assetIds: string[];
}

/** / 命令面板条目（v1 仅 skill；kind 预留 'ui' | 'config' | 'plugin' 扩展位）。 */
export interface CommandEntry {
  id: string;
  label: string;
  description?: string;
  triggers?: string[];
  kind: 'skill';
}

/** @ 引用候选（@file 与 @会话 共用；token = '@' + 显示名）。 */
export interface ReferenceCandidate {
  id: string;
  kind: 'file' | 'session';
  title: string;
  subtitle?: string;
  token: string;
  assetId?: string;
  sessionId?: string;
}

/** 浮层面板条目（命令面板与引用选择器共用的渲染契约）。 */
export interface PaletteItem {
  key: string;
  /** 过滤匹配文本（skill 名 / 文件名 / 会话标题）。 */
  filterText: string;
  /** 主标题。 */
  title: string;
  /** 次要信息（description · triggers / 大小 / 消息数）。 */
  subtitle?: string;
  /** 类型徽标（'skill' | 'file' | 'session'）。 */
  badge: 'skill' | 'file' | 'session';
  /** 确认时插入的 chip（分类条目无 chip——确认行为是下钻二级）。 */
  chip?: InputChip;
  /** 分类条目载荷：@ 引用一级分类（仅 ReferencePicker 分类层使用）。 */
  category?: ReferenceCategory;
}

let chipSeq = 0;

/** 构造 chip（id 仅作 React key 与删除定位，无业务语义）。 */
export function createChip(init: Omit<InputChip, 'id' | 'label'>): InputChip {
  chipSeq += 1;
  return { ...init, id: `chip-${Date.now()}-${chipSeq}`, label: init.token };
}

/** token 查重（插入去重依据：同名 token 只允许一个 chip）。 */
export function hasChipToken(chips: InputChip[], token: string): boolean {
  return chips.some((c) => c.token === token);
}

/**
 * 确认候选后插入 chip：把 [start, end) 的触发文本替换为独占一行的 token。
 *
 * 切行规则（段落边界约束）：
 * - 前文去掉行尾空白后若还有内容且不在行首，补 `\n` 切开；
 * - 后文去掉行首空白后若还有内容且不在下一行行首，补 `\n` 切开。
 * 返回新 value 与建议 caret（token 行尾）。
 */
export function insertChipToken(
  value: string,
  start: number,
  end: number,
  token: string,
): { value: string; caret: number } {
  const trimmedBefore = value.slice(0, start).replace(/[ \t]+$/, '');
  const trimmedAfter = value.slice(end).replace(/^[ \t]+/, '');
  const leadingNewline =
    trimmedBefore.length > 0 && !trimmedBefore.endsWith('\n') ? '\n' : '';
  const trailingNewline =
    trimmedAfter.length > 0 && !trimmedAfter.startsWith('\n') ? '\n' : '';
  const nextValue = `${trimmedBefore}${leadingNewline}${token}${trailingNewline}${trimmedAfter}`;
  const caret = (trimmedBefore + leadingNewline + token).length;
  return { value: nextValue, caret };
}

/**
 * Backspace 整删 chip：caret 恰在某个 chip token 行尾（该行内容完全等于
 * token）时，一次删除整行（优先连带尾部换行，否则连带前导换行）。
 * 不满足条件返回 null（走浏览器默认 Backspace）。
 */
export function deleteChipAtCaret(
  value: string,
  chips: InputChip[],
  caret: number,
): { value: string; caret: number; removedChipId: string } | null {
  if (caret <= 0) return null;
  const lineStart = value.lastIndexOf('\n', caret - 1) + 1;
  const line = value.slice(lineStart, caret);
  const chip = chips.find((c) => c.token === line);
  if (!chip) return null;

  const lineEnd = value.indexOf('\n', caret);
  const realLineEnd = lineEnd === -1 ? value.length : lineEnd;
  // 行内容必须完全等于 token（段落边界未被破坏）
  if (value.slice(lineStart, realLineEnd) !== line) return null;

  let nextValue: string;
  if (lineEnd !== -1) {
    nextValue = value.slice(0, lineStart) + value.slice(lineEnd + 1);
  } else if (lineStart > 0) {
    nextValue = value.slice(0, lineStart - 1);
  } else {
    nextValue = '';
  }
  const nextCaret = lineStart > 0 ? lineStart - 1 : 0;
  return { value: nextValue, caret: nextCaret, removedChipId: chip.id };
}

export type AnnotatedLine =
  | { type: 'chip'; chip: InputChip }
  | { type: 'text'; text: string };

/**
 * 把 textarea 值按行标注：内容恰好等于某 chip token 的行标记为 chip
 * （同名 token 只消费一次），其余为文本行。overlay 渲染与序列化共用本口径。
 */
export function annotateLines(value: string, chips: InputChip[]): AnnotatedLine[] {
  const used = new Set<string>();
  return value.split('\n').map((line) => {
    const chip = chips.find((c) => c.token === line && !used.has(c.token));
    if (chip) {
      used.add(chip.token);
      return { type: 'chip' as const, chip };
    }
    return { type: 'text' as const, text: line };
  });
}

/** 发送序列化：chip 行剔除出 content 投影；有效 chip 按类别归集（去重）。 */
export function serializeDraft(value: string, chips: InputChip[]): SerializedDraft {
  const kept = annotateLines(value, chips)
    .filter((line): line is { type: 'text'; text: string } => line.type === 'text')
    .map((line) => line.text);

  const enforcedSkillIds = new Set<string>();
  const referencedSessionIds = new Set<string>();
  const assetIds = new Set<string>();
  for (const chip of chips) {
    // 悬空 chip（token 行不存在或已被改写）不参与发送
    if (!value.split('\n').includes(chip.token)) continue;
    if (chip.kind === 'skill' && chip.skillName) enforcedSkillIds.add(chip.skillName);
    if (chip.kind === 'session' && chip.sessionId) referencedSessionIds.add(chip.sessionId);
    if (chip.kind === 'file' && chip.assetId) assetIds.add(chip.assetId);
  }

  return {
    content: kept.join('\n').trim(),
    enforcedSkillIds: [...enforcedSkillIds],
    referencedSessionIds: [...referencedSessionIds],
    assetIds: [...assetIds],
  };
}
