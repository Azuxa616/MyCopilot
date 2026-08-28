// CapabilitiesPage - Static engineering capability showcase (/capabilities).
// Pure hardcoded constants, zero backend requests: comparison table,
// Run state machine diagram, and tool safety levels. Public to demo visitors.

import { useNavigate } from 'react-router-dom'
import type { RunStatus } from '@my-copilot/shared'

// ─── (a) Runtime vs 普通 AI Chat 对比表 ───

interface ComparisonRow {
  dimension: string
  runtime: string
  plain: string
}

const COMPARISON_ROWS: ComparisonRow[] = [
  {
    dimension: 'SSE 流式协议',
    runtime:
      '12 种事件类型：placeholder / delta / reasoning / tool_call_start / tool_call_delta / tool_call_done / tool_result / confirmation_required / job_status / done / error / aborted，工具调用与审批全程可观测',
    plain: '单流 delta，只能看到文本增量',
  },
  {
    dimension: '六桶上下文预算',
    runtime:
      'system / tools / history / toolOutputs / working / headroom 六桶分摊 token 预算，超限自动降级（历史裁剪 → 会话摘要 → 硬截断）并标记 degraded',
    plain: '无上下文管理，超限即截断或直接报错',
  },
  {
    dimension: '三级工具安全',
    runtime: 'safe / restricted / danger 三级分级 + 两步审批确认流，MCP 接入的工具默认至少 restricted',
    plain: '无工具，或工具直通执行、无确认机制',
  },
  {
    dimension: 'Run 状态机',
    runtime: '8 状态显式建模，按 stop_reason 路由终止，每次 Run 的执行轨迹全程可追溯',
    plain: '单轮请求-响应，无执行状态跟踪',
  },
  {
    dimension: 'LoopGuard 防死循环',
    runtime: '重复工具调用检测（digest 去重后跳过）+ maxSteps 步数上限 + 单步并发工具数上限',
    plain: '无防护，模型重复调用同一工具即死循环',
  },
  {
    dimension: '扩展机制',
    runtime: 'MCP 服务接入 / Skills 技能注入 / Plugin 插件，三通道扩展能力',
    plain: '无扩展机制',
  },
  {
    dimension: '长任务执行',
    runtime: '后台 job worker 异步执行，SSE 实时推送 job_status 进度，页面不阻塞',
    plain: '同步阻塞直到完成，连接超时即中断',
  },
  {
    dimension: '双 token 访问控制',
    runtime: 'admin 全权 token + demo 只读白名单 token，安全降权后可公开演示',
    plain: '单 token 全权（或无鉴权）',
  },
]

// ─── (b) Run 状态机（状态名与 shared RunStatus 逐字一致） ───

type StateTone =
  | 'neutral'
  | 'active'
  | 'warn'
  | 'ok'
  | 'info'
  | 'err'
  | 'muted'

const STATE_TONE_CLASS: Record<StateTone, string> = {
  neutral: 'bg-gray-100 text-gray-600 border-gray-200',
  active: 'bg-blue-100 text-blue-700 border-blue-200',
  warn: 'bg-amber-100 text-amber-700 border-amber-200',
  ok: 'bg-green-100 text-green-700 border-green-200',
  info: 'bg-purple-100 text-purple-700 border-purple-200',
  err: 'bg-error-50 text-error-600 border-error-200',
  muted: 'bg-orange-100 text-orange-700 border-orange-200',
}

const STATE_TONES: Record<RunStatus, StateTone> = {
  queued: 'neutral',
  in_progress: 'active',
  requires_action: 'warn',
  completed: 'ok',
  cancelled: 'neutral',
  failed: 'err',
  incomplete: 'info',
  expired: 'muted',
}

function StatePill({ status }: { status: RunStatus }) {
  return (
    <span
      data-run-state={status}
      className={`rounded-full border px-3 py-1 font-mono text-sm whitespace-nowrap ${STATE_TONE_CLASS[STATE_TONES[status]]}`}
    >
      {status}
    </span>
  )
}

function Arrow({ label }: { label: string }) {
  return (
    <span className="flex flex-col items-center shrink-0">
      <span className="text-text-secondary leading-none">→</span>
      <span className="text-[10px] text-text-tertiary mt-0.5 max-w-24 text-center leading-tight">
        {label}
      </span>
    </span>
  )
}

// ─── (c) 三级工具安全 ───

interface SafetyCard {
  level: 'safe' | 'restricted' | 'danger'
  toneClass: string
  title: string
  description: string
  examples: string
}

const SAFETY_CARDS: SafetyCard[] = [
  {
    level: 'safe',
    toneClass: 'bg-green-100 text-green-700 border-green-200',
    title: 'safe · 安全',
    description: '直接执行，无需确认。纯本地计算、无副作用。',
    examples: 'calculator、hash_text、base64_encode、json_format',
  },
  {
    level: 'restricted',
    toneClass: 'bg-amber-100 text-amber-700 border-amber-200',
    title: 'restricted · 受限',
    description: '首次调用需会话内确认，一次批准后同会话放行；MCP 接入的工具默认至少 restricted。',
    examples: 'http_fetch、install_skill',
  },
  {
    level: 'danger',
    toneClass: 'bg-error-50 text-error-600 border-error-200',
    title: 'danger · 高危',
    description: '每次调用都必须显式确认，拒绝或超时即不执行。',
    examples: '写文件 / 执行命令类 MCP 工具',
  },
]

