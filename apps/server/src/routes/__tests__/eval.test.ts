/**
 * /api/eval/* 只读端点测试（todo 9）。
 *
 * 回放子进程全部以 vi.mock('node:child_process') 替换——测试绝不真实
 * spawn npx（慢且脆）；真实子进程冒烟见 .omo/evidence/task-9-*.txt。
 * 快照读取以可控的 node:fs readFileSync 覆盖模拟「缺失/损坏」。
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { Hono } from 'hono';
import { errorMiddleware } from '../../middleware/error.js';
import { tokenAuthMiddleware } from '../../middleware/tokenAuth.js';
import { initDatabase, getDb } from '../../db/index.js';

const snapshotControls = vi.hoisted(() => ({
  /** undefined = 读真实快照文件；string = 内容覆盖；Error = 模拟缺失/不可读。 */
  file: undefined as string | Error | undefined,
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    readFileSync: vi.fn((...args: Parameters<typeof actual.readFileSync>) => {
      const path = args[0];
      if (
        snapshotControls.file !== undefined &&
        typeof path === 'string' &&
        path.endsWith(join('eval', 'snapshot.json'))
      ) {
        if (snapshotControls.file instanceof Error) throw snapshotControls.file;
        return snapshotControls.file;
      }
      return actual.readFileSync(...args);
    }),
  };
});

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));

import { spawn } from 'node:child_process';
import { evalApp } from '../eval.js';
import { runReplay } from '../eval-replay.js';

type ApiResponse<T = unknown> = { code: number; msg: string; data: T };

/** 子进程回放载荷样板（对齐 cli.ts --replay-json 写出的形状）。 */
const replayPayload = {
  runTrace: {
    id: 'run-replay-1',
    sessionId: 'eval-session',
    userMessageId: 'u1',
    assistantMessageId: 'a1',
    agentId: null,
    jobId: null,
    status: 'completed',
    stopReason: 'end_turn',
    iterations: 2,
    budgetSnapshot: null,
    degraded: false,
    totalTokens: 120,
    startedAt: '2026-08-28T00:00:00.000Z',
    endedAt: '2026-08-28T00:00:02.000Z',
    error: null,
  },
  steps: [
    {
      id: 'st1',
      runId: 'run-replay-1',
      seq: 1,
      type: 'llm_call',
      toolName: null,
      argsPreview: null,
      resultPreview: null,
      isError: false,
      durationMs: 40,
      createdAt: '2026-08-28T00:00:00.400Z',
    },
    {
      id: 'st2',
      runId: 'run-replay-1',
      seq: 2,
      type: 'tool_exec',
      toolName: 'calculator',
      argsPreview: '{"expression":"2+3"}',
      resultPreview: '5',
      isError: false,
      durationMs: 12,
      createdAt: '2026-08-28T00:00:00.600Z',
    },
    {
      id: 'st3',
      runId: 'run-replay-1',
      seq: 3,
      type: 'tool_exec',
      toolName: 'json_format',
      argsPreview: '{"json":"{\\"result\\":5}"}',
      resultPreview: '{\n  "result": 5\n}',
      isError: false,
      durationMs: 8,
      createdAt: '2026-08-28T00:00:00.800Z',
    },
  ],
  evalRun: {
    scenarioId: 'multi-step-tool-chain',
    mode: 'deterministic',
    status: 'pass',
    metrics: { steps_used: 2, llm_calls: 2, duration_ms: 120, tokens_estimated: 120 },
    faultType: null,
    runTraceId: 'run-replay-1',
    assertionResults: [],
  },
};

interface FakeChild extends EventEmitter {
  kill: ReturnType<typeof vi.fn>;
  stderr: EventEmitter;
}

function makeFakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.kill = vi.fn();
  child.stderr = new EventEmitter();
  return child;
}

/** 每次 spawn 的行为脚本：写回放文件后退出 / 永不退出（挂起）/ 直接退出不写文件。 */
type SpawnPlan =
  | { kind: 'ok'; exitCode?: number }
  | { kind: 'hang' }
  | { kind: 'exit-no-file'; exitCode?: number };

