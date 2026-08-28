/**
 * Eval runner 端到端测试（todo 8）。
 *
 * 真实链路：eval-env 注入 → 临时 DB → builtin 工具注册 → FakeAdapter 脚本
 * 回放 → 真实 agent loop + 工具执行 → trace 落库 → 规则评分 → eval_runs 落库。
 * 只覆盖 deterministic（live 不得在测试中真实调外部 LLM）。
 *
 * ⚠️ env 必须在所有 import 之前注入（builtins/index.ts 模块求值期读取
 * MYCOPILOT_E2E_TOOLS）；vi.hoisted 先于 import 执行，afterAll 恢复原始值，
 * 避免泄漏到同 worker 的后续测试文件（builtin-registry.test.ts 断言 12 个
 * executor，不受 e2e 开关影响）。
 */
const envSnapshot = vi.hoisted(() => {
  const keys = ['MYCOPILOT_E2E_TOOLS', 'CONTEXT_SUMMARIZE_THRESHOLD'] as const;
  const snapshot: Record<string, string | undefined> = {};
  for (const key of keys) snapshot[key] = process.env[key];
  process.env.MYCOPILOT_E2E_TOOLS = '1';
  process.env.CONTEXT_SUMMARIZE_THRESHOLD = '2000';
  return snapshot;
});

import { afterAll, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EvalScenario } from '@my-copilot/shared';
import { EVAL_ENV } from '../eval-env.js';
import { runScenario } from '../runner.js';
import { BUILTIN_SCENARIOS } from '../scenarios/index.js';
import { finalRound, toolRound } from '../scenarios/events.js';
import { getDb } from '../../db/index.js';
import { getSession } from '../../repo/session.js';
import { listMessagesBySession } from '../../repo/message.js';
import { listEvalRuns } from '../../repo/eval.js';
import { listSummariesBySession } from '../../repo/summary.js';
import { getToolApproval } from '../../repo/tool-approval.js';

