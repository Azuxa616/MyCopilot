// parse.ts — ask_user 工具调用参数 → QuestionCardSpec 的防御性解析。
//
// arguments 是流式/持久化的 JSON 字符串；生成中可能为空或残缺，模型输出
// 也可能形状漂移。解析失败返回 null，调用方（AgentTimeline）据此回退到
// 通用工具行渲染。

import type { QuestionCardSpec, QuestionCardQuestion } from '@my-copilot/shared'
import { QUESTION_CARD_LIMITS } from '@my-copilot/shared'

/** 最小形状校验（不做服务端级完备校验，只保证可安全渲染）。 */
function isQuestionLike(value: unknown): value is QuestionCardQuestion {
  if (typeof value !== 'object' || value === null) return false
  const q = value as Record<string, unknown>
  return (
    typeof q.question === 'string' &&
    (q.mode === 'single' || q.mode === 'multiple') &&
    Array.isArray(q.options) &&
    q.options.length >= QUESTION_CARD_LIMITS.minOptions &&
    q.options.every((o) => typeof o === 'string')
  )
}

/**
 * 解析 ask_user 工具调用参数；任何失败（空串、非法 JSON、questions 非数组、
 * 题目形状不合规）返回 null。
 */
export function parseQuestionCardSpec(raw: string | undefined | null): QuestionCardSpec | null {
  if (!raw || raw.trim().length === 0) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const { questions } = parsed as Record<string, unknown>
    if (
      !Array.isArray(questions) ||
      questions.length < QUESTION_CARD_LIMITS.minQuestions ||
      questions.length > QUESTION_CARD_LIMITS.maxQuestions ||
      !questions.every(isQuestionLike)
    ) {
      return null
    }
    return { questions: questions as QuestionCardQuestion[] }
  } catch {
    return null
  }
}

/**
 * 解析 ask_user 工具结果（role='tool' 消息 content）→ QuestionCardAnswer；
 * 形状不合规（含普通文本结果、错误结果）返回 null。
 */
export function parseQuestionCardAnswer(raw: string | undefined | null):
  | import('@my-copilot/shared').QuestionCardAnswer
  | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    // 新格式：tool 结果是 content parts 数组 [{type:'text',text:'...'}]
    if (Array.isArray(parsed)) {
      const textPart = parsed.find((p: unknown) => (p as Record<string, unknown>)?.type === 'text')
      if (!textPart || typeof (textPart as Record<string, unknown>).text !== 'string') return null
      return parseQuestionCardAnswer((textPart as Record<string, unknown>).text as string)
    }
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !['answered', 'skipped', 'expired', 'cancelled'].includes((parsed as Record<string, unknown>).status as string) ||
      !Array.isArray((parsed as Record<string, unknown>).answers)
    ) {
      return null
    }
    return parsed as unknown as import('@my-copilot/shared').QuestionCardAnswer
  } catch {
    return null
  }
}
