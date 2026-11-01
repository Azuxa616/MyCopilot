// QuestionCard.test.tsx — 问答卡片交互与状态渲染测试。

import { describe, it, expect, vi } from 'vitest'
import { fireEvent, act } from '@testing-library/react'
import { createRoot } from 'react-dom/client'
import { screen } from '@testing-library/react'

import QuestionCard, { parseQuestionCardSpec, parseQuestionCardAnswer } from './index'
import type { QuestionCardSpec, QuestionCardAnswer } from '@my-copilot/shared'

// React 19 requires this flag for act() to work correctly.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const singleSpec: QuestionCardSpec = {
  questions: [
    {
      question: '使用哪个方案？',
      description: '请选择实现路径',
      mode: 'single',
      options: ['方案 A', '方案 B'],
    },
  ],
}

const multiSpec: QuestionCardSpec = {
  questions: [
    {
      question: '需要哪些能力？',
      mode: 'multiple',
      options: ['导出', '搜索'],
      allowCustomOption: true,
      customOptionLabel: '其他想法',
    },
  ],
}

function renderCard(props: Partial<Parameters<typeof QuestionCard>[0]> = {}) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const onSubmit = props.onSubmit ?? vi.fn()
  const onSkip = props.onSkip ?? vi.fn()
  act(() => {
    root.render(
      <QuestionCard
        spec={props.spec ?? singleSpec}
        state={props.state ?? 'interactive'}
        onSubmit={onSubmit}
        onSkip={onSkip}
        submitting={props.submitting}
        answer={props.answer}
        expiresAt={props.expiresAt}
      />,
    )
  })
  return {
    container,
    onSubmit,
    onSkip,
    unmount: () => {
      act(() => root.unmount())
      container.remove()
    },
  }
}

/** 以 label 文本定位一行选项的可点击 label 元素。 */
function optionRow(text: string): HTMLLabelElement {
  const span = screen.getByText(text, { exact: false })
  return span.closest('label') as HTMLLabelElement
}

describe('parse', () => {
  it('parseQuestionCardSpec：合法 spec 解析成功', () => {
    expect(parseQuestionCardSpec(JSON.stringify(singleSpec))).toEqual(singleSpec)
  })

  it('parseQuestionCardSpec：空串/残缺 JSON/形状漂移返回 null', () => {
    expect(parseQuestionCardSpec('')).toBeNull()
    expect(parseQuestionCardSpec('{"questions":')).toBeNull()
    expect(parseQuestionCardSpec('{"foo":1}')).toBeNull()
    expect(parseQuestionCardSpec('{"questions":[{"question":"q","mode":"single","options":["仅一项"]}]}')).toBeNull()
  })

  it('parseQuestionCardAnswer：合法回答解析成功，普通文本结果返回 null', () => {
    const answer: QuestionCardAnswer = {
      status: 'answered',
      answers: [{ index: 0, status: 'answered', selections: ['方案 A'] }],
      answeredAt: '2026-10-31T10:00:00.000Z',
    }
    expect(parseQuestionCardAnswer(JSON.stringify(answer))).toEqual(answer)
    expect(parseQuestionCardAnswer('普通文本结果')).toBeNull()
  })

  it('parseQuestionCardAnswer：content parts 数组格式（tool 消息持久化）', () => {
    const parts = JSON.stringify([
      { type: 'text', text: JSON.stringify({ status: 'answered', answers: [{ index: 0, status: 'answered', selections: ['A'] }] }) },
    ]);
    const parsed = parseQuestionCardAnswer(parts);
    expect(parsed?.status).toBe('answered');
    expect(parsed?.answers[0]?.selections).toEqual(['A']);
  })
})