let plans: SpawnPlan[] = [];
let hungChildren: Array<{ child: FakeChild; tmpFile: string }> = [];

function releaseHungChildren(): void {
  for (const { child, tmpFile } of hungChildren.splice(0)) {
    writeFileSync(tmpFile, JSON.stringify(replayPayload));
    child.emit('exit', 0);
  }
}

function lastSpawnTmpFile(): string {
  const args = vi.mocked(spawn).mock.calls.at(-1)?.[1] ?? [];
  return args.at(-1) ?? '';
}

const TEST_DB_DIR = join(tmpdir(), 'eval-route-test-');

beforeAll(() => {
  mkdirSync(TEST_DB_DIR, { recursive: true });
  initDatabase(TEST_DB_DIR);
  getDb()
    .prepare("INSERT OR REPLACE INTO config (key, value) VALUES ('auth_token', 'admin-token-t9')")
    .run();
});

afterAll(() => {
  rmSync(TEST_DB_DIR, { recursive: true, force: true });
});

beforeEach(() => {
  vi.clearAllMocks();
  snapshotControls.file = undefined;
  plans = [];
  hungChildren = [];
  vi.mocked(spawn).mockImplementation(
    ((_cmd: string, args: readonly string[]) => {
      const child = makeFakeChild();
      const tmpFile = args.at(-1) ?? 'replay.json';
      const plan: SpawnPlan = plans.shift() ?? { kind: 'ok' };
      if (plan.kind === 'ok') {
        setImmediate(() => {
          writeFileSync(tmpFile, JSON.stringify(replayPayload));
          child.emit('exit', plan.exitCode ?? 0);
        });
      } else if (plan.kind === 'exit-no-file') {
        setImmediate(() => child.emit('exit', plan.exitCode ?? 1));
      } else {
        hungChildren.push({ child, tmpFile });
      }
      // FakeChild 与 ChildProcess 结构不同——mock 边界的唯一类型桥接点。
      return child as unknown as ChildProcess;
    }) as typeof spawn,
  );
});

function createEvalAppOnly() {
  const app = new Hono();
  app.onError(errorMiddleware());
  app.route('/api/eval', evalApp);
  return app;
}

describe('GET /api/eval/snapshot', () => {
  it('返回已提交快照：scenarios 数组 + generatedAt + aggregate', async () => {
    const res = await createEvalAppOnly().request('/api/eval/snapshot');
    expect(res.status).toBe(200);
    const body = (await res.json()) as ApiResponse<{
      generatedAt: string;
      scenarios: unknown[];
      aggregate: { passRate: number };
    }>;
    expect(body.code).toBe(0);
    expect(typeof body.data.generatedAt).toBe('string');
    expect(Array.isArray(body.data.scenarios)).toBe(true);
    expect(body.data.scenarios.length).toBeGreaterThanOrEqual(9);
    expect(typeof body.data.aggregate.passRate).toBe('number');
  });

  it('快照缺失时兜底 {scenarios:[], generatedAt:null}，不 500（stale_state）', async () => {
    snapshotControls.file = new Error('ENOENT: snapshot.json missing');
    const res = await createEvalAppOnly().request('/api/eval/snapshot');
    expect(res.status).toBe(200);
    const body = (await res.json()) as ApiResponse<unknown>;
    expect(body.data).toEqual({ scenarios: [], generatedAt: null });
  });

  it('快照损坏（非法 JSON）同样兜底空结构', async () => {
    snapshotControls.file = '{{{corrupted';
    const res = await createEvalAppOnly().request('/api/eval/snapshot');
    expect(res.status).toBe(200);
    const body = (await res.json()) as ApiResponse<unknown>;
    expect(body.data).toEqual({ scenarios: [], generatedAt: null });
  });
});

