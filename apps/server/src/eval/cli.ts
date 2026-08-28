/**
 * pnpm eval CLI（todo 8）。tsx 直跑：`pnpm eval -- [--mode ...] [--scenario id]`
 *
 * 用法：
 *   --mode deterministic|live|all   默认 deterministic
 *   --scenario <id>                 单场景（调试 / todo 9 回放）
 *   --report                        生成快照 apps/server/src/eval/snapshot.json
 *   --keep-db                       保留临时数据库目录（调试）
 *   --replay-json <path>            跑单个 deterministic 场景，把
 *                                   {runTrace, steps, evalRun} 写入 JSON 后退出
 *
 * 退出码：确定性场景任一 fail → 非零（迭代回归门禁）；live 不影响退出码。
 */
import './eval-env.js';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EvalRunResult, EvalSnapshot } from '@my-copilot/shared';
import { initDatabase, getDb } from '../db/index.js';
import { deleteEvalRuns } from '../repo/eval.js';
import { aggregateLiveResult, buildAggregate } from './aggregate.js';
import { runScenario } from './runner.js';
import type { ScenarioRunResult } from './runner.js';
import { BUILTIN_SCENARIOS } from './scenarios/index.js';

/** live 预估平均轮次（成本护栏打印用）。 */
const ESTIMATED_LLM_ROUNDS = 3;

/** 快照输出路径：镜像 db/index.ts 的 readFileSync(__dirname) 资产模式（todo 9 读取）。 */
const SNAPSHOT_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  'snapshot.json',
);

interface CliArgs {
  mode: 'deterministic' | 'live' | 'all';
  scenario?: string;
  report: boolean;
  keepDb: boolean;
  replayJson?: string;
}

function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = { mode: 'deterministic', report: false, keepDb: false };
  // pnpm 会把 `pnpm eval -- --scenario x` 的 `--` 分隔符原样传给脚本，剥掉。
  const tokens = argv[0] === '--' ? argv.slice(1) : argv;
  for (let i = 0; i < tokens.length; i += 1) {
    const arg = tokens[i]!;
    if (arg === '--mode') {
      const value = tokens[i + 1];
      if (value !== 'deterministic' && value !== 'live' && value !== 'all') {
        throw new Error(`--mode 取值必须是 deterministic|live|all，收到 "${value ?? '(缺失)'}"`);
      }
      args.mode = value;
      i += 1;
    } else if (arg === '--scenario') {
      const value = tokens[i + 1];
      if (!value) throw new Error('--scenario 需要一个场景 id 参数');
      args.scenario = value;
      i += 1;
    } else if (arg === '--report') {
      args.report = true;
    } else if (arg === '--keep-db') {
      args.keepDb = true;
    } else if (arg === '--replay-json') {
      const value = tokens[i + 1];
      if (!value) throw new Error('--replay-json 需要一个输出文件路径参数');
      args.replayJson = value;
      i += 1;
    } else {
      throw new Error(`未知参数：${arg}`);
    }
  }
  return args;
}

function readGitCommit(): string {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
  } catch {
    return 'unknown';
  }
}

