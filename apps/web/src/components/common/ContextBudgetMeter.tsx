// ContextBudgetMeter - 六桶上下文预算水平堆叠条（纯 CSS flex，桶宽 = tokens/total）。
// 桶顺序固定：system → tools → history → toolOutputs → working → headroom
// （packages/shared/src/context.ts 六桶预算模型）。degraded 时显示琥珀「降级」徽标。

import type { BudgetBreakdown, BucketName } from '@my-copilot/shared'

interface ContextBudgetMeterProps {
  /** 六桶预算分摊结果（来自 Run 的 budgetSnapshot）。 */
  budget: BudgetBreakdown
  /** 预算降级标记（Run 级字段）；true 时显示琥珀徽标。 */
  degraded?: boolean
}

/** 六桶展示顺序、中文标签与配色（Tailwind 既有色板，标准色用法对齐 Badge.tsx）。 */
const BUCKETS: ReadonlyArray<{ name: BucketName; label: string; colorClass: string }> = [
  { name: 'system', label: '系统', colorClass: 'bg-sky-500' },
  { name: 'tools', label: '工具', colorClass: 'bg-violet-500' },
  { name: 'history', label: '历史', colorClass: 'bg-emerald-500' },
  { name: 'toolOutputs', label: '工具输出', colorClass: 'bg-amber-500' },
  { name: 'working', label: '当前轮', colorClass: 'bg-rose-500' },
  { name: 'headroom', label: '预留', colorClass: 'bg-gray-400' },
]

/**
 * 六桶预算仪表：水平堆叠条 + 每桶 token 数图例。
 * total 为 0（空预算）时各桶渲染 0% 宽，不产生 NaN。
 */
export default function ContextBudgetMeter({ budget, degraded = false }: ContextBudgetMeterProps) {
  const total = budget.total > 0 ? budget.total : 0

  return (
    <div className="flex flex-col gap-1.5" data-budget-meter>
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-[11px] font-medium text-text-secondary">上下文预算</span>
        <span className="shrink-0 text-[11px] text-text-tertiary">合计 {budget.total}</span>
        {degraded && (
          <span
            data-degraded-badge
            className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium bg-warning-light text-warning-dark"
          >
            降级
          </span>
        )}
      </div>
      <div
        className="flex w-full h-2.5 rounded-full overflow-hidden bg-bg-tertiary"
        role="img"
        aria-label={`六桶上下文预算分布，合计 ${budget.total} tokens${degraded ? '（已降级）' : ''}`}
      >
        {BUCKETS.map(({ name, colorClass }) => (
          <div
            key={name}
            data-bucket={name}
            className={`h-full ${colorClass}`}
            style={{ width: total > 0 ? `${((budget[name] / total) * 100).toFixed(2)}%` : '0%' }}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {BUCKETS.map(({ name, label, colorClass }) => (
          <span key={name} className="flex items-center gap-1 text-[11px] text-text-secondary">
            <span className={`inline-block w-2 h-2 rounded-sm ${colorClass}`} aria-hidden />
            {label}
            <span className="text-text-tertiary">{budget[name]}</span>
          </span>
        ))}
      </div>
    </div>
  )
}
