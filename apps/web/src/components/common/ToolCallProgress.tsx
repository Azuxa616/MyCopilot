// ToolCallProgress - 当前轮工具调用的实时进度列表
// 数据来自 sessionStore.activeToolCalls（T12 状态机维护），挂在最新消息下方；
// 与 ToolCallsBlock（历史消息的 toolCalls 回放）互补。

import { useSessionStore } from '../../store/sessionStore'
import type { ActiveToolCall } from '../../store/sessionStore'

/** running 状态的小号旋转指示（与 ChatShell 后台任务进度条的 spinner 样式一致） */
function RunningSpinner() {
  return (
    <span
      className="inline-block w-3 h-3 border-2 border-primary-400 border-t-transparent rounded-full animate-spin shrink-0"
      aria-hidden
    />
  )
}

interface ToolCallProgressItemProps {
  toolCall: ActiveToolCall
}

/** 单条工具调用进度：工具名 + 状态图标（running=spinner，done=✓）。 */
function ToolCallProgressItem({ toolCall }: ToolCallProgressItemProps) {
  const isRunning = toolCall.status === 'running'
  return (
    <div className="flex items-center gap-1.5 text-[12px] leading-5 min-w-0">
      {isRunning ? (
        <RunningSpinner />
      ) : (
        <span
          className="shrink-0 w-3 h-3 flex items-center justify-center text-success-dark text-[11px] leading-none font-bold"
          aria-hidden
        >
          ✓
        </span>
      )}
      <span
        className={`font-mono truncate ${isRunning ? 'text-text-secondary' : 'text-text-tertiary'}`}
        title={toolCall.name}
      >
        {toolCall.name || '…'}
      </span>
      <span className="sr-only">{isRunning ? '运行中' : '已完成'}</span>
    </div>
  )
}

/**
 * 当前轮工具调用进度列表。
 * 仅当 agentState === 'tool_running' 且 activeToolCalls 非空时渲染；
 * 终态触发时 store 已清空 activeToolCalls，组件自动消失。
 * ml-14 + 列宽与 assistant 消息气泡列对齐（避开头像列）。
 */
export default function ToolCallProgress() {
  const agentState = useSessionStore((s) => s.agentState)
  const activeToolCalls = useSessionStore((s) => s.activeToolCalls)

  if (agentState !== 'tool_running' || activeToolCalls.length === 0) return null

  return (
    <div
      className="flex flex-col gap-1 px-3 py-2 rounded-md border border-border-light bg-bg-secondary/60 ml-14 w-[calc(100%-100px)]"
      role="status"
      aria-label="工具调用进度"
    >
      {activeToolCalls.map((call) => (
        <ToolCallProgressItem key={call.id} toolCall={call} />
      ))}
    </div>
  )
}