function printResult(result: EvalRunResult, runStatus: string | null): void {
  const mark = result.status === 'pass' ? 'PASS' : 'FAIL';
  const m = result.metrics;
  console.log(
    `${mark}  ${result.scenarioId}` +
      ` status=${runStatus ?? '-'} steps=${m.steps_used ?? '-'}` +
      ` llm_calls=${m.llm_calls ?? '-'} tokens≈${m.tokens_estimated ?? '-'}` +
      ` duration=${m.duration_ms ?? '-'}ms` +
      `${result.faultType ? ` fault=${result.faultType}` : ''}`,
  );
  for (const a of result.assertionResults) {
    console.log(`      [${a.pass ? 'ok' : 'FAIL'}] ${a.kind}: ${a.detail}`);
  }
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const scenarios = BUILTIN_SCENARIOS.filter(
    (s) =>
      (args.mode === 'all' || s.mode === args.mode) &&
      (args.scenario === undefined || s.id === args.scenario),
  );
  if (scenarios.length === 0) {
    console.error(
      `[eval] 没有匹配的场景（mode=${args.mode}${args.scenario ? ` scenario=${args.scenario}` : ''}）`,
    );
    return 2;
  }
  const deterministic = scenarios.filter((s) => s.mode === 'deterministic');
  const live = scenarios.filter((s) => s.mode === 'live');
  console.log(
    `[eval] 模式 ${args.mode} | 场景 ${scenarios.length} 个（deterministic ${deterministic.length} / live ${live.length}）| git ${readGitCommit().slice(0, 7)}`,
  );

  // 回放模式：单 deterministic 场景 → {runTrace, steps, evalRun} JSON 后退出。
  if (args.replayJson !== undefined) {
    if (deterministic.length !== 1) {
      console.error('[eval] --replay-json 需要 --scenario 指定唯一 deterministic 场景');
      return 2;
    }
    const run = await runScenario(deterministic[0]!, { keepDb: args.keepDb });
    writeFileSync(
      args.replayJson,
      JSON.stringify(
        { runTrace: run.runTrace, steps: run.steps, evalRun: run.evalRun },
        null,
        2,
      ),
    );
    console.log(`[eval] 回放结果已写入 ${args.replayJson}`);
    printResult(run.evalRun, run.runTrace?.status ?? null);
    return run.evalRun.status === 'pass' ? 0 : 1;
  }

  // 成本护栏：live 启动前打印 LLM 调用次数估算（场景数 × trials × 平均轮次）。
  if (live.length > 0) {
    const totalTrials = live.reduce((sum, s) => sum + (s.trials ?? 3), 0);
    console.log(
      `[eval] live 预估 LLM 调用 ≈ ${live.length} 场景 × ${totalTrials} trials × ~${ESTIMATED_LLM_ROUNDS} 轮 = ${live.length * totalTrials * ESTIMATED_LLM_ROUNDS} 次`,
    );
  }

  const baseDir = mkdtempSync(join(tmpdir(), 'eval-run-'));
  initDatabase(baseDir); // 全部场景共享本次运行的临时库（清旧插新 + 聚合的基础）
  const deterministicResults: EvalRunResult[] = [];
  const liveResults: EvalRunResult[] = [];
  let infraErrors = 0;

  for (const scenario of deterministic) {
    deleteEvalRuns(scenario.id, 'deterministic'); // 清旧插新（替换语义）
    try {
      const run = await runScenario(scenario, { dataDir: baseDir });
      deterministicResults.push(run.evalRun);
      printResult(run.evalRun, run.runTrace?.status ?? null);
    } catch (err) {
      infraErrors += 1;
      console.error(
        `[eval] 场景 ${scenario.id} 执行异常：${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  for (const scenario of live) {
    deleteEvalRuns(scenario.id, 'live');
    const trialRuns: ScenarioRunResult[] = [];
    for (let trial = 1; trial <= (scenario.trials ?? 3); trial += 1) {
      // live trials 严格串行（不并发打 provider）。
      try {
        trialRuns.push(
          await runScenario(scenario, { dataDir: baseDir, trial }),
        );
      } catch (err) {
        infraErrors += 1;
        console.error(
          `[eval] 场景 ${scenario.id} trial ${trial} 执行异常：${err instanceof Error ? err.message : String(err)}`,
        );
        break;
      }
    }
    const aggregated = aggregateLiveResult(scenario, trialRuns);
    liveResults.push(aggregated);
    printResult(aggregated, trialRuns[0]?.runTrace?.status ?? null);
  }

  const passed = deterministicResults.filter((r) => r.status === 'pass').length;
  const aggregate = buildAggregate(BUILTIN_SCENARIOS, deterministicResults);
  console.log(
    `[eval] deterministic 汇总: PASS ${passed}/${deterministicResults.length}` +
      ` | passRate=${aggregate.passRate} | avgSteps=${aggregate.avgSteps}` +
      ` | 恢复类 recoveryRate=${aggregate.recoveryRate}`,
  );
  if (liveResults.length > 0) {
    const livePassed = liveResults.filter((r) => r.status === 'pass').length;
    console.log(`[eval] live 汇总（不影响退出码）: pass^k 一致通过 ${livePassed}/${liveResults.length}`);
  }

  if (args.report) {
    // 快照只冻结 deterministic 结果（live 结果机器相关，不随 git 分发）。
    const snapshot: EvalSnapshot = {
      generatedAt: new Date().toISOString(),
      gitCommit: readGitCommit(),
      scenarios: deterministicResults,
      aggregate,
    };
    writeFileSync(SNAPSHOT_PATH, `${JSON.stringify(snapshot, null, 2)}\n`);
    console.log(`[eval] 快照已生成 ${SNAPSHOT_PATH}`);
  }

  try {
    getDb().close();
  } catch {
    // 已关闭——忽略。
  }
  if (args.keepDb) {
    console.log(`[eval] 保留临时数据库：${baseDir}`);
  } else {
    rmSync(baseDir, { recursive: true, force: true });
    console.log('[eval] 临时数据库目录已清理');
  }

  return infraErrors > 0 || passed < deterministicResults.length ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('[eval] CLI 异常退出：', err);
    process.exit(1);
  });
