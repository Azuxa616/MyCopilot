// RunTraceTimeline - 已完成 Run 的执行轨迹时间线（历史回放视图，数据来自 runs 表）。
// 渐进披露三层：收起摘要行 → 展开步骤列表 → 每步展开 argsPreview/resultPreview 的 pre 块。
// 进行中消息的实时态由 ToolCallProgress/ThinkingIndicator 负责，本组件只做历史回放。

import { useState } from 'react'
import type { RunStatus, RunStepRecord, RunTraceRecord, StopReason } from '@my-copilot/shared'

interface RunTraceTimelineProps {
  /** Run 轨迹记录（终态字段与预算快照由调用方给定）。 */
  run: RunTraceRecord
  /** Run 的全部步骤（按 seq 升序）。 */
  steps: RunStepRecord[]
}

/** RunStatus → 摘要徽标样式与中文文案（8 状态穷尽映射）。 */
const STATUS_BADGE: Readonly<Record<RunStatus, { label: string; className: string }>> = {
  queued: { label: '排队中', className: 'bg-bg-tertiary text-text-secondary' },
  in_progress: { label: '进行中', className: 'bg-primary-100 text-primary-700' },
  requires_action: { label: '待确认', className: 'bg-warning-light text-warning-dark' },
  completed: { label: '已完成', className: 'bg-success-light/60 text-success-dark' },
  cancelled: { label: '已取消', className: 'bg-bg-tertiary text-text-secondary' },
  failed: { label: '失败', className: 'bg-error-light/60 text-error-dark' },
  incomplete: { label: '未完成', className: 'bg-warning-light text-warning-dark' },
  expired: { label: '已过期', className: 'bg-bg-tertiary text-text-tertiary' },
}

/** StopReason → 摘要行中文文案（title 属性保留原始枚举值）。 */
const STOP_REASON_LABEL: Readonly<Record<StopReason, string>> = {
  end_turn: '正常结束',
  tool_use: '工具调用',
  max_steps: '步数上限',
  max_tokens: '预算耗尽',
  user_interrupt: '用户中断',
  error: '执行出错',
}

/** 毫秒 → 短文案（<1s 保留毫秒，否则一位小数秒）。 */
function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
}

interface StepItemProps {
  step: RunStepRecord
}

/** 单个步骤行：类型图标 + 工具名 + 耗时 + isError 红标；可展开 preview 的 pre 块。 */
function StepItem({ step }: StepItemProps) {
  const [expanded, setExpanded] = useState(false)
  const isTool = step.type === 'tool_exec'
  const hasDetail = step.argsPreview !== null || step.resultPreview !== null

  return (
    <li className="m-0 rounded-md border border-border-light bg-bg-elevated overflow-hidden" data-step-type={step.type}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        disabled={!hasDetail}
        className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-left text-[12px] text-text-secondary hover:bg-bg-hover/50 disabled:cursor-default disabled:hover:bg-transparent"
        aria-expanded={hasDetail ? expanded : undefined}
        aria-label={hasDetail ? `展开步骤 ${step.seq} 详情` : `步骤 ${step.seq}`}
      >
        <span className="shrink-0" aria-hidden>{isTool ? '🔧' : '💬'}</span>
        <span className="font-medium truncate">{isTool ? (step.toolName ?? '工具') : 'LLM 调用'}</span>
        <span className="shrink-0 text-text-tertiary">{formatDuration(step.durationMs)}</span>
        {step.isError && (
          <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium bg-error-light/40 text-error-dark">
            执行出错
          </span>
        )}
        {hasDetail && (
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
      {expanded && hasDetail && (
        <div className="flex flex-col gap-1.5 px-2.5 pb-2.5 pt-1 bg-bg-tertiary/40 border-t border-border-light">
          {step.argsPreview !== null && (
            <pre data-step-args className="m-0 max-h-[160px] overflow-auto font-mono text-[11px] leading-relaxed text-text-secondary">
              {step.argsPreview}
            </pre>
          )}
          {step.resultPreview !== null && (
            <pre data-step-result className="m-0 max-h-[160px] overflow-auto font-mono text-[11px] leading-relaxed text-text-secondary">
              {step.resultPreview}
            </pre>
          )}
        </div>
      )}
    </li>
  )
}

/**
 * 执行轨迹时间线。
 * - 顶部摘要行：终态徽标、iterations、总耗时（endedAt − startedAt，未结束为 —）、stopReason
 * - 默认收起；点击摘要行展开步骤列表（空 steps 显示「无步骤记录」占位）
 */
export default function RunTraceTimeline({ run, steps }: RunTraceTimelineProps) {
  const [expanded, setExpanded] = useState(false)
  const badge = STATUS_BADGE[run.status]
  const totalMs = run.endedAt !== null ? Date.parse(run.endedAt) - Date.parse(run.startedAt) : null

  return (
    <div className="rounded-md border border-border-light bg-bg-secondary/60 overflow-hidden" data-run-trace-timeline>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-[12px] text-text-secondary hover:bg-bg-hover/50"
        aria-expanded={expanded}
        aria-label={expanded ? '收起执行步骤' : '展开执行步骤'}
      >
        <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium ${badge.className}`}>
          {badge.label}
        </span>
        <span className="shrink-0">{run.iterations} 轮</span>
        <span className="shrink-0 text-text-tertiary">{totalMs !== null ? formatDuration(totalMs) : '—'}</span>
        {run.stopReason !== null && (
          <span className="shrink-0 text-text-tertiary" title={run.stopReason}>
            {STOP_REASON_LABEL[run.stopReason]}
          </span>
        )}
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
        <div className="px-2.5 pb-2.5 pt-1 border-t border-border-light">
          {steps.length === 0 ? (
            <p className="m-0 text-[11px] text-text-tertiary">无步骤记录</p>
          ) : (
            <ol className="m-0 p-0 list-none flex flex-col gap-1.5">
              {steps.map((step) => (
                <StepItem key={step.id} step={step} />
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  )
}
