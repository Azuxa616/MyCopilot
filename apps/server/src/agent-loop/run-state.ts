/**
 * Agent Loop v2 —— Run 生命周期状态机与 RunStep 跟踪（纯逻辑模块）。
 *
 * 对应 RFC《Agent Loop v2》（docs/rfc/agent-loop-v2.md）§1 Run 生命周期状态机：
 * queued → in_progress → requires_action → in_progress (approved)，以及
 * completed / cancelled / failed / incomplete / expired 终态。
 *
 * 本模块只负责状态转移与步骤记录：不依赖 SSE、DB 或 runner。
 * SSE 事件映射与 runner 集成由后续任务（T11/T14）完成。
 */

import { randomUUID } from 'node:crypto';
import type {
  RunStatus,
  RunStep,
  RunStepType,
} from '@my-copilot/shared';

/**
 * 驱动 Run 状态机转移的事件（RFC §1）。
 *
 * - start：进入循环（queued → in_progress）
 * - await_confirmation：工具需要用户确认（→ requires_action）
 * - confirmation_granted：用户批准确认（→ in_progress）
 * - stop：模型 end_turn 正常结束（→ completed）
 * - abort：用户中断（→ cancelled）
 * - fail：adapter/工具/runner 异常（→ failed）
 * - max_steps：达到 LoopGuard 步数上限（→ incomplete）
 * - expire：确认等待超时（→ expired）
 */
export type RunEvent =
  | 'start'
  | 'await_confirmation'
  | 'confirmation_granted'
  | 'stop'
  | 'abort'
  | 'fail'
  | 'max_steps'
  | 'expire';

/**
 * 合法转移表（RFC §1）。键为事件，值为 from → to 的映射；
 * 表中不存在的 (event, from) 组合视为非法转移。
 *
 * - start: queued→in_progress
 * - await_confirmation: in_progress→requires_action
 * - confirmation_granted: requires_action→in_progress
 * - stop: in_progress→completed；requires_action→completed
 * - abort: queued→cancelled；in_progress→cancelled；requires_action→cancelled
 * - fail: queued→failed；in_progress→failed；requires_action→failed
 * - max_steps: in_progress→incomplete
 * - expire: requires_action→expired（确认超时）；queued→expired
 */
export const RUN_TRANSITIONS: Readonly<
  Record<RunEvent, Partial<Record<RunStatus, RunStatus>>>
> = {
  start: { queued: 'in_progress' },
  await_confirmation: { in_progress: 'requires_action' },
  confirmation_granted: { requires_action: 'in_progress' },
  stop: { in_progress: 'completed', requires_action: 'completed' },
  abort: { queued: 'cancelled', in_progress: 'cancelled', requires_action: 'cancelled' },
  fail: { queued: 'failed', in_progress: 'failed', requires_action: 'failed' },
  max_steps: { in_progress: 'incomplete' },
  expire: { requires_action: 'expired', queued: 'expired' },
};

/**
 * 事件 → RunStep.type 映射（RFC §2 Run 步骤，runtime 侧类型名）：
 * start/stop/abort/fail/max_steps/expire 记为 message_creation，
 * await_confirmation/confirmation_granted 记为 tool_calls。
 */
const STEP_TYPE_BY_EVENT: Readonly<Record<RunEvent, RunStepType>> = {
  start: 'message_creation',
  await_confirmation: 'tool_calls',
  confirmation_granted: 'tool_calls',
  stop: 'message_creation',
  abort: 'message_creation',
  fail: 'message_creation',
  max_steps: 'message_creation',
  expire: 'message_creation',
};

/**
 * Run 生命周期状态机（RFC §1）。内存态实现：跟踪当前状态并按转移追加 RunStep。
 * 不发 SSE、不写 DB；由上层（runner/流式层）订阅其返回值做映射。
 */
export class RunStateMachine {
  private readonly runId: string;
  private status: RunStatus = 'queued';
  private readonly steps: RunStep[] = [];

  /**
   * @param runId 所属 Run 的 id，写入每条 RunStep.runId。
   */
  constructor(runId: string) {
    this.runId = runId;
  }

  /**
   * 应用一个事件并转移到目标状态（RFC §1）。
   *
   * 合法转移：更新 status、追加一条 RunStep 并返回新状态。
   * 非法转移：抛 Error（消息含 from/event/to 的中文说明），状态与步骤不变。
   *
   * RunStep 记录约定：status 默认 'completed'，失败转移（fail 事件）记为
   * 'failed'；max_steps/expire 属于护栏/超时终止而非步骤失败，仍记 'completed'。
   */
  transition(event: RunEvent): RunStatus {
    const from = this.status;
    const to = RUN_TRANSITIONS[event][from];
    if (to === undefined) {
      const legal = Object.entries(RUN_TRANSITIONS[event])
        .map(([f, t]) => `${f}→${t}`)
        .join('、');
      throw new Error(
        `非法的 Run 状态转移：from="${from}" 状态下不允许 event="${event}"（无合法 to）；` +
          `事件 "${event}" 的合法转移为：${legal}`,
      );
    }
    this.status = to;
    this.steps.push({
      id: randomUUID(),
      runId: this.runId,
      type: STEP_TYPE_BY_EVENT[event],
      status: event === 'fail' ? 'failed' : 'completed',
      createdAt: new Date().toISOString(),
    });
    return to;
  }

  /** 当前 Run 状态。 */
  getStatus(): RunStatus {
    return this.status;
  }

  /** 按转移顺序累积的全部 RunStep。 */
  getSteps(): readonly RunStep[] {
    return this.steps;
  }
}
