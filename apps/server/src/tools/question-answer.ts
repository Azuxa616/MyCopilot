import type { QuestionAnswerEntry, QuestionCardAnswer, QuestionCardSpec } from '@my-copilot/shared';
import { QUESTION_CARD_LIMITS } from '@my-copilot/shared';
import { parseQuestionCardSpec } from './builtins/ask-user.js';

export function normalizeQuestionAnswer(argumentsJson: string, value: unknown): QuestionCardAnswer {
  let rawSpec: unknown;
  try {
    rawSpec = JSON.parse(argumentsJson) as unknown;
  } catch {
    throw new Error('问题卡片参数不是有效 JSON。');
  }
  const spec: QuestionCardSpec = parseQuestionCardSpec(
    typeof rawSpec === 'object' && rawSpec !== null && 'questions' in rawSpec ? rawSpec.questions : undefined,
  );
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('answer 必须是对象。');
  }
  const answer = value as Record<string, unknown>;
  if (answer.status !== 'answered' && answer.status !== 'skipped') {
    throw new Error('answer.status 必须是 answered 或 skipped。');
  }
  if (!Array.isArray(answer.answers)) throw new Error('answer.answers 必须是数组。');
  const entries = answer.answers.map(entry => normalizeEntry(entry, spec));
  if (entries.some(entry => entry.status !== answer.status)) {
    throw new Error('每道题的状态必须与整卡状态一致。');
  }
  const indexes = entries.map(entry => entry.index).sort((a, b) => a - b);
  if (indexes.length !== spec.questions.length || indexes.some((index, position) => index !== position)) {
    throw new Error('每道题必须且只能回答一次。');
  }
  const ordered = spec.questions.map((_, index) => entries.find(entry => entry.index === index));
  return {
    status: answer.status,
    answers: ordered.filter((entry): entry is QuestionAnswerEntry => entry !== undefined),
    answeredAt: new Date().toISOString(),
  };
}

function normalizeEntry(value: unknown, spec: QuestionCardSpec): QuestionAnswerEntry {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('回答项必须是对象。');
  const entry = value as Record<string, unknown>;
  if (typeof entry.index !== 'number' || !Number.isInteger(entry.index) || entry.index < 0 || entry.index >= spec.questions.length) {
    throw new Error('回答项 index 无效。');
  }
  if (entry.status !== 'answered' && entry.status !== 'skipped') throw new Error('回答项 status 无效。');
  if (!Array.isArray(entry.selections) || entry.selections.some(selection => typeof selection !== 'string')) {
    throw new Error('selections 必须是字符串数组。');
  }
  const question = spec.questions[entry.index];
  if (!question) throw new Error('回答项 index 无效。');
  const customLabel = question.customOptionLabel ?? '其他';
  const customAllowed = question.allowCustomOption === true;
  if (entry.status === 'skipped') {
    if (entry.selections.length !== 0) throw new Error('跳过的题目 selections 必须为空。');
    return { index: entry.index, status: 'skipped', selections: [] };
  }
  if (entry.selections.length === 0) throw new Error('已回答的题目 selections 不能为空。');
  if (question.mode === 'single' && entry.selections.length > 1) throw new Error('单选题只能选择一个选项。');
  const selections = entry.selections as string[];
  if (selections.some(selection => !question.options.includes(selection) && !(customAllowed && selection === customLabel))) {
    throw new Error('selections 包含不在问题选项中的值。');
  }
  const hasCustom = selections.includes(customLabel) && customAllowed;
  if (hasCustom && (typeof entry.customText !== 'string' || entry.customText.trim().length === 0 || entry.customText.length > QUESTION_CARD_LIMITS.maxCustomTextChars)) {
    throw new Error(`选择自定义选项时 customText 必须非空且不超过 ${QUESTION_CARD_LIMITS.maxCustomTextChars} 字符。`);
  }
  return {
    index: entry.index,
    status: 'answered',
    selections,
    ...(hasCustom ? { customText: entry.customText as string } : {}),
  };
}
