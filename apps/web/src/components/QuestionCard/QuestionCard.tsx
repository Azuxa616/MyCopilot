// QuestionCard - ask_user 问答卡片（时间线内嵌交互组件）。
//
// 数据：ask_user 工具调用 arguments 的 QuestionCardSpec JSON（由 AgentTimeline
// 的条目解析后传入），回答持久化为 role='tool' 消息（QuestionCardAnswer JSON）。
// 视觉状态机：generating（参数未到齐）→ interactive（挂起待答）→ submitting →
// answered / skipped（只读回放）或 expired / cancelled / stale（失效态）。
// 设计：docs/2026-10-31-question-card-design.md §5/§6/§7。
//
// 安全约束：纯文本渲染——选项、问题、自定义文本一律作为 React 文本节点输出，
// 绝不使用 dangerouslySetInnerHTML / markdown 渲染。

import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  QuestionCardSpec,
  QuestionCardQuestion,
  QuestionCardAnswer,
  QuestionAnswerEntry,
} from '@my-copilot/shared'
import { QUESTION_CARD_LIMITS } from '@my-copilot/shared'

/** 卡片的渲染状态（由 AgentTimeline 依据条目/挂起态推导）。 */
export type QuestionCardState =
  | 'generating'
  | 'interactive'
  | 'submitting'
  | 'answered'
  | 'skipped'
  | 'expired'
  | 'cancelled'
  | 'stale'

export interface QuestionCardProps {
  spec: QuestionCardSpec
  /** 服务端回填的最终回答（expired/cancelled 时 answers 为空数组）。 */
  answer?: QuestionCardAnswer | null
  state: QuestionCardState
  /** 提交整卡回答（每题一条 QuestionAnswerEntry，status='answered'）。 */
  onSubmit: (answer: { status: 'answered'; answers: QuestionAnswerEntry[] }) => void
  /** 跳过整卡（载荷由父级组装：全部题 status='skipped'）。 */
  onSkip: () => void
  /** 外部提交进行中（禁用全部控件）。 */
  submitting?: boolean
  /** 挂起超时时间戳（ms）；0/undefined = 无超时，不显示倒计时。 */
  expiresAt?: number
}

/** 「其他」选项的内部标记值：与选项 label 同处 selections 数组。 */
function customLabelOf(q: QuestionCardQuestion): string {
  return q.customOptionLabel ?? '其他'
}

function isCustomSelected(q: QuestionCardQuestion, selections: string[]): boolean {
  return q.allowCustomOption === true && selections.includes(customLabelOf(q))
}

/** 倒计时（interactive + expiresAt>0 时显示）；每秒刷新，到达 0 显示已超时。 */
function Countdown({ expiresAt }: { expiresAt: number }) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  const remaining = Math.max(0, Math.floor((expiresAt - now) / 1000))
  const mm = String(Math.floor(remaining / 60)).padStart(2, '0')
  const ss = String(remaining % 60).padStart(2, '0')
  const expired = remaining === 0

  return (
    <span
      className={`text-xs font-mono ${expired ? 'text-warning-dark' : 'text-text-tertiary'}`}
      role="timer"
      aria-label={expired ? '已超过回答时限' : `剩余回答时间 ${mm} 分 ${ss} 秒`}
    >
      {expired ? '已超时' : `剩余回答时间 ${mm}:${ss}`}
    </span>
  )
}