describe('GET /api/eval/scenarios', () => {
  it('返回 19 项场景元数据（9 deterministic + 10 live），不含 script 全文', async () => {
    const res = await createEvalAppOnly().request('/api/eval/scenarios');
    expect(res.status).toBe(200);
    const body = (await res.json()) as ApiResponse<
      Array<{
        id: string;
        name: string;
        description: string;
        category: string;
        mode: string;
        replayable: boolean;
      }>
    >;
    expect(body.data).toHaveLength(19);
    expect(body.data.filter((s) => s.mode === 'deterministic')).toHaveLength(9);
    expect(body.data.filter((s) => s.mode === 'live')).toHaveLength(10);
    for (const item of body.data) {
      expect(item.id).toBeTruthy();
      expect(item.name).toBeTruthy();
      expect(item.description).toBeTruthy();
      expect(item).not.toHaveProperty('script');
      expect(item).not.toHaveProperty('userMessage');
      expect(item).not.toHaveProperty('assertions');
    }
    const multi = body.data.find((s) => s.id === 'multi-step-tool-chain');
    expect(multi?.replayable).toBe(true);
    const live = body.data.find((s) => s.id === 'live-calculator-arithmetic');
    expect(live?.replayable).toBe(false);
  });
});

describe('GET /api/eval/scenarios/:id/replay', () => {
  it('回放成功：返回 {runTrace, steps, evalRun}，含 2 条 tool_exec 且 durationMs>0', async () => {
    const res = await createEvalAppOnly().request(
      '/api/eval/scenarios/multi-step-tool-chain/replay',
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as ApiResponse<{
      runTrace: { id: string };
      steps: Array<{ type: string; durationMs: number }>;
      evalRun: { scenarioId: string; status: string };
    }>;
    expect(body.code).toBe(0);
    expect(body.data.runTrace.id).toBe('run-replay-1');
    expect(body.data.evalRun).toMatchObject({
      scenarioId: 'multi-step-tool-chain',
      status: 'pass',
    });
    const toolSteps = body.data.steps.filter((s) => s.type === 'tool_exec');
    expect(toolSteps).toHaveLength(2);
    expect(toolSteps.every((s) => s.durationMs > 0)).toBe(true);
    // S1-1 子进程契约：npx tsx src/eval/cli.ts，cwd 为 apps/server 包根
    expect(spawn).toHaveBeenCalledWith(
      'npx',
      ['tsx', 'src/eval/cli.ts', '--scenario', 'multi-step-tool-chain', '--replay-json', expect.any(String)],
      expect.objectContaining({ cwd: expect.stringMatching(/apps[\\/]server$/) }),
    );
  });

  it('live 场景回放 → 400，且不 spawn 子进程', async () => {
    const res = await createEvalAppOnly().request(
      '/api/eval/scenarios/live-calculator-arithmetic/replay',
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as ApiResponse<null>;
    expect(body.code).toBe(400);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('未知场景 id → 404（malformed input 语义）', async () => {
    const res = await createEvalAppOnly().request(
      '/api/eval/scenarios/no-such-scenario/replay',
    );
    expect(res.status).toBe(404);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('子进程退出但未写回放文件 → 500 failed', async () => {
    plans = [{ kind: 'exit-no-file', exitCode: 1 }];
    const res = await createEvalAppOnly().request(
      '/api/eval/scenarios/multi-step-tool-chain/replay',
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as ApiResponse<null>;
    expect(body.code).toBe(500);
  });

  it('并发第 3 个回放 → 429；前两个释放后 200（进程内信号量）', async () => {
    plans = [{ kind: 'hang' }, { kind: 'hang' }];
    const app = createEvalAppOnly();
    const url = '/api/eval/scenarios/multi-step-tool-chain/replay';
    const p1 = app.request(url);
    const p2 = app.request(url);
    const r3 = await app.request(url);
    expect(r3.status).toBe(429);
    expect(spawn).toHaveBeenCalledTimes(2);
    releaseHungChildren();
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
  });

  it('回放前后主库 sessions/runs/run_steps 行数不变（隔离性硬断言）', async () => {
    const db = getDb();
    const count = (sql: string) =>
      (db.prepare(sql).get() as { n: number }).n;
    const before = [
      count('SELECT COUNT(*) AS n FROM sessions'),
      count('SELECT COUNT(*) AS n FROM runs'),
      count('SELECT COUNT(*) AS n FROM run_steps'),
    ];
    const res = await createEvalAppOnly().request(
      '/api/eval/scenarios/multi-step-tool-chain/replay',
    );
    expect(res.status).toBe(200);
    const after = [
      count('SELECT COUNT(*) AS n FROM sessions'),
      count('SELECT COUNT(*) AS n FROM runs'),
      count('SELECT COUNT(*) AS n FROM run_steps'),
    ];
    expect(after).toEqual(before);
  });

  it('tmpfile 目录在成功路径后被清理', async () => {
    const res = await createEvalAppOnly().request(
      '/api/eval/scenarios/multi-step-tool-chain/replay',
    );
    expect(res.status).toBe(200);
    expect(existsSync(dirname(lastSpawnTmpFile()))).toBe(false);
  });

  it('tmpfile 目录在失败路径（未写文件退出）后同样被清理', async () => {
    plans = [{ kind: 'exit-no-file', exitCode: 2 }];
    const res = await createEvalAppOnly().request(
      '/api/eval/scenarios/multi-step-tool-chain/replay',
    );
    expect(res.status).toBe(500);
    expect(existsSync(dirname(lastSpawnTmpFile()))).toBe(false);
  });
});

describe('runReplay 子进程护栏（直接调用，注入短超时）', () => {
  it('挂死子进程：50ms 超时 kill → timeout，kill 被调，信号量释放', async () => {
    plans = [{ kind: 'hang' }];
    const outcome = await runReplay('multi-step-tool-chain', { timeoutMs: 50 });
    expect(outcome).toEqual({ reason: 'timeout' });
    expect(hungChildren[0]?.child.kill).toHaveBeenCalled();
    expect(existsSync(dirname(hungChildren[0]?.tmpFile ?? ''))).toBe(false);
    // 信号量已释放：下一次调用不再 busy
    const next = await runReplay('multi-step-tool-chain', { timeoutMs: 1_000 });
    expect(next.reason).toBe('ok');
  });

  it('busy 结果原样返回（信号量满，不 spawn）', async () => {
    plans = [{ kind: 'hang' }, { kind: 'hang' }];
    const first = runReplay('multi-step-tool-chain', { timeoutMs: 5_000 });
    const second = runReplay('multi-step-tool-chain', { timeoutMs: 5_000 });
    const third = await runReplay('multi-step-tool-chain', { timeoutMs: 5_000 });
    expect(third).toEqual({ reason: 'busy' });
    releaseHungChildren();
    expect((await first).reason).toBe('ok');
    expect((await second).reason).toBe('ok');
  });
});

describe('demo 白名单放行三端点', () => {
  function createDemoApp() {
    const app = new Hono();
    app.use('/api/*', tokenAuthMiddleware(['/api/health'], 'demo-token-t9'));
    app.onError(errorMiddleware());
    app.route('/api/eval', evalApp);
    app.get('/api/providers', (c) => c.json({ data: [] }));
    return app;
  }

  it('demo token GET snapshot / scenarios / replay 均 200，/api/providers 403', async () => {
    const app = createDemoApp();
    const headers = { Authorization: 'Bearer demo-token-t9' };

    const snapshot = await app.request('/api/eval/snapshot', { headers });
    expect(snapshot.status).toBe(200);

    const scenarios = await app.request('/api/eval/scenarios', { headers });
    expect(scenarios.status).toBe(200);
    const list = ((await scenarios.json()) as ApiResponse<unknown[]>).data;
    expect(list).toHaveLength(19);

    const replay = await app.request(
      '/api/eval/scenarios/multi-step-tool-chain/replay',
      { headers },
    );
    expect(replay.status).toBe(200);

    const providers = await app.request('/api/providers', { headers });
    expect(providers.status).toBe(403);
  });

  it('未带 token 访问 eval 端点 → 401（白名单不绕过认证）', async () => {
    const res = await createDemoApp().request('/api/eval/snapshot');
    expect(res.status).toBe(401);
  });
});
