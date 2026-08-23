import { describe, it, expect } from 'vitest';
import type { RunStatus, RunStepType } from '@my-copilot/shared';
import { RunStateMachine } from '../run-state.js';
import type { RunEvent } from '../run-state.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** 达到指定状态所需的前置事件序列（失败用例也复用终态种子）。 */
const SEED_BY_STATUS: Record<RunStatus, RunEvent[]> = {
  queued: [],
  in_progress: ['start'],
  requires_action: ['start', 'await_confirmation'],
  completed: ['start', 'stop'],
  cancelled: ['start', 'abort'],
  failed: ['start', 'fail'],
  incomplete: ['start', 'max_steps'],
  expired: ['expire'],
};

/** 构造一个已处于指定状态的 RunStateMachine。 */
function machineAt(from: RunStatus, runId = 'run-1'): RunStateMachine {
  const machine = new RunStateMachine(runId);
  for (const event of SEED_BY_STATUS[from]) {
    machine.transition(event);
  }
  return machine;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

// ---------------------------------------------------------------------------
// 合法转移表（RFC §1 的完整枚举，与实现独立声明以做交叉验证）
// ---------------------------------------------------------------------------

const LEGAL_TRANSITIONS: { event: RunEvent; from: RunStatus; to: RunStatus }[] = [
  { event: 'start', from: 'queued', to: 'in_progress' },
  { event: 'await_confirmation', from: 'in_progress', to: 'requires_action' },
  { event: 'confirmation_granted', from: 'requires_action', to: 'in_progress' },
  { event: 'stop', from: 'in_progress', to: 'completed' },
  { event: 'stop', from: 'requires_action', to: 'completed' },
  { event: 'abort', from: 'queued', to: 'cancelled' },
  { event: 'abort', from: 'in_progress', to: 'cancelled' },
  { event: 'abort', from: 'requires_action', to: 'cancelled' },
  { event: 'fail', from: 'queued', to: 'failed' },
  { event: 'fail', from: 'in_progress', to: 'failed' },
  { event: 'fail', from: 'requires_action', to: 'failed' },
  { event: 'max_steps', from: 'in_progress', to: 'incomplete' },
  { event: 'expire', from: 'requires_action', to: 'expired' },
  { event: 'expire', from: 'queued', to: 'expired' },
];

/** 每个事件触发的 RunStep 形态（type 映射 + status；仅 fail 记为 failed）。 */
const STEP_SPEC_BY_EVENT: {
  event: RunEvent;
  from: RunStatus;
  type: RunStepType;
  status: 'completed' | 'failed';
}[] = [
  { event: 'start', from: 'queued', type: 'message_creation', status: 'completed' },
  { event: 'await_confirmation', from: 'in_progress', type: 'tool_calls', status: 'completed' },
  { event: 'confirmation_granted', from: 'requires_action', type: 'tool_calls', status: 'completed' },
  { event: 'stop', from: 'in_progress', type: 'message_creation', status: 'completed' },
  { event: 'abort', from: 'in_progress', type: 'message_creation', status: 'completed' },
  { event: 'fail', from: 'in_progress', type: 'message_creation', status: 'failed' },
  { event: 'max_steps', from: 'in_progress', type: 'message_creation', status: 'completed' },
  { event: 'expire', from: 'requires_action', type: 'message_creation', status: 'completed' },
];

// ---------------------------------------------------------------------------
// 初始状态与 happy path
// ---------------------------------------------------------------------------

describe('RunStateMachine', () => {
  it('初始状态为 queued 且无步骤', () => {
    const machine = new RunStateMachine('run-init');
    expect(machine.getStatus()).toBe('queued');
    expect(machine.getSteps()).toHaveLength(0);
  });

  it('happy path：queued→start→in_progress→await_confirmation→requires_action→confirmation_granted→in_progress→stop→completed', () => {
    const machine = new RunStateMachine('run-happy');
    expect(machine.transition('start')).toBe('in_progress');
    expect(machine.transition('await_confirmation')).toBe('requires_action');
    expect(machine.transition('confirmation_granted')).toBe('in_progress');
    expect(machine.transition('stop')).toBe('completed');
    expect(machine.getStatus()).toBe('completed');
  });

  // -------------------------------------------------------------------------
  // 合法转移逐一断言（table-driven）
  // -------------------------------------------------------------------------

  it.each(LEGAL_TRANSITIONS)(
    '合法转移 $event：$from → $to',
    ({ event, from, to }) => {
      const machine = machineAt(from);
      expect(machine.getStatus()).toBe(from);
      expect(machine.transition(event)).toBe(to);
      expect(machine.getStatus()).toBe(to);
    },
  );

  // -------------------------------------------------------------------------
  // 非法转移抛 Error（消息含 from/event/to 的中文说明）
  // -------------------------------------------------------------------------

  it('completed 状态下触发 start 抛 Error，消息含 from/event', () => {
    const machine = machineAt('completed');
    expect(() => machine.transition('start')).toThrow(Error);
    expect(() => machine.transition('start')).toThrow(/from="completed".*event="start"/);
  });

  it('queued 状态下触发 stop 抛 Error（queued 无 stop 转移，应先 abort）', () => {
    const machine = machineAt('queued');
    expect(() => machine.transition('stop')).toThrow(/from="queued".*event="stop"/);
  });

  it('expired 状态下触发 confirmation_granted 抛 Error', () => {
    const machine = machineAt('expired');
    expect(() => machine.transition('confirmation_granted')).toThrow(
      /from="expired".*event="confirmation_granted"/,
    );
  });

  // -------------------------------------------------------------------------
  // RunStep 累积
  // -------------------------------------------------------------------------

  it('每次合法转移追加一条 RunStep（长度/类型/status 依序累积）', () => {
    const machine = new RunStateMachine('run-steps');
    machine.transition('start');
    machine.transition('await_confirmation');
    machine.transition('confirmation_granted');
    machine.transition('stop');

    const steps = machine.getSteps();
    expect(steps).toHaveLength(4);
    expect(steps.map((s) => s.type)).toEqual([
      'message_creation',
      'tool_calls',
      'tool_calls',
      'message_creation',
    ]);
    expect(steps.map((s) => s.status)).toEqual([
      'completed',
      'completed',
      'completed',
      'completed',
    ]);
  });

  it.each(STEP_SPEC_BY_EVENT)(
    '事件 $event 的 RunStep：type=$type、status=$status',
    ({ event, from, type, status }) => {
      const machine = machineAt(from, `run-${event}`);
      machine.transition(event);
      const step = machine.getSteps().at(-1);
      expect(step).toBeDefined();
      expect(step?.runId).toBe(`run-${event}`);
      expect(step?.type).toBe(type);
      expect(step?.status).toBe(status);
    },
  );

  it('RunStep 的 id 为 UUID、createdAt 为 ISO 8601 格式且 id 唯一', () => {
    const machine = new RunStateMachine('run-format');
    machine.transition('start');
    machine.transition('await_confirmation');
    machine.transition('confirmation_granted');
    machine.transition('fail');

    const steps = machine.getSteps();
    expect(steps).toHaveLength(4);
    for (const step of steps) {
      expect(step.id).toMatch(UUID_RE);
      expect(step.createdAt).toMatch(ISO_RE);
    }
    expect(new Set(steps.map((s) => s.id)).size).toBe(4);
  });
});
