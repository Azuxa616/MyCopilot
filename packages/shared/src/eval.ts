/**
 * Agent 回归评估（Eval）共享类型。
 *
 * 场景 DSL（EvalScenario / EvalAssertion）、单次运行结果（EvalRunResult）
 * 与快照（EvalSnapshot）。评估体系完全自建：deterministic 场景用脚本化的
 * StreamEvent 回放驱动真实 runtime，live 场景用真实 LLM 统计一致性。
 * 本模块只声明类型，不含运行时逻辑。
 */

import type { StreamEvent } from './stream-event.js';
import type { RunStatus } from './run.js';

/** 场景分类：循环行为 / 上下文管理 / 工具安全 / 错误恢复 / 任务完成。 */
export type EvalCategory = 'loop' | 'context' | 'safety' | 'recovery' | 'task';

/** 场景执行模式：确定性回放（假 LLM + 真执行）或真实模型统计。 */
export type EvalMode = 'deterministic' | 'live';

/** 场景行为元数据：表达审批与中断等交互注入，不靠场景 id 特判。 */
export interface EvalScenarioBehavior {
  /** 审批场景的自动决策：遇到工具确认时自动 approve 或 reject。 */
  approval?: 'approve' | 'reject';
  /** 中断场景：在收到第 N 个工具结果事件后触发 abort。 */
  abortAfterToolResults?: number;
}

/** 断言失败时的故障归因分类（τ-bench 式）。 */
export type EvalFaultType =
  | 'goal_incomplete'
  | 'used_wrong_tool'
  | 'repeat_blocked'
  | 'timeout'
  | 'other';

/**
 * 评估场景定义。
 */
export interface EvalScenario {
  /** 场景唯一 id（如 'multi-step-tool-chain'）。 */
  id: string;
  /** 场景名称（中文，用于展示）。 */
  name: string;
  /** 场景描述。 */
  description: string;
  /** 场景分类。 */
  category: EvalCategory;
  /** 执行模式。 */
  mode: EvalMode;
  /** 场景可用的工具名清单（按 builtin 注册表过滤）。 */
  tools: string[];
  /** 注入给 agent loop 的用户消息文本。 */
  userMessage: string;
  /** 最大迭代步数覆盖；缺省用 runner 默认。 */
  maxSteps?: number;
  /**
   * deterministic 场景的 FakeAdapter 轮次脚本：每次 LLM 调用依序弹出
   * 下一轮事件数组。live 场景不设。
   */
  script?: StreamEvent[][];
  /** live 场景的执行次数（pass^k 一致性统计）；缺省 3。 */
  trials?: number;
  /** 行为元数据（审批决策、中断时机等）。 */
  behavior?: EvalScenarioBehavior;
  /** 场景所需的进程级环境变量（eval CLI 子进程注入）。 */
  requiredEnv?: Record<string, string>;
  /** 是否可现场确定性重放（默认 true；依赖进程级 env/工具注册不可重放的标 false）。 */
  replayable?: boolean;
  /** 断言清单（全部通过即 pass）。 */
  assertions: EvalAssertion[];
}

/**
 * 单条断言。判别联合：以 kind 区分，各变体携带自己的 expected。
 */
export type EvalAssertion =
  /** 终态状态断言。 */
  | { kind: 'status'; expected: RunStatus }
  /** 工具执行序列断言（tool_exec 步骤的工具名序列）。 */
  | { kind: 'tool_sequence'; expected: string[] }
  /** 最终文本内容包含断言。 */
  | { kind: 'final_contains'; expected: string }
  /** 降级标记断言。 */
  | { kind: 'degraded'; expected: boolean }
  /** 会话摘要已生成断言。 */
  | { kind: 'summary_created'; expected: boolean }
  /** 审批流终态断言（tool_approvals 表的决策）。 */
  | { kind: 'approval_flow'; expected: 'approve' | 'reject' }
  /** 触达最大步数上限断言。 */
  | { kind: 'max_steps_hit'; expected: boolean };

/**
 * 单条断言的求值结果。
 */
export interface EvalAssertionResult {
  /** 断言类别（与 EvalAssertion 的 kind 对应）。 */
  kind: EvalAssertion['kind'];
  /** 是否通过。 */
  pass: boolean;
  /** 求值细节说明（如实际值与期望值的差异）。 */
  detail: string;
}

/**
 * 单个场景的一次运行结果。
 */
export interface EvalRunResult {
  /** 对应的场景 id。 */
  scenarioId: string;
  /** 执行模式。 */
  mode: EvalMode;
  /** 全部断言通过为 pass，否则 fail。 */
  status: 'pass' | 'fail';
  /** 指标（steps_used、llm_calls、duration_ms、tokens_estimated 等）。 */
  metrics: Record<string, number>;
  /** 失败时的故障归因；通过或无法归类之外为 null（'other' 也可表达兜底）。 */
  faultType: EvalFaultType | null;
  /** 关联的 Run 轨迹 id；未采集或不适用时为 null。 */
  runTraceId: string | null;
  /** 逐断言求值结果。 */
  assertionResults: EvalAssertionResult[];
}

/** 快照的聚合指标。 */
export interface EvalSnapshotAggregate {
  /** 通过场景数 / 场景总数。 */
  passRate: number;
  /** 全部场景的平均步数（steps_used 均值）。 */
  avgSteps: number;
  /** 恢复类场景（错误恢复/中断等）的通过率。 */
  recoveryRate: number;
}

/**
 * 评估快照：`pnpm eval -- --report` 生成，随仓库分发的冻结成绩单。
 */
export interface EvalSnapshot {
  /** 快照生成时间（ISO 8601 字符串）。 */
  generatedAt: string;
  /** 生成时的 git commit（rev-parse HEAD）。 */
  gitCommit: string;
  /** 各场景结果。 */
  scenarios: EvalRunResult[];
  /** 聚合指标。 */
  aggregate: EvalSnapshotAggregate;
}