// ─── Page ───

export function CapabilitiesPage() {
  const navigate = useNavigate()

  return (
    <div className="flex flex-col h-full w-full max-w-4xl mx-auto p-6">
      <header className="flex items-center gap-4 mb-6 shrink-0">
        <button
          onClick={() => navigate('/')}
          className="px-4 py-2 bg-bg-secondary border border-border-base text-text-primary rounded-lg hover:bg-bg-hover transition-colors"
        >
          ← 返回
        </button>
        <h1 className="text-2xl font-semibold text-text-primary">能力对比</h1>
      </header>

      <div className="flex-1 overflow-y-auto flex flex-col gap-10 pb-6">
        <p className="text-sm text-text-secondary">
          MyCopilot 的 Agent Runtime 与普通 AI Chat 应用在工程能力上的差异——流式协议、上下文管理、工具安全、执行模型与扩展机制的逐项对照。
        </p>

        {/* (a) 对比表 */}
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium text-text-primary">Runtime vs 普通 AI Chat 对比</h2>
          <div className="bg-bg-elevated border border-border-base rounded-lg overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-border-base text-left">
                  <th className="py-2.5 pl-4 pr-4 font-medium text-text-secondary w-36 whitespace-nowrap">
                    能力维度
                  </th>
                  <th className="py-2.5 pr-4 font-semibold text-text-primary">MyCopilot Runtime</th>
                  <th className="py-2.5 pr-4 font-medium text-text-secondary">普通 AI Chat</th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON_ROWS.map((row) => (
                  <tr key={row.dimension} data-capability-row className="border-b border-border-base last:border-b-0 align-top">
                    <td className="py-2.5 pl-4 pr-4 font-medium text-text-primary whitespace-nowrap">
                      {row.dimension}
                    </td>
                    <td className="py-2.5 pr-4 text-text-primary">{row.runtime}</td>
                    <td className="py-2.5 pr-4 text-text-secondary">{row.plain}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* (b) Run 状态机 */}
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium text-text-primary">Run 状态机可视化</h2>
          <p className="text-xs text-text-tertiary">
            8 个状态名与 packages/shared/src/run.ts 的 RunStatus 逐字一致。Run 是一次 agent 调用的顶层执行单元。
          </p>

          {/* 主链：启动 → 执行 → 审批挂起 → 超时终态 */}
          <div className="bg-bg-elevated border border-border-base rounded-lg p-4 flex flex-wrap items-center gap-3">
            <StatePill status="queued" />
            <Arrow label="启动" />
            <StatePill status="in_progress" />
            <Arrow label="受限 / 高危工具待确认" />
            <StatePill status="requires_action" />
            <Arrow label="确认超时 300s" />
            <StatePill status="expired" />
          </div>

          {/* approve 回路说明 */}
          <p className="text-xs text-text-secondary pl-1">
            ↩ approve 批准后：requires_action 恢复为 in_progress 继续执行（非终态，可循环发生）
          </p>

          {/* 终态扇出 */}
          <div className="bg-bg-elevated border border-border-base rounded-lg p-4 flex flex-wrap items-center gap-3">
            <span className="text-sm text-text-secondary">in_progress 按 stop_reason 路由至四种终态：</span>
            <StatePill status="completed" />
            <StatePill status="incomplete" />
            <StatePill status="cancelled" />
            <StatePill status="failed" />
          </div>
        </section>

        {/* (c) 三级安全 + 审批确认流 */}
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium text-text-primary">三级工具安全与审批确认</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {SAFETY_CARDS.map((card) => (
              <div
                key={card.level}
                data-safety-level={card.level}
                className={`flex flex-col gap-2 rounded-lg border p-4 ${card.toneClass}`}
              >
                <span className="font-mono text-sm font-semibold">{card.title}</span>
                <span className="text-xs leading-relaxed">{card.description}</span>
                <span className="text-xs opacity-80 font-mono break-words">{card.examples}</span>
              </div>
            ))}
          </div>

          <div className="bg-bg-elevated border border-border-base rounded-lg p-4 flex flex-col gap-2">
            <h3 className="text-sm font-medium text-text-primary">
              审批确认流（confirmation_required → approve / reject）
            </h3>
            <ol className="flex flex-col gap-2 text-xs text-text-secondary list-decimal list-inside leading-relaxed">
              <li>
                <strong>第 1 步</strong>
                Run 进入 requires_action，SSE 推送 confirmation_required 事件，前端展示审批卡（工具名、参数摘要、resourceScope 资源范围），等待用户决定。
              </li>
              <li>
                <strong>第 2 步</strong>
                用户 approve（批准执行）或 reject（拒绝跳过）；300s 未确认自动 expired 终止 Run。danger 级工具每次调用都要走这两步。
              </li>
            </ol>
          </div>
        </section>
      </div>
    </div>
  )
}