describe('QuestionCard interactive', () => {
  it('单选：选中选项后提交，载荷为逐题 answered entries', () => {
    const { container, onSubmit, unmount } = renderCard()
    expect(container.textContent).toContain('使用哪个方案？')
    expect((screen.getByRole('button', { name: '提交回答' }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(optionRow('方案 B'))
    expect((screen.getByRole('button', { name: '提交回答' }) as HTMLButtonElement).disabled).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: '提交回答' }))
    expect(onSubmit).toHaveBeenCalledWith({
      status: 'answered',
      answers: [{ index: 0, status: 'answered', selections: ['方案 B'] }],
    })
    unmount()
  })

  it('多选：可勾选多项，一次提交携带全部选择', () => {
    const { onSubmit, unmount } = renderCard({ spec: multiSpec })
    fireEvent.click(optionRow('导出'))
    fireEvent.click(optionRow('搜索'))
    fireEvent.click(screen.getByRole('button', { name: '提交回答' }))
    expect(onSubmit).toHaveBeenCalledWith({
      status: 'answered',
      answers: [{ index: 0, status: 'answered', selections: ['导出', '搜索'] }],
    })
    unmount()
  })

  it('自定义选项：选中后必填文本，空文本阻止提交，填写后随载荷携带 customText', () => {
    const { onSubmit, unmount } = renderCard({ spec: multiSpec })
    fireEvent.click(optionRow('其他想法'))
    // 空文本 → 提交禁用（必答校验）
    expect((screen.getByRole('button', { name: '提交回答' }) as HTMLButtonElement).disabled).toBe(true)

    const input = screen.getByLabelText('其他想法（必填）') as HTMLInputElement
    fireEvent.change(input, { target: { value: '支持暗色主题' } })
    expect((screen.getByRole('button', { name: '提交回答' }) as HTMLButtonElement).disabled).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: '提交回答' }))
    expect(onSubmit).toHaveBeenCalledWith({
      status: 'answered',
      answers: [{
        index: 0,
        status: 'answered',
        selections: ['其他想法'],
        customText: '支持暗色主题',
      }],
    })
    unmount()
  })

  it('跳过：onSkip 被调用（载荷由父级组装）', () => {
    const { onSkip, unmount } = renderCard()
    fireEvent.click(screen.getByRole('button', { name: '跳过回答' }))
    expect(onSkip).toHaveBeenCalledTimes(1)
    unmount()
  })

  it('submitting：全部控件禁用，提交按钮显示提交中…', () => {
    const { container, unmount } = renderCard({ submitting: true })
    expect(container.textContent).toContain('提交中…')
    expect((screen.getByRole('button', { name: '提交中…' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: '跳过回答' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('radio', { name: '方案 A' }) as HTMLInputElement).disabled).toBe(true)
    unmount()
  })
})

describe('QuestionCard read-only / invalid states', () => {
  it('answered：只读高亮选中项、显示 customText 与 answeredAt，不可再交互', () => {
    const answer: QuestionCardAnswer = {
      status: 'answered',
      answers: [{ index: 0, status: 'answered', selections: ['其他想法'], customText: '支持暗色主题' }],
      answeredAt: '2026-10-31T10:00:00.000Z',
    }
    const { container, unmount } = renderCard({ spec: multiSpec, state: 'answered', answer })
    expect(container.textContent).toContain('支持暗色主题')
    expect(container.textContent).not.toContain('提交回答')
    const radio = screen.getByRole('checkbox', { name: '其他想法' }) as HTMLInputElement
    expect(radio.disabled).toBe(true)
    expect(container.textContent).toContain(new Date(answer.answeredAt!).toLocaleString())
    unmount()
  })

  it('skipped：只读摘要', () => {
    const { container, unmount } = renderCard({ state: 'skipped' })
    expect(container.textContent).toContain('已跳过本次提问')
    unmount()
  })

  it('expired / stale：失效态灰色提示，无交互控件', () => {
    const expired = renderCard({ state: 'expired' })
    expect(expired.container.textContent).toContain('已超时')
    expired.unmount()
    const stale = renderCard({ state: 'stale' })
    expect(stale.container.textContent).toContain('该提问未获得回答')
    stale.unmount()
  })

  it('expiresAt>0：显示倒计时 role=timer；无超时不显示', () => {
    const future = Date.now() + 90_000
    const { container, unmount } = renderCard({ expiresAt: future })
    expect(screen.getByRole('timer')).not.toBeNull()
    expect(container.textContent).toContain('剩余回答时间')
    unmount()
    const none = renderCard({ expiresAt: 0 })
    expect(none.container.textContent).toContain('等待你的回答')
    none.unmount()
  })
})
