// RunTraceSection - 用户消息下方的「执行轨迹」折叠区（已完成 Run 的历史回放入口）。
// 匹配语义（S1-2）：runs.userMessageId 必须等于真实用户消息 id（非 assistant 占位 id）。
// 默认收起；展开时经 traceStore.getRun 惰性拉取 { run, steps } 渲染时间线与预算条。
// 进行中 Run 不轮询刷新——会话打开时 ChatShell fetchRuns 一次即可，实时态归
// ToolCallProgress/ThinkingIndicator。

import { useState } from 'react'
import type { Message } from '@my-copilot/shared'
import type { RunTraceDetail } from '../../api'
import { useTraceStore } from '../../store/traceStore'
import { matchRunForUserMessage } from './matchRunForUserMessage'
import RunTraceTimeline from '../common/RunTraceTimeline'
import ContextBudgetMeter from '../common/ContextBudgetMeter'

interface RunTraceSectionProps {
  /** 折叠区挂载于其下方的用户消息（sessionId + id 为匹配键）。 */
  message: Message
}

/** 「执行轨迹」折叠区：无匹配 Run 时不渲染。 */
export default function RunTraceSection({ message }: RunTraceSectionProps) {
  const runs = useTraceStore((state) => state.runsBySession[message.sessionId])
  const [expanded, setExpanded] = useState(false)
  const [detail, setDetail] = useState<RunTraceDetail | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)

  const run = matchRunForUserMessage(runs, message.id)
  if (run === undefined) return null

  const handleToggle = () => {
    const next = !expanded
    setExpanded(next)
    // 惰性拉取：首次展开才请求详情（detailByRun 已缓存时 getRun 直接命中）
    if (next && detail === null && !loadFailed) {
      useTraceStore.getState().getRun(run.id).then((result) => {
        if (result === null) {
          setLoadFailed(true)
        } else {
          setDetail(result)
        }
      })
    }
  }

  return (
    <div className="mt-1 w-full flex justify-end" data-run-trace-section>
      <div className="w-full max-w-[80%] rounded-md border border-border-light bg-bg-secondary/60 overflow-hidden">
        <button
          type="button"
          onClick={handleToggle}
          className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-left text-[11px] text-text-tertiary hover:bg-bg-hover/40"
          aria-expanded={expanded}
          aria-label={expanded ? '收起执行轨迹' : '展开执行轨迹'}
        >
          <span className="font-medium shrink-0">执行轨迹</span>
          <span className="shrink-0">{run.stepCount} 步</span>
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
          <div className="flex flex-col gap-2 px-2.5 pb-2.5 pt-1.5 border-t border-border-light">
            {loadFailed ? (
              <p className="m-0 text-[11px] text-error-dark">轨迹加载失败</p>
            ) : detail === null ? (
              <p className="m-0 text-[11px] text-text-tertiary">加载中...</p>
            ) : (
              <>
                {detail.run.budgetSnapshot !== null && (
                  <ContextBudgetMeter budget={detail.run.budgetSnapshot} degraded={detail.run.degraded} />
                )}
                <RunTraceTimeline run={detail.run} steps={detail.steps} />
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