afterAll(() => {
  for (const [key, value] of Object.entries(envSnapshot)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const byId = (id: string): EvalScenario => {
  const scenario = BUILTIN_SCENARIOS.find((s) => s.id === id);
  if (!scenario) throw new Error(`场景 ${id} 不存在`);
  return scenario;
};

/** 独立临时目录（显式传入 dataDir，测试内自管清理与断言查询）。 */
function freshDir(): string {
  return mkdtempSync(join(tmpdir(), 'my-copilot-eval-test-'));
}

function cleanupDir(dir: string): void {
  try {
    getDb().close();
  } catch {
    // ignore
  }
  rmSync(dir, { recursive: true, force: true });
}

describe('runScenario（deterministic 端到端）', () => {
  it('eval-env 静态表与测试注入值一致（防漂移守卫）', () => {
    expect(EVAL_ENV).toEqual({
      MYCOPILOT_E2E_TOOLS: '1',
      CONTEXT_SUMMARIZE_THRESHOLD: '2000',
    });
  });

  it('multi-step-tool-chain：跑通落 eval_runs，runs.user_message_id 是真实用户消息 id', async () => {
    const dir = freshDir();
    try {
      const run = await runScenario(byId('multi-step-tool-chain'), { dataDir: dir });

      expect(run.evalRun.status).toBe('pass');
      expect(run.evalRun.faultType).toBeNull();
      expect(run.evalRun.runTraceId).toBe(run.runTrace?.id ?? null);

      // eval_runs 落库（清旧插新的行级证据）
      const rows = listEvalRuns('multi-step-tool-chain');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        scenarioId: 'multi-step-tool-chain',
        mode: 'deterministic',
        status: 'pass',
        trial: 1,
      });
      expect(rows[0]!.runTraceId).toBe(run.runTrace!.id);

      // runs.user_message_id = 真实用户消息 id（非 assistant 占位 id）
      const messages = listMessagesBySession(run.sessionId);
      const userMsg = messages.find((m) => m.role === 'user');
      const assistantMsgs = messages.filter((m) => m.role === 'assistant');
      expect(userMsg).toBeDefined();
      expect(run.runTrace!.userMessageId).toBe(userMsg!.id);
      expect(assistantMsgs.some((m) => m.id === run.runTrace!.assistantMessageId)).toBe(true);
      expect(run.runTrace!.userMessageId).not.toBe(run.runTrace!.assistantMessageId);

      // eval 专用会话命名 + 真实工具执行序列
      expect(getSession(run.sessionId)?.title).toBe('[eval] multi-step-tool-chain');
      const toolNames = run.steps
        .filter((s) => s.type === 'tool_exec')
        .map((s) => s.toolName);
      expect(toolNames).toEqual(['calculator', 'json_format']);
      expect(run.steps.every((s) => !s.isError)).toBe(true);
    } finally {
      cleanupDir(dir);
    }
  });

  it('--replay-json 载荷序列化：{runTrace, steps, evalRun} JSON 往返无损（todo 9 回放契约）', async () => {
    const dir = freshDir();
    try {
      const run = await runScenario(byId('multi-step-tool-chain'), { dataDir: dir });
      // cli.ts --replay-json 写盘、回放端点读回的都是这个载荷的 JSON 序列化。
      const roundTripped = JSON.parse(
        JSON.stringify({ runTrace: run.runTrace, steps: run.steps, evalRun: run.evalRun }),
      ) as typeof run;

      expect(roundTripped.evalRun.scenarioId).toBe('multi-step-tool-chain');
      expect(roundTripped.evalRun.status).toBe('pass');
      expect(roundTripped.runTrace?.status).toBe('completed');
      const toolSteps = roundTripped.steps.filter((s) => s.type === 'tool_exec');
      expect(toolSteps.map((s) => s.toolName)).toEqual(['calculator', 'json_format']);
      // 注：不断言 durationMs > 0 —— 计时粒度在满负荷套件下可为 0，
      // 序列化契约只保证字段经 JSON 往返不丢失（typeof number）。
      expect(toolSteps.every((s) => typeof s.durationMs === 'number')).toBe(true);
    } finally {
      cleanupDir(dir);
    }
  });

  it('approval-approve-flow：自动批准确认请求，tool_approvals 终态 approved', async () => {
    const dir = freshDir();
    try {
      const run = await runScenario(byId('approval-approve-flow'), { dataDir: dir });

      expect(run.evalRun.status).toBe('pass');
      expect(run.approvalIds.length).toBeGreaterThan(0);
      for (const id of run.approvalIds) {
        expect(getToolApproval(id)?.state).toBe('approved');
      }
      // 工具真实执行（非拒绝合成结果）
      const toolStep = run.steps.find((s) => s.type === 'tool_exec');
      expect(toolStep?.toolName).toBe('e2e_danger_tool');
      expect(toolStep?.isError).toBe(false);
    } finally {
      cleanupDir(dir);
    }
  });

  it('approval-reject-flow：自动拒绝，工具未执行（tool_sequence 为空）', async () => {
    const dir = freshDir();
    try {
      const run = await runScenario(byId('approval-reject-flow'), { dataDir: dir });

      expect(run.evalRun.status).toBe('pass');
      expect(getToolApproval(run.approvalIds[0]!)?.state).toBe('rejected');
      const seqAssertion = run.evalRun.assertionResults.find(
        (a) => a.kind === 'tool_sequence',
      );
      expect(seqAssertion?.pass).toBe(true);
    } finally {
      cleanupDir(dir);
    }
  });

  it('user-abort-partial：首个工具结果后同步 abort → cancelled', async () => {
    const dir = freshDir();
    try {
      const run = await runScenario(byId('user-abort-partial'), { dataDir: dir });

      expect(run.evalRun.status).toBe('pass');
      expect(run.runTrace?.status).toBe('cancelled');
      expect(run.runTrace?.stopReason).toBe('user_interrupt');
    } finally {
      cleanupDir(dir);
    }
  });

  it('repeat-call-guard：skipped 合成步骤计入 tool_sequence（calculator×3）', async () => {
    const dir = freshDir();
    try {
      const run = await runScenario(byId('repeat-call-guard'), { dataDir: dir });

      expect(run.evalRun.status).toBe('pass');
      const toolSteps = run.steps.filter((s) => s.type === 'tool_exec');
      expect(toolSteps.map((s) => s.toolName)).toEqual([
        'calculator',
        'calculator',
        'calculator',
      ]);
      // 1 次真实执行 + 2 次 skipped isError（后两次被熔断跳过）
      expect(toolSteps.map((s) => s.isError)).toEqual([false, true, true]);
    } finally {
      cleanupDir(dir);
    }
  });

  it('max-steps-termination：maxSteps=2 → incomplete + max_steps_hit', async () => {
    const dir = freshDir();
    try {
      const run = await runScenario(byId('max-steps-termination'), { dataDir: dir });

      expect(run.evalRun.status).toBe('pass');
      expect(run.runTrace?.status).toBe('incomplete');
      expect(run.runTrace?.stopReason).toBe('max_steps');
    } finally {
      cleanupDir(dir);
    }
  });

  it('tool-error-recovery：isError true→false 恢复轨迹', async () => {
    const dir = freshDir();
    try {
      const run = await runScenario(byId('tool-error-recovery'), { dataDir: dir });

      expect(run.evalRun.status).toBe('pass');
      const errors = run.steps
        .filter((s) => s.type === 'tool_exec')
        .map((s) => s.isError);
      expect(errors).toEqual([true, false]);
    } finally {
      cleanupDir(dir);
    }
  });

  it('summarization-trigger：CONTEXT_SUMMARIZE_THRESHOLD=2000 触发摘要落库', async () => {
    const dir = freshDir();
    try {
      const run = await runScenario(byId('summarization-trigger'), { dataDir: dir });

      expect(run.evalRun.status).toBe('pass');
      expect(run.evalRun.metrics.steps_used).toBe(6);
      expect(listSummariesBySession(run.sessionId).length).toBeGreaterThan(0);
    } finally {
      cleanupDir(dir);
    }
  });

  it('context-degradation：degraded=true + 最终装配消息截断校验', async () => {
    const dir = freshDir();
    try {
      const run = await runScenario(byId('context-degradation'), { dataDir: dir });

      expect(run.evalRun.status).toBe('pass');
      expect(run.runTrace?.degraded).toBe(true);
      const degradedAssertion = run.evalRun.assertionResults.find(
        (a) => a.kind === 'degraded',
      );
      expect(degradedAssertion?.pass).toBe(true);
    } finally {
      cleanupDir(dir);
    }
  });

  it('必失败断言场景：eval_runs 记录 fail + goal_incomplete 归因', async () => {
    const dir = freshDir();
    try {
      const scenario = structuredClone(byId('multi-step-tool-chain'));
      scenario.assertions = [{ kind: 'status', expected: 'failed' }];
      const run = await runScenario(scenario, { dataDir: dir });

      expect(run.evalRun.status).toBe('fail');
      expect(run.evalRun.faultType).toBe('goal_incomplete');
      expect(listEvalRuns(scenario.id)[0]).toMatchObject({ status: 'fail' });
    } finally {
      cleanupDir(dir);
    }
  });

  it('场景总超时兜底：挂起的审批被短超时 abort，faultType=timeout', async () => {
    const dir = freshDir();
    try {
      // danger 工具 + 无 behavior.approval → 审批等待 300s；
      // 注入 200ms 总超时验证兜底机制（不必真等 60s）。
      const hungScenario: EvalScenario = {
        id: 'timeout-guard-probe',
        name: '超时兜底探针',
        description: '审批无人处理，依赖场景总超时兜底',
        category: 'safety',
        mode: 'deterministic',
        tools: ['e2e_danger_tool'],
        userMessage: '请执行危险工具（无人会批准）',
        replayable: false,
        requiredEnv: { MYCOPILOT_E2E_TOOLS: '1' },
        script: [
          toolRound({
            calls: [{ id: 'call-hung-1', name: 'e2e_danger_tool', args: {} }],
          }),
          finalRound('不应到达这里'),
        ],
        assertions: [{ kind: 'status', expected: 'completed' }],
      };
      const startedAt = Date.now();
      const run = await runScenario(hungScenario, { dataDir: dir, timeoutMs: 200 });

      expect(Date.now() - startedAt).toBeLessThan(10_000);
      expect(run.evalRun.status).toBe('fail');
      expect(run.evalRun.faultType).toBe('timeout');
      expect(run.runTrace?.status).toBe('cancelled');
    } finally {
      cleanupDir(dir);
    }
  });

  it('场景所需工具未注册 → 抛出明确错误', async () => {
    const dir = freshDir();
    try {
      const scenario = structuredClone(byId('multi-step-tool-chain'));
      scenario.tools = ['nonexistent_tool'];
      await expect(
        runScenario(scenario, { dataDir: dir, timeoutMs: 2_000 }),
      ).rejects.toThrow('nonexistent_tool');
    } finally {
      cleanupDir(dir);
    }
  });

  it('临时目录自清理：缺省 dataDir 运行后目录删除；--keep-db 语义保留', async () => {
    // 缺省：自建 tmpdir/eval-* 并自清理
    const auto = await runScenario(byId('multi-step-tool-chain'));
    expect(existsSync(auto.dataDir)).toBe(false);

    // keepDb：目录保留，由调用方负责清理
    const kept = await runScenario(byId('multi-step-tool-chain'), { keepDb: true });
    expect(existsSync(kept.dataDir)).toBe(true);
    cleanupDir(kept.dataDir);
  });
});
