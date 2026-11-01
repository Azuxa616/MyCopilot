import { createHash } from 'node:crypto';
import type { QuestionCardQuestion, QuestionCardSpec } from '@my-copilot/shared';
import { QUESTION_CARD_LIMITS } from '@my-copilot/shared';
import type { ToolExecutor } from '../registry.js';
import { requestUserQuestion } from '../confirmation.js';
import { builtinTool, errorResult, textResult } from './helpers.js';

const QUESTION_SHAPE = '{question: string, description?: string, mode: "single"|"multiple", options: string[2..6], optionDescriptions?: string[] (same length), allowCustomOption?: boolean, customOptionLabel?: string}';

export const askUserExecutor: ToolExecutor = {
  describe: () => builtinTool({
    id: 'ask-user',
    name: 'ask_user',
    description: 'Use when the user must choose between clear options, clarify ambiguity, or state preferences. Do NOT use for open-ended questions. The run PAUSES until the user answers. Answers arrive as tool result JSON {status, answers:[{index,status,selections,customText?}], answeredAt}.',
    fields: [{
      name: 'questions',
      type: 'array',
      required: true,
      description: `Array of 1..4 question objects ${QUESTION_SHAPE}`,
    }],
  }),
  async execute(args, context) {
    let spec: QuestionCardSpec;
    try {
      spec = parseQuestionCardSpec(args.questions);
    } catch (error) {
      return errorResult(error instanceof Error ? error.message : String(error));
    }
    if (!context.onConfirmationRequired) {
      return errorResult('问答卡片需要可用的用户交互通道。');
    }
    const argumentsJson = JSON.stringify(spec);
    const tool = context.advertisedTool ?? askUserExecutor.describe();
    const toolCallId = context.toolCallId ?? `${context.sessionId}:ask_user`;
    const payload = await requestUserQuestion({
      approval: {
        runId: context.runId ?? `${context.sessionId}:${toolCallId}`,
        jobId: context.jobId ?? null,
        sessionId: context.sessionId,
        agentId: context.agentId ?? 'default',
        tool: {
          id: tool.id,
          name: tool.name,
          source: 'built-in',
          sourceMcpId: tool.sourceMcpId,
          policyVersion: tool.policyVersion,
        },
        toolCallId,
        arguments: argumentsJson,
        argumentsDigest: createHash('sha256').update(argumentsJson).digest('hex'),
        resourceScope: 'tool',
        safetyLevel: 'safe',
        policyVersion: tool.policyVersion,
      },
      signal: context.signal,
      onRequired: context.onConfirmationRequired,
      onSettled: context.onConfirmationSettled,
    });
    return textResult(payload);
  },
};

export function parseQuestionCardSpec(value: unknown): QuestionCardSpec {
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      throw new Error('questions 必须是有效的 JSON 数组。');
    }
  }
  if (!Array.isArray(parsed) || parsed.length < QUESTION_CARD_LIMITS.minQuestions || parsed.length > QUESTION_CARD_LIMITS.maxQuestions) {
    throw new Error(`questions 必须包含 ${QUESTION_CARD_LIMITS.minQuestions}..${QUESTION_CARD_LIMITS.maxQuestions} 道题。`);
  }
  return { questions: parsed.map(parseQuestion) };
}

function parseQuestion(value: unknown, index: number): QuestionCardQuestion {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`第 ${index + 1} 题必须是对象。`);
  }
  const question = value as Record<string, unknown>;
  const text = question.question;
  if (typeof text !== 'string' || text.trim().length === 0 || text.length > QUESTION_CARD_LIMITS.maxQuestionChars) {
    throw new Error(`第 ${index + 1} 题 question 必须非空且不超过 ${QUESTION_CARD_LIMITS.maxQuestionChars} 字符。`);
  }
  const description = question.description;
  if (description !== undefined && (typeof description !== 'string' || description.length > QUESTION_CARD_LIMITS.maxDescriptionChars)) {
    throw new Error(`第 ${index + 1} 题 description 不能超过 ${QUESTION_CARD_LIMITS.maxDescriptionChars} 字符。`);
  }
  const mode = question.mode;
  if (mode !== 'single' && mode !== 'multiple') {
    throw new Error(`第 ${index + 1} 题 mode 必须是 single 或 multiple。`);
  }
  const options = question.options;
  if (!Array.isArray(options) || options.length < QUESTION_CARD_LIMITS.minOptions || options.length > QUESTION_CARD_LIMITS.maxOptions || options.some(option => typeof option !== 'string' || option.trim().length === 0 || option.length > QUESTION_CARD_LIMITS.maxOptionChars) || new Set(options).size !== options.length) {
    throw new Error(`第 ${index + 1} 题 options 必须是 ${QUESTION_CARD_LIMITS.minOptions}..${QUESTION_CARD_LIMITS.maxOptions} 个唯一、非空且不超过 ${QUESTION_CARD_LIMITS.maxOptionChars} 字符的字符串。`);
  }
  const optionDescriptions = question.optionDescriptions;
  if (optionDescriptions !== undefined && (!Array.isArray(optionDescriptions) || optionDescriptions.length !== options.length || optionDescriptions.some(item => typeof item !== 'string' || item.trim().length === 0 || item.length > QUESTION_CARD_LIMITS.maxOptionDescriptionChars))) {
    throw new Error(`第 ${index + 1} 题 optionDescriptions 必须与 options 等长，且每项非空、不超过 ${QUESTION_CARD_LIMITS.maxOptionDescriptionChars} 字符。`);
  }
  const allowCustomOption = question.allowCustomOption;
  if (allowCustomOption !== undefined && typeof allowCustomOption !== 'boolean') {
    throw new Error(`第 ${index + 1} 题 allowCustomOption 必须是布尔值。`);
  }
  const customOptionLabel = question.customOptionLabel;
  if (customOptionLabel !== undefined && (typeof customOptionLabel !== 'string' || customOptionLabel.trim().length === 0 || customOptionLabel.length > QUESTION_CARD_LIMITS.maxCustomLabelChars)) {
    throw new Error(`第 ${index + 1} 题 customOptionLabel 必须非空且不超过 ${QUESTION_CARD_LIMITS.maxCustomLabelChars} 字符。`);
  }
  return {
    question: text,
    ...(description === undefined ? {} : { description }),
    mode,
    options: options as string[],
    ...(optionDescriptions === undefined ? {} : { optionDescriptions: optionDescriptions as string[] }),
    ...(allowCustomOption === undefined ? {} : { allowCustomOption }),
    ...(customOptionLabel === undefined ? {} : { customOptionLabel }),
  };
}