/** 单题渲染（interactive 可交互 / answered 只读高亮共用布局）。 */
function QuestionItem({
  question,
  index,
  selections,
  customText,
  readOnly,
  interactive,
  onToggle,
  onCustomTextChange,
}: {
  question: QuestionCardQuestion
  index: number
  selections: string[]
  customText: string
  readOnly: boolean
  interactive: boolean
  onToggle?: (label: string) => void
  onCustomTextChange?: (text: string) => void
}) {
  const customLabel = customLabelOf(question)
  const customSelected = isCustomSelected(question, selections)
  const customInputRef = useRef<HTMLInputElement>(null)
  // 切换自定义选项后聚焦输入框；无内容或未选中时不产生副作用。
  useEffect(() => {
    if (interactive && customSelected) customInputRef.current?.focus()
  }, [interactive, customSelected])

  const groupRole = question.mode === 'single' ? 'radiogroup' : 'group'
  const groupName = `question-card-q${index}`

  return (
    <fieldset
      className="flex flex-col gap-1.5 rounded-lg border border-border-light bg-bg-primary/60 p-3"
      aria-label={`第 ${index + 1} 题：${question.question}`}
    >
      <legend className="sr-only">{question.question}</legend>
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-text-primary">
          {index + 1}. {question.question}
        </span>
        {question.description && (
          <span className="text-xs text-text-tertiary">{question.description}</span>
        )}
      </div>

      <div role={groupRole} aria-label={question.question} className="flex flex-col gap-1">
        {question.options.map((option, oi) => {
          const selected = selections.includes(option)
          const highlighted = readOnly && selected
          const inputId = `${groupName}-opt-${oi}`
          return (
            <label
              key={option}
              htmlFor={inputId}
              className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors ${
                highlighted
                  ? 'border border-primary-200 bg-primary-50 font-medium text-primary-700'
                  : readOnly
                    ? 'text-text-secondary'
                    : 'cursor-pointer hover:bg-bg-hover/60 text-text-primary'
              }`}
            >
              <input
                id={inputId}
                type={question.mode === 'single' ? 'radio' : 'checkbox'}
                name={groupName}
                checked={selected}
                disabled={readOnly}
                onChange={() => onToggle?.(option)}
                className="accent-primary-500 shrink-0"
              />
              <span className="min-w-0 break-words">{option}</span>
              {question.optionDescriptions?.[oi] && (
                <span className="text-xs text-text-tertiary ml-1">
                  {question.optionDescriptions[oi]}
                </span>
              )}
            </label>
          )
        })}

        {question.allowCustomOption && (
          <div className="flex flex-col gap-1">
            <label
              htmlFor={`${groupName}-custom`}
              className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors ${
                readOnly && customSelected
                  ? 'border border-primary-200 bg-primary-50 font-medium text-primary-700'
                  : readOnly
                    ? 'text-text-secondary'
                    : 'cursor-pointer hover:bg-bg-hover/60 text-text-primary'
              }`}
            >
              <input
                id={`${groupName}-custom`}
                type={question.mode === 'single' ? 'radio' : 'checkbox'}
                name={groupName}
                checked={customSelected}
                disabled={readOnly}
                onChange={() => onToggle?.(customLabel)}
                className="accent-primary-500 shrink-0"
              />
              <span className="min-w-0 break-words">{customLabel}</span>
            </label>
            {(customSelected || (readOnly && customText.length > 0)) && (
              <>
              <span className="ml-6 text-xs text-text-tertiary">{customLabel}：{readOnly ? customText : ''}</span>
              <input
                ref={customInputRef}
                type="text"
                value={customText}
                disabled={readOnly}
                maxLength={QUESTION_CARD_LIMITS.maxCustomTextChars}
                placeholder="请输入你的答案…"
                aria-label={`${customLabel}（必填）`}
                onChange={(e) => onCustomTextChange?.(e.target.value)}
                className="w-full rounded-md border border-border-base bg-bg-elevated px-2.5 py-1.5 text-sm text-text-primary placeholder:text-text-disabled focus:border-primary-400 focus:outline-none disabled:opacity-60"
              />
              </>
            )}
          </div>
        )}
      </div>
    </fieldset>
  )
}

/**
 * 问答卡片。纯受控组件：选择状态由内部 useState 维护（提交时组装载荷上抛），
 * 提交/跳过经由父级回调落到 sessionStore.submitQuestionAnswer。
 */
export default function QuestionCard({
  spec,
  answer,
  state,
  onSubmit,
  onSkip,
  submitting = false,
  expiresAt = 0,
}: QuestionCardProps) {
  const questions = spec.questions
  const [selections, setSelections] = useState<string[][]>(() => questions.map(() => []))
  const [customTexts, setCustomTexts] = useState<string[]>(() => questions.map(() => ''))

  const interactive = state === 'interactive' && !submitting

  // 提交校验：每题 ≥1 项选择；选了「其他」的题必须填写非空 customText。
  const canSubmit = useMemo(() => {
    return questions.every((q, i) => {
      if (selections[i]?.length === 0) return false
      if (isCustomSelected(q, selections[i] ?? []) && (customTexts[i] ?? '').trim().length === 0) return false
      return true
    })
  }, [questions, selections, customTexts])

  const toggleOption = (qi: number, label: string) => {
    const q = questions[qi]
    setSelections((prev) => prev.map((sel, i) => {
      if (i !== qi) return sel
      if (q.mode === 'single') return [label]
      return sel.includes(label) ? sel.filter((s) => s !== label) : [...sel, label]
    }))
  }

  const handleSubmit = () => {
    if (!canSubmit || submitting) return
    onSubmit({
      status: 'answered',
      answers: questions.map((q, i) => ({
        index: i,
        status: 'answered' as const,
        selections: selections[i] ?? [],
        ...(isCustomSelected(q, selections[i] ?? []) ? { customText: (customTexts[i] ?? '').trim() } : {}),
      })),
    })
  }

  // ── generating：参数未到齐的骨架 ──
  if (state === 'generating') {
    return (
      <div
        className="flex flex-col gap-2 rounded-lg border border-primary-200 bg-bg-primary/60 p-4"
        role="status"
        aria-label="正在生成问题卡片"
      >
        <span className="flex items-center gap-2 text-sm text-text-tertiary">
          <span className="inline-block w-3 h-3 border-2 border-primary-400 border-t-transparent rounded-full animate-spin shrink-0" aria-hidden />
          正在生成问题卡片…
        </span>
        <div className="h-3 w-3/4 rounded bg-bg-tertiary animate-pulse" aria-hidden />
        <div className="h-3 w-1/2 rounded bg-bg-tertiary animate-pulse" aria-hidden />
      </div>
    )
  }

  // ── 失效态：expired / cancelled / stale ──
  if (state === 'expired' || state === 'cancelled' || state === 'stale') {
    return (
      <div
        className="flex items-center gap-2 rounded-lg border border-border-light bg-bg-tertiary/60 px-3 py-2.5 text-sm text-text-tertiary"
        role="note"
        aria-label={state === 'expired' ? '提问已超时' : '提问未获得回答'}
      >
        <span aria-hidden>💬</span>
        {state === 'expired' ? '该提问已超时，未获得回答' : '该提问未获得回答'}
      </div>
    )
  }

  // ── skipped：只读摘要 ──
  if (state === 'skipped') {
    return (
      <div
        className="flex items-center gap-2 rounded-lg border border-border-light bg-bg-secondary/60 px-3 py-2.5 text-sm text-text-secondary"
        role="note"
        aria-label="已跳过提问"
      >
        <span aria-hidden>💬</span>
        已跳过本次提问
        {answer?.answeredAt && (
          <span className="ml-auto text-xs text-text-tertiary font-mono">
            {new Date(answer.answeredAt).toLocaleString()}
          </span>
        )}
      </div>
    )
  }

  // ── answered：只读回放（选中项高亮 + customText + answeredAt）──
  if (state === 'answered' && answer) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-primary-200 bg-bg-primary/60 p-3">
        <div className="flex flex-col gap-2">
          {questions.map((q, i) => {
            const entry = answer.answers.find((a) => a.index === i)
            return (
              <QuestionItem
                key={i}
                question={q}
                index={i}
                selections={entry?.selections ?? []}
                customText={entry?.customText ?? ''}
                readOnly
                interactive={false}
              />
            )
          })}
        </div>
        {answer.answeredAt && (
          <span className="self-end text-xs text-text-tertiary font-mono">
            {new Date(answer.answeredAt).toLocaleString()}
          </span>
        )}
      </div>
    )
  }

  // ── interactive / submitting ──
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-primary-200 bg-bg-primary/60 p-3">
      {questions.map((q, i) => (
        <QuestionItem
          key={i}
          question={q}
          index={i}
          selections={selections[i] ?? []}
          customText={customTexts[i] ?? ''}
          readOnly={!interactive}
          interactive={interactive}
          onToggle={(label) => toggleOption(i, label)}
          onCustomTextChange={(text) =>
            setCustomTexts((prev) => prev.map((t, j) => (j === i ? text : t)))
          }
        />
      ))}

      <div className="flex items-center justify-between gap-3 border-t border-border-light pt-2.5">
        {expiresAt > 0 ? (
          <Countdown expiresAt={expiresAt} />
        ) : (
          <span className="text-xs text-text-tertiary">等待你的回答</span>
        )}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onSkip}
            disabled={!interactive}
            className="px-3 py-1.5 text-sm text-text-primary bg-bg-secondary border border-border-base rounded-lg hover:bg-bg-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            跳过回答
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!interactive || !canSubmit}
            className="px-4 py-1.5 text-sm text-white bg-primary-500 hover:bg-primary-600 rounded-lg transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? '提交中…' : '提交回答'}
          </button>
        </div>
      </div>
    </div>
  )
}
