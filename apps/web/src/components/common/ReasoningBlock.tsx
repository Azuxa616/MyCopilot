// ReasoningBlock - Extended Thinking 推理文本（reasoningText）渲染
// RFC agent-loop-v2 §3：reasoning 与正文分开渲染，默认折叠、点击展开。
// 样式与代码块区分：左侧竖线 + 浅底（代码块为深底等宽字体），弱化为元信息层级。

import { useState } from 'react'
import type { MessageWithReasoning } from '../../store/sessionStore'

interface ReasoningBlockProps {
  /** 关联的 assistant 消息：live 态用前端本地累积的 reasoningText（优先），
   * 历史回显回退到服务端持久化的 reasoning（计划 todo 13）。 */
  message: MessageWithReasoning
}

/**
 * "思考过程"折叠区块。
 * - 优先渲染 message.reasoningText（live 态 SSE 增量累积），
   * 无时回退 message.reasoning（服务端持久化，历史加载自 DB）
 * - 两者皆空（旧消息 reasoning NULL）时完全不渲染
 * - 默认收起；点击 header 切换展开（aria-expanded 上报状态）
 */
export default function ReasoningBlock({ message }: ReasoningBlockProps) {
  const [expanded, setExpanded] = useState(false)
  const reasoning = message.reasoningText || message.reasoning

  if (!reasoning) return null

  return (
    <div className="mx-4 mt-2 rounded-r-md border-l-2 border-primary-200 bg-primary-50/60 overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-left text-[11px] text-text-tertiary hover:bg-bg-hover/40"
        aria-expanded={expanded}
        aria-label={expanded ? '收起思考过程' : '展开思考过程'}
      >
        <span className="font-medium shrink-0">思考过程</span>
        <svg
          className={`ml-auto shrink-0 w-3 h-3 text-text-tertiary transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
          viewBox="0 0 12 12"
          fill="none"
          aria-hidden
        >
          <path d="M4 2.5L8 6L4 9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {expanded && (
        <div className="px-3 pb-2 pt-0.5 border-t border-primary-100/80">
          <p className="m-0 whitespace-pre-wrap wrap-break-word text-[12px] leading-relaxed text-text-secondary">
            {reasoning}
          </p>
        </div>
      )}
    </div>
  )
}
