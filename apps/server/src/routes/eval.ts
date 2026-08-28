/**
 * 只读评估端点（todo 9）：快照分发 / 场景列表 / 确定性回放。
 *
 * 机制注记（双轨设计）：快照 = 生成时点的冻结指标（版本化、随 git 分发）；
 * 回放 = 以当前代码现场确定性重放。二者数值差异是预期特性而非不一致。
 *
 * 全部 GET 只读、无写端点；场景列表不暴露 script 全文（评估提示词资产
 * 不外泄）。回放走子进程（eval-replay.ts），server 主进程绝不调
 * initDatabase / 切换 DB。
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import type { EvalSnapshot } from '@my-copilot/shared';
import { BUILTIN_SCENARIOS } from '../eval/scenarios/index.js';
import { runReplay } from './eval-replay.js';
import { successResponse } from '../utils/response.js';
import { HttpError } from '../middleware/error.js';

export const evalApp = new Hono();

// 快照资产路径：镜像 db/index.ts 的 readFileSync(__dirname) 资产模式
// （tsx 开发与 docker 从 src 直跑均可达）。按请求读取而非模块期读取：
// 文件缺失/损坏时兜底空结构（绝不 500，更不能让 server 启动崩溃），
// 且重新生成快照无需重启服务。
const SNAPSHOT_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'eval',
  'snapshot.json',
);

function loadSnapshot(): EvalSnapshot | null {
  try {
    return JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf-8')) as EvalSnapshot;
  } catch {
    return null;
  }
}

// GET /api/eval/snapshot — 冻结成绩单；缺失/损坏兜底 {scenarios:[], generatedAt:null}。
evalApp.get('/snapshot', (c) => {
  const snapshot = loadSnapshot();
  if (snapshot === null) {
    return successResponse(c, { scenarios: [], generatedAt: null });
  }
  return successResponse(c, snapshot);
});

// GET /api/eval/scenarios — 场景元数据列表（不含 script 全文与断言细节）。
evalApp.get('/scenarios', (c) => {
  const scenarios = BUILTIN_SCENARIOS.map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    category: s.category,
    mode: s.mode,
    replayable: s.replayable ?? true,
  }));
  return successResponse(c, scenarios);
});

// GET /api/eval/scenarios/:id/replay — 现场确定性回放（子进程执行）。
// 仅 deterministic 且 replayable !== false；live / 显式不可重放 → 400。
evalApp.get('/scenarios/:id/replay', async (c) => {
  const scenario = BUILTIN_SCENARIOS.find((s) => s.id === c.req.param('id'));
  if (scenario === undefined) {
    throw new HttpError(404, 'Scenario not found');
  }
  if (scenario.mode !== 'deterministic' || scenario.replayable === false) {
    throw new HttpError(400, 'Scenario is not replayable');
  }
  const outcome = await runReplay(scenario.id);
  switch (outcome.reason) {
    case 'ok':
      return successResponse(c, {
        runTrace: outcome.runTrace,
        steps: outcome.steps,
        evalRun: outcome.evalRun,
      });
    case 'busy':
      throw new HttpError(429, 'Too many concurrent replays, retry later');
    case 'timeout':
      throw new HttpError(504, 'Replay subprocess timed out');
    case 'failed':
      throw new HttpError(500, outcome.detail);
    default: {
      // 穷尽性守卫：ReplayOutcome 新增变体时在此编译期暴露。
      const exhausted: never = outcome;
      throw new HttpError(500, `Unexpected replay outcome: ${String(exhausted)}`);
    }
  }
});
