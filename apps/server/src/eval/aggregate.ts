/**
 * eval 结果聚合（todo 8）：live trials 的 pass^k 一致性统计与
 * EvalSnapshot.aggregate 汇总指标。纯函数，无 DB / IO。
 */
import type {
  EvalRunResult,
  EvalScenario,
  EvalSnapshot,
} from '@my-copilot/shared';
import type { ScenarioRunResult } from './runner.js';

/** live trials → 场景级聚合结果（pass^k = 全部 trial 一致通过）。 */
export function aggregateLiveResult(
  scenario: EvalScenario,
  runs: readonly ScenarioRunResult[],
): EvalRunResult {
  const trials = scenario.trials ?? 3;
  const passed = runs.filter((r) => r.evalRun.status === 'pass');
  const allPassed = runs.length === trials && passed.length === trials;
  const mean = (key: string): number =>
    runs.length === 0
      ? 0
      : Math.round(
          (runs.reduce((sum, r) => sum + (r.evalRun.metrics[key] ?? 0), 0) /
            runs.length) *
            100,
        ) / 100;
  // 按 kind 合并：全部 trial 通过该断言才算通过。
  const byKind = new Map(
    (runs[0]?.evalRun.assertionResults ?? []).map((a) => [a.kind, a]),
  );
  for (const run of runs.slice(1)) {
    for (const a of run.evalRun.assertionResults) {
      const merged = byKind.get(a.kind);
      if (merged && !a.pass) byKind.set(a.kind, { ...merged, pass: false });
    }
  }
  const firstFail = runs.find((r) => r.evalRun.status === 'fail');
  return {
    scenarioId: scenario.id,
    mode: 'live',
    status: allPassed ? 'pass' : 'fail',
    metrics: {
      trials: runs.length,
      trials_passed: passed.length,
      pass_k: allPassed ? 1 : 0,
      steps_used: mean('steps_used'),
      duration_ms: mean('duration_ms'),
      tokens_estimated: mean('tokens_estimated'),
    },
    faultType: firstFail?.evalRun.faultType ?? null,
    runTraceId: runs[0]?.evalRun.runTraceId ?? null,
    assertionResults: [...byKind.values()],
  };
}

/**
 * 汇总 aggregate 指标：passRate / avgSteps / recoveryRate。
 * 恢复类 = 错误恢复（category=recovery）+ 中断注入（behavior.abortAfterToolResults）。
 */
export function buildAggregate(
  scenarios: readonly EvalScenario[],
  results: readonly EvalRunResult[],
): EvalSnapshot['aggregate'] {
  const scenariosById = new Map(scenarios.map((s) => [s.id, s]));
  const round4 = (n: number): number => Math.round(n * 10000) / 10000;
  const passRate =
    results.length === 0
      ? 0
      : round4(results.filter((r) => r.status === 'pass').length / results.length);
  const avgSteps =
    results.length === 0
      ? 0
      : round4(
          results.reduce((sum, r) => sum + (r.metrics.steps_used ?? 0), 0) /
            results.length,
        );
  const recovery = results.filter((r) => {
    const s = scenariosById.get(r.scenarioId);
    return (
      s !== undefined &&
      (s.category === 'recovery' || s.behavior?.abortAfterToolResults !== undefined)
    );
  });
  const recoveryRate =
    recovery.length === 0
      ? 0
      : round4(recovery.filter((r) => r.status === 'pass').length / recovery.length);
  return { passRate, avgSteps, recoveryRate };
}
