// ToolCallsBlock - 渲染 assistant 消息中的工具调用块
// 正常模式下始终渲染（非 debug gated），补齐已有后端能力
// 参考 ChatGPT/Claude 的折叠工具块样式，保持项目设计语言

import { useMemo, useState } from 'react'
import type { ToolCall } from '@my-copilot/shared'

/** 将 JSON 字符串参数美化；解析失败时回退到原始字符串。 */
function prettyPrintArguments(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}

interface ToolCallItemProps {
  toolCall: ToolCall
  /** 开发模式下额外展示 toolCall.id 与无截断参数（来自 import.meta.env.DEV，prod 构建 tree-shake 掉）。 */
  debugMode?: boolean
}

/** 单个工具调用的折叠块。拆为独立组件以隔离 state 并遵守 rerender-no-inline-components。 */
function ToolCallItem({ toolCall, debugMode = false }: ToolCallItemProps) {
  const [expanded, setExpanded] = useState(false)

  const prettyArgs = useMemo(() => prettyPrintArguments(toolCall.arguments), [toolCall.arguments])

  const hasArgs = toolCall.arguments.trim().length > 0

  return (
    <div className="rounded-md border border-border-light bg-bg-secondary/60 overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        disabled={!hasArgs}
        className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-left text-[12px] text-text-secondary hover:bg-bg-hover/50 disabled:cursor-default disabled:hover:bg-transparent"
        aria-expanded={expanded}
        aria-label={hasArgs ? `展开工具 ${toolCall.name} 的参数` : `工具 ${toolCall.name}（无参数）`}
      >
        <span className="shrink-0" aria-hidden>🔧</span>
        <span className="font-medium truncate">{toolCall.name}</span>
        {hasArgs && (
          <svg
            className={`ml-auto shrink-0 w-3 h-3 text-text-tertiary transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
            viewBox="0 0 12 12"
            fill="none"
            aria-hidden
          >
            <path d="M4 2.5L8 6L4 9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>
      {expanded && hasArgs && (
        <div className="px-2.5 pb-2.5 pt-1 bg-bg-tertiary/40 border-t border-border-light">
          {debugMode && (
            <div className="font-mono text-[10px] text-text-tertiary mb-1 break-all" title="toolCall.id">
              {toolCall.id}
            </div>
          )}
          <pre className="m-0 max-h-[200px] overflow-auto font-mono text-[11px] leading-relaxed text-text-secondary">
            {prettyArgs}
          </pre>
        </div>
      )}
    </div>
  )
}

interface ToolCallsBlockProps {
  /** 关联的消息（用于读取 toolCalls / toolCallId）。 */
  message: {
    toolCalls?: ToolCall[]
  }
  /** 开发模式下额外展示 toolCall.id（默认 false，prod 构建会被 tree-shake）。 */
  debugMode?: boolean
}

/**
 * 渲染消息的工具调用块。
 * - 仅当 message.toolCalls 非空数组时渲染（空数组或 undefined → 不渲染）
 * - 正常模式始终可见，补齐后端已有但 UI 未渲染的能力
 * - debugMode=true 时在展开的 ToolCallItem 内额外显示 toolCall.id（仅 DEV）
 */
export default function ToolCallsBlock({ message, debugMode = false }: ToolCallsBlockProps) {
  const toolCalls = message.toolCalls
  if (!toolCalls || toolCalls.length === 0) return null

  return (
    <div className="flex flex-col gap-1.5 px-3 py-2">
      {toolCalls.map((tc) => (
        <ToolCallItem key={tc.id} toolCall={tc} debugMode={debugMode} />
      ))}
    </div>
  )
}
