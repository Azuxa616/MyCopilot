// AgentTimeline - assistant 消息的「过程时间线」渲染
// 设计参考：ChatGPT "Thought for Xs" 折叠胶囊 / claude.ai 流式思考折叠区 /
// Cursor 工具卡片。思考（reasoning）、每轮前导文本（lead）、工具调用（tool）
// 统一为时间线条目：流式时活跃条目默认展开实时滚动，完成后全部折叠为
// 单行摘要（含状态与耗时）——正文气泡只承载最终回答。
// 数据来源：流式期间 sessionStore 维护的 message.timeline（live 路径），
// 刷新后 utils/timeline.ts 从服务端消息重建（rebuild 路径）。

import { useState } from 'react'
import type { TimelineEntry } from '../../types/timeline'

/** 折叠指示箭头（与 ToolCallsBlock 的 chevron 同款，旋转过渡）。 */
function Chevron({ expanded }: { expanded: boolean }) {
  return (
    <svg
      className={`ml-auto shrink-0 w-3 h-3 text-text-tertiary transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden
    >
      <path d="M4 2.5L8 6L4 9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** running 状态的小号旋转指示（与 ToolCallProgress 的 spinner 样式一致）。 */
function RunningSpinner() {
  return (
    <span
      className="inline-block w-3 h-3 border-2 border-primary-400 border-t-transparent rounded-full animate-spin shrink-0"
      aria-hidden
    />
  )
}

/** 耗时格式化：<1s 与 ≥1s 均保留一位小数（如 "0.8s" / "2.1s"）。 */
function formatDuration(startedAt: number, endedAt: number): string {
  return `${((endedAt - startedAt) / 1000).toFixed(1)}s`
}

/** 将 JSON 字符串参数美化；解析失败时回退到原始字符串。 */
function prettyPrintJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}

/** reasoning 条目：可折叠。折叠摘要 = 🧠 + 文案（思考中…/思考过程）；展开 = 推理文本。 */
function ReasoningEntry({ entry, live }: { entry: Extract<TimelineEntry, { kind: 'reasoning' }>; live: boolean }) {
  const thinking = live && !entry.done
  // live 且仍在思考 → 默认展开（用户手动收起后尊重选择，初始值不随 prop 变化）
  const [expanded, setExpanded] = useState(thinking)

  return (
    <div className="rounded-r-md border-l-2 border-primary-200 bg-primary-50/60 overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-left text-[11px] text-text-tertiary hover:bg-bg-hover/40"
        aria-expanded={expanded}
        aria-label={expanded ? '收起思考过程' : '展开思考过程'}
      >
        {thinking ? <RunningSpinner /> : <span className="shrink-0" aria-hidden>🧠</span>}
        <span className="font-medium shrink-0">{thinking ? '思考中…' : '思考过程'}</span>
        <Chevron expanded={expanded} />
      </button>
      {expanded && (
        <div className="px-3 pb-2 pt-0.5 border-t border-primary-100/80">
          <p className="m-0 whitespace-pre-wrap wrap-break-word text-[12px] leading-relaxed text-text-secondary">
            {entry.text}
          </p>
        </div>
      )}
    </div>
  )
}

/** lead 条目：不可折叠的单行弱化文本（某轮工具调用的前导语）。 */
function LeadEntry({ entry }: { entry: Extract<TimelineEntry, { kind: 'lead' }> }) {
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1 min-w-0" title={entry.text}>
      <span className="shrink-0 text-[11px]" aria-hidden>💬</span>
      <span className="truncate text-[12px] text-text-tertiary">{entry.text}</span>
    </div>
  )
}

/** 结果展示文本：超过约 2000 字符截断并追加标记。 */
function truncateResult(result: string): string {
  return result.length > 2000 ? `${result.slice(0, 2000)}\n…（结果已截断）` : result
}

/** tool 条目：可折叠。折叠摘要 = 🔧 + 工具名 + 状态图标 + 耗时；展开 = 参数 + 结果。 */
function ToolEntry({ entry, live }: { entry: Extract<TimelineEntry, { kind: 'tool' }>; live: boolean }) {
  const isRunning = entry.status === 'running'
  const hasDetail = entry.args !== undefined || entry.result !== undefined
  // live 且仍在执行且确有详情 → 默认展开；历史回放默认折叠
  const [expanded, setExpanded] = useState(live && isRunning && hasDetail)

  const duration = entry.endedAt !== undefined
    ? formatDuration(entry.startedAt, entry.endedAt)
    : null

  return (
    <div
      className="rounded-md border border-border-light bg-bg-secondary/60 overflow-hidden"
      {...(live && isRunning ? { role: 'status' as const } : {})}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        disabled={!hasDetail}
        className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-left text-[12px] text-text-secondary hover:bg-bg-hover/50 disabled:cursor-default disabled:hover:bg-transparent"
        aria-expanded={expanded}
        aria-label={hasDetail ? `展开工具 ${entry.name || '…'} 的调用详情` : `工具 ${entry.name}（无详情）`}
      >
        <span className="shrink-0" aria-hidden>🔧</span>
        <span className="font-mono truncate">{entry.name || '…'}</span>
        {isRunning ? (
          <RunningSpinner />
        ) : entry.status === 'error' ? (
          <span className="shrink-0 text-error-600 text-[11px] leading-none font-bold" aria-hidden>✗</span>
        ) : (
          <span className="shrink-0 text-success-dark text-[11px] leading-none font-bold" aria-hidden>✓</span>
        )}
        {duration && (
          <span className="shrink-0 text-[10px] text-text-tertiary font-mono">{duration}</span>
        )}
        {hasDetail && <Chevron expanded={expanded} />}
      </button>
      {expanded && hasDetail && (
        <div className="px-2.5 pb-2.5 pt-1 bg-bg-tertiary/40 border-t border-border-light flex flex-col gap-2">
          {entry.args !== undefined && (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] text-text-tertiary">参数</span>
              <pre className="m-0 max-h-[160px] overflow-auto font-mono text-[11px] leading-relaxed text-text-secondary">
                {prettyPrintJson(entry.args)}
              </pre>
            </div>
          )}
          {entry.result !== undefined && (
            <div className={`flex flex-col gap-1 rounded-md p-1.5 ${entry.isError ? 'border border-error-200 bg-error-50' : ''}`}>
              <span className={`text-[10px] ${entry.isError ? 'text-error-700' : 'text-text-tertiary'}`}>
                {entry.isError ? '结果（错误）' : '结果'}
              </span>
              <pre className={`m-0 max-h-[200px] overflow-auto font-mono text-[11px] leading-relaxed ${entry.isError ? 'text-error-700' : 'text-text-secondary'}`}>
                {truncateResult(entry.result)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export interface AgentTimelineProps {
  /** 时间线条目（有序：按发生顺序）。 */
  entries: TimelineEntry[]
  /** 流式进行中（当前消息 sending）：running 的 tool 条目与未完成 reasoning 默认展开。 */
  live?: boolean
}

/**
 * 过程时间线。entries 为空数组或 undefined 时不渲染。
 * 纵向排列（gap 6px），供 MessageCard 在正文之上挂载。
 */
export default function AgentTimeline({ entries, live = false }: AgentTimelineProps) {
  if (!entries || entries.length === 0) return null

  return (
    <div className="flex flex-col gap-1.5" aria-label="执行过程时间线">
      {entries.map((entry) => {
        switch (entry.kind) {
          case 'reasoning':
            return <ReasoningEntry key={entry.id} entry={entry} live={live} />
          case 'lead':
            return <LeadEntry key={entry.id} entry={entry} />
          case 'tool':
            return <ToolEntry key={entry.id} entry={entry} live={live} />
        }
      })}
    </div>
  )
}
