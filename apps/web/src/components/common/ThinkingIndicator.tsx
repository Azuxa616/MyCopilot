// ThinkingIndicator - agentState === 'thinking' 时的轻量"思考中"指示
// 挂在最新（发送中）消息下方，与 MessageCard 的 sending 状态条视觉融合。

import { useSessionStore } from '../../store/sessionStore'

interface ThinkingIndicatorProps {
  /** 右对齐（挂在用户消息下方时，与右侧气泡对齐）；assistant 消息下方保持左对齐。 */
  alignRight?: boolean
}

/**
 * 轻量思考指示：小号 spinner + "思考中…"文案。
 * 仅当 agentState === 'thinking'（发出请求后、首个 delta/tool_call 前）渲染。
 * 左右缩进与消息气泡列对齐（避开头像列：48px 头像 + 8px 间距 = 56px）。
 */
export default function ThinkingIndicator({ alignRight = false }: ThinkingIndicatorProps) {
  const agentState = useSessionStore((s) => s.agentState)

  if (agentState !== 'thinking') return null

  return (
    <div
      className={`flex items-center gap-1.5 py-1 text-[12px] text-text-tertiary ${alignRight ? 'justify-end pr-14' : 'pl-14'}`}
      role="status"
      aria-label="思考中"
    >
      <span
        className="inline-block w-3 h-3 border-2 border-primary-400 border-t-transparent rounded-full animate-spin shrink-0"
        aria-hidden
      />
      <span>思考中…</span>
    </div>
  )
}
