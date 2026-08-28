// EvaluationsPage — 评估仪表盘：冻结快照的聚合指标与场景明细 + 现场确定性回放。
// 双轨语义：快照 = 生成时点的冻结成绩单；现场回放 = 以当前代码确定性重放（仅
// deterministic 且 replayable 场景，live 场景只展示历史结果）。不做轮询刷新。

import { Fragment, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { EvalCategory, EvalFaultType, EvalMode, EvalRunResult } from '@my-copilot/shared'
import { useEvalStore } from '../../store/evalStore'
import { Badge } from '../../components/common/Badge'
import RunTraceTimeline from '../../components/common/RunTraceTimeline'
import ContextBudgetMeter from '../../components/common/ContextBudgetMeter'

const CATEGORY_LABEL: Readonly<Record<EvalCategory, string>> = {
  loop: '循环',
  context: '上下文',
  safety: '安全',
  recovery: '恢复',
  task: '任务',
}

const CATEGORY_COLOR: Readonly<Record<EvalCategory, string>> = {
  loop: 'bg-bg-tertiary text-text-secondary',
  context: 'bg-sky-100 text-sky-700',
  safety: 'bg-amber-100 text-amber-700',
  recovery: 'bg-emerald-100 text-emerald-700',
  task: 'bg-gray-100 text-gray-600',
}

const MODE_LABEL: Readonly<Record<EvalMode, string>> = {
  deterministic: '确定性',
  live: '真实模型',
}

const MODE_COLOR: Readonly<Record<EvalMode, string>> = {
  deterministic: 'bg-primary-100 text-primary-700',
  live: 'bg-violet-100 text-violet-700',
}

const FAULT_LABEL: Readonly<Record<EvalFaultType, string>> = {
  goal_incomplete: '目标未完成',
  used_wrong_tool: '工具用错',
  repeat_blocked: '重复熔断',
  timeout: '超时',
  other: '其他',
}

const ASSERTION_LABEL: Readonly<Record<EvalRunResult['assertionResults'][number]['kind'], string>> = {
  status: '终态',
  tool_sequence: '工具序列',
  final_contains: '结果包含',
  degraded: '预算降级',
  summary_created: '摘要生成',
  approval_flow: '审批流',
  max_steps_hit: '步数上限',
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`
}

function MetricCard({ id, label, value }: { id: string; label: string; value: string }) {
  return (
    <div data-metric-card={id} className="flex flex-col gap-1 rounded-lg border border-border-base bg-bg-elevated px-4 py-3">
      <span className="text-xs text-text-tertiary">{label}</span>
      <span className="text-xl font-semibold text-text-primary">{value}</span>
    </div>
  )
}

function StatusBadge({ status }: { status: EvalRunResult['status'] }) {
  return (
    <Badge colorClass={status === 'pass' ? 'bg-success-light/60 text-success-dark' : 'bg-error-light/60 text-error-dark'}>
      {status === 'pass' ? '通过' : '失败'}
    </Badge>
  )
}

export function EvaluationsPage() {
  const navigate = useNavigate()
  const snapshot = useEvalStore((s) => s.snapshot)
  const scenarios = useEvalStore((s) => s.scenarios)
  const replayResult = useEvalStore((s) => s.replayResult)
  const isReplaying = useEvalStore((s) => s.isReplaying)
  const isLoadingSnapshot = useEvalStore((s) => s.isLoadingSnapshot)
  const error = useEvalStore((s) => s.error)
  const fetchSnapshot = useEvalStore((s) => s.fetchSnapshot)
  const fetchScenarios = useEvalStore((s) => s.fetchScenarios)
  const replayScenario = useEvalStore((s) => s.replayScenario)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [replayingId, setReplayingId] = useState<string | null>(null)

  useEffect(() => {
    fetchSnapshot()
    fetchScenarios()
  }, [fetchSnapshot, fetchScenarios])

  const metaById = new Map(scenarios.map((meta) => [meta.id, meta]))
  const hasSnapshot = snapshot !== null && snapshot.scenarios.length > 0

  const handleReplay = async (id: string) => {
    setReplayingId(id)
    await replayScenario(id)
    setReplayingId(null)
  }

  return (
    <div className="flex flex-col h-full w-full max-w-4xl mx-auto p-6">
      <header className="flex items-center gap-4 mb-6 shrink-0">
        <button
          onClick={() => navigate('/')}
          className="px-4 py-2 bg-bg-secondary border border-border-base text-text-primary rounded-lg hover:bg-bg-hover transition-colors"
        >
          ← 返回
        </button>
        <h1 className="text-2xl font-semibold text-text-primary">评估仪表盘</h1>
      </header>

      <div className="flex-1 overflow-y-auto flex flex-col gap-6 pb-6">
        <p className="text-sm text-text-secondary">
          Agent 回归评估的冻结成绩单与现场回放——快照由 `pnpm eval -- --report` 生成；确定性场景可在当前代码上即时重放验证。
        </p>

        {error && (
          <div role="alert" className="rounded-lg border border-error bg-error-light/20 text-error-dark px-4 py-3 text-sm">
            {error}
          </div>
        )}

        {isLoadingSnapshot && snapshot === null ? (
          <div className="text-sm text-text-secondary">加载中...</div>
        ) : !hasSnapshot ? (
          <div className="rounded-xl border border-dashed border-border-base px-6 py-10 text-center">
            <p className="text-sm text-text-secondary">尚无评估快照</p>
            <p className="mt-1 text-xs text-text-tertiary">运行 pnpm eval -- --report 生成快照</p>
          </div>
        ) : (
          <>
            <section className="grid grid-cols-2 md:grid-cols-4 gap-3" data-metric-cards>
              <MetricCard id="passRate" label="通过率" value={formatPercent(snapshot.aggregate.passRate)} />
              <MetricCard id="scenarioCount" label="场景总数" value={String(snapshot.scenarios.length)} />
              <MetricCard id="avgSteps" label="平均步数" value={snapshot.aggregate.avgSteps.toFixed(1)} />
              <MetricCard id="recoveryRate" label="恢复率" value={formatPercent(snapshot.aggregate.recoveryRate)} />
            </section>

            <section className="flex flex-col gap-3">
              <h2 className="text-lg font-medium text-text-primary">场景明细</h2>
              <div className="bg-bg-elevated border border-border-base rounded-lg overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="border-b border-border-base text-left text-text-secondary">
                      <th className="py-2.5 pl-4 pr-4 font-medium">场景</th>
                      <th className="py-2.5 pr-4 font-medium">分类</th>
                      <th className="py-2.5 pr-4 font-medium">模式</th>
                      <th className="py-2.5 pr-4 font-medium">状态</th>
                      <th className="py-2.5 pr-4 font-medium">故障归因</th>
                      <th className="py-2.5 pr-4 font-medium">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snapshot.scenarios.map((result) => {
                      const meta = metaById.get(result.scenarioId)
                      const isExpanded = expandedId === result.scenarioId
                      const canReplay = result.mode === 'deterministic' && meta?.replayable === true
                      return (
                        <Fragment key={result.scenarioId}>
                          <tr
                            data-eval-row={result.scenarioId}
                            onClick={() => setExpandedId(isExpanded ? null : result.scenarioId)}
                            className={`cursor-pointer border-b border-border-base last:border-b-0 align-top hover:bg-bg-hover/50 ${isExpanded ? 'bg-bg-hover/30' : ''}`}
                            aria-expanded={isExpanded}
                          >
                            <td className="py-2.5 pl-4 pr-4">
                              <div className="flex flex-col">
                                <span className="font-medium text-text-primary">{meta?.name ?? result.scenarioId}</span>
                                <span className="text-xs font-mono text-text-tertiary">{result.scenarioId}</span>
                              </div>
                            </td>
                            <td className="py-2.5 pr-4">
                              {meta ? <Badge colorClass={CATEGORY_COLOR[meta.category]}>{CATEGORY_LABEL[meta.category]}</Badge> : '—'}
                            </td>
                            <td className="py-2.5 pr-4">
                              <Badge colorClass={MODE_COLOR[result.mode]}>{MODE_LABEL[result.mode]}</Badge>
                            </td>
                            <td className="py-2.5 pr-4">
                              <StatusBadge status={result.status} />
                            </td>
                            <td className="py-2.5 pr-4">
                              {result.faultType !== null ? (
                                <Badge colorClass="bg-warning-light text-warning-dark">{FAULT_LABEL[result.faultType]}</Badge>
                              ) : (
                                '—'
                              )}
                            </td>
                            <td className="py-2.5 pr-4">
                              {canReplay ? (
                                <button
                                  data-replay-button={result.scenarioId}
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    void handleReplay(result.scenarioId)
                                  }}
                                  disabled={isReplaying}
                                  className="px-3 py-1.5 text-xs bg-bg-primary border border-border-base text-text-primary rounded-lg hover:bg-bg-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                  {replayingId === result.scenarioId && isReplaying ? '回放中...' : '现场回放'}
                                </button>
                              ) : (
                                '—'
                              )}
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr data-assertion-detail={result.scenarioId}>
                              <td colSpan={6} className="px-4 pb-3 border-b border-border-base last:border-b-0 bg-bg-tertiary/30">
                                <ul className="m-0 p-0 list-none flex flex-col gap-1.5">
                                  {result.assertionResults.map((assertion, index) => (
                                    <li key={index} className="flex items-start gap-2 text-xs">
                                      <span className={assertion.pass ? 'text-success-dark' : 'text-error-dark'}>
                                        {assertion.pass ? '✓' : '✗'}
                                      </span>
                                      <span className="font-medium text-text-primary shrink-0">
                                        {ASSERTION_LABEL[assertion.kind]}
                                      </span>
                                      <span className="text-text-tertiary break-all">{assertion.detail}</span>
                                    </li>
                                  ))}
                                </ul>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {snapshot.gitCommit && (
                <p data-snapshot-meta className="text-xs text-text-tertiary">
                  快照生成于 {new Date(snapshot.generatedAt).toLocaleString()} · git {snapshot.gitCommit.slice(0, 7)}
                </p>
              )}
            </section>
          </>
        )}

        {replayResult && (
          <section data-replay-panel className="flex flex-col gap-3 bg-bg-elevated border border-border-base rounded-lg p-4">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-sm font-medium text-text-primary">现场回放 · {replayResult.evalRun.scenarioId}</h2>
              <StatusBadge status={replayResult.evalRun.status} />
              {replayResult.evalRun.faultType !== null && (
                <Badge colorClass="bg-warning-light text-warning-dark">{FAULT_LABEL[replayResult.evalRun.faultType]}</Badge>
              )}
            </div>
            {replayResult.runTrace.budgetSnapshot !== null && (
              <ContextBudgetMeter budget={replayResult.runTrace.budgetSnapshot} degraded={replayResult.runTrace.degraded} />
            )}
            <RunTraceTimeline run={replayResult.runTrace} steps={replayResult.steps} />
          </section>
        )}
      </div>
    </div>
  )
}
