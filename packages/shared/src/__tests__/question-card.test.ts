import { describe, it, expect } from 'vitest';
import type {
  QuestionCardSpec,
  QuestionCardAnswer,
  QuestionAnswerEntry,
} from '../question-card';
import { QUESTION_CARD_LIMITS, ASK_USER_TIMEOUT_CONFIG_KEY } from '../question-card';

describe('question-card shared types', () => {
  it('QUESTION_CARD_LIMITS 暴露全部上限字段', () => {
    expect(QUESTION_CARD_LIMITS.maxQuestions).toBe(4);
    expect(QUESTION_CARD_LIMITS.minQuestions).toBe(1);
    expect(QUESTION_CARD_LIMITS.minOptions).toBe(2);
    expect(QUESTION_CARD_LIMITS.maxOptions).toBe(6);
    expect(QUESTION_CARD_LIMITS.maxCustomTextChars).toBe(2000);
  });

  it('ASK_USER_TIMEOUT_CONFIG_KEY 为设置存储键', () => {
    expect(ASK_USER_TIMEOUT_CONFIG_KEY).toBe('ask_user_timeout_ms');
  });

  it('QuestionCardSpec 多题形状（single + multiple + 自定义选项）', () => {
    const spec: QuestionCardSpec = {
      questions: [
        {
          question: '使用哪个数据库？',
          mode: 'single',
          options: ['PostgreSQL', 'SQLite'],
          allowCustomOption: true,
        },
        {
          question: '需要哪些导出格式？',
          description: '可多选',
          mode: 'multiple',
          options: ['CSV', 'JSON'],
          optionDescriptions: ['逗号分隔', '通用交换格式'],
          customOptionLabel: '其他格式',
        },
      ],
    };
    expect(spec.questions).toHaveLength(2);
    expect(spec.questions[0]!.mode).toBe('single');
    expect(spec.questions[1]!.allowCustomOption).toBeUndefined();
  });

  it('QuestionCardAnswer answered 形状（含自定义文本）', () => {
    const entry: QuestionAnswerEntry = {
      index: 1,
      status: 'answered',
      selections: ['其他格式'],
      customText: 'YAML',
    };
    const answer: QuestionCardAnswer = {
      status: 'answered',
      answers: [entry],
      answeredAt: '2026-10-31T00:00:00.000Z',
    };
    expect(answer.answers[0]!.customText).toBe('YAML');
  });

  it('QuestionCardAnswer expired/cancelled 形状（空 answers）', () => {
    const expired: QuestionCardAnswer = { status: 'expired', answers: [] };
    const cancelled: QuestionCardAnswer = { status: 'cancelled', answers: [] };
    expect(expired.answers).toHaveLength(0);
    expect(cancelled.status).toBe('cancelled');
  });

  it('QuestionCardAnswer skipped 形状（逐题 skipped）', () => {
    const skipped: QuestionCardAnswer = {
      status: 'skipped',
      answers: [
        { index: 0, status: 'skipped', selections: [] },
        { index: 1, status: 'skipped', selections: [] },
      ],
    };
    expect(skipped.answers.every((a) => a.status === 'skipped')).toBe(true);
  });
});
