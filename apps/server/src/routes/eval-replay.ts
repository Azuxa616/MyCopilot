/**
 * Eval 场景回放子进程执行器（todo 9，Oracle S1-1 子进程方案）。
 *
 * 回放绝不侵入 server 主进程：以 `npx tsx src/eval/cli.ts --scenario <id>
 * --replay-json <tmpfile>` 子进程执行（与 docker CMD `npx tsx src/index.ts`
 * 同款运行方式），临时 DB initDatabase 与 requiredEnv 注入全部发生在子进程
 * 内（cli.ts 首行 import './eval-env.js'），主进程 DB 单例零触碰。
 *
 * 防滥用护栏：进程内信号量（同时最多 2 个回放子进程，超出 → busy → 路由
 * 映射 429）+ 子进程超时 kill（默认 60s，测试可注入短超时）+ tmpfile 所在
 * 临时目录 finally 清理（含超时与异常路径）。
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EvalRunResult, RunStepRecord, RunTraceRecord } from '@my-copilot/shared';

/** apps/server 包根（spawn 的 cwd；src/eval/cli.ts 相对该目录解析）。 */
const SERVER_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 子进程超时上限（防挂死护栏），测试可经 opts.timeoutMs 注入短超时。 */
const REPLAY_TIMEOUT_MS = 60_000;

/** 同时最多 2 个回放子进程（防滥用护栏），超出由路由映射 429。 */
const MAX_CONCURRENT_REPLAYS = 2;
let activeReplays = 0;

/** 回放结果判别联合：ok 携带 cli --replay-json 写出的载荷。 */
export type ReplayOutcome =
  | {
      reason: 'ok';
      runTrace: RunTraceRecord | null;
      steps: RunStepRecord[];
      evalRun: EvalRunResult;
    }
  | { reason: 'busy' }
  | { reason: 'timeout' }
  | { reason: 'failed'; detail: string };

export interface ReplayOptions {
  /** 子进程超时；缺省 60s。测试注入短超时验证 kill 兜底。 */
  timeoutMs?: number;
}

export async function runReplay(
  scenarioId: string,
  opts: ReplayOptions = {},
): Promise<ReplayOutcome> {
  if (activeReplays >= MAX_CONCURRENT_REPLAYS) {
    return { reason: 'busy' };
  }
  activeReplays += 1;
  const workDir = mkdtempSync(join(tmpdir(), 'eval-replay-'));
  const tmpFile = join(workDir, 'replay.json');
  try {
    const child = spawn(
      'npx',
      ['tsx', 'src/eval/cli.ts', '--scenario', scenarioId, '--replay-json', tmpFile],
      { cwd: SERVER_ROOT, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stderrTail = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrTail = `${stderrTail}${chunk.toString('utf-8')}`.slice(-500);
    });
    const timedOut = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        resolve(true);
      }, opts.timeoutMs ?? REPLAY_TIMEOUT_MS);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve(false);
      });
      child.once('error', () => {
        // spawn 本身失败（如 npx 缺失）：交给读文件阶段归为 failed。
        clearTimeout(timer);
        resolve(false);
      });
    });
    if (timedOut) {
      return { reason: 'timeout' };
    }
    try {
      // CLI 即使评估 fail（退出码 1）也会先写回放 JSON；成功判据是文件
      // 可读可解析，而非退出码。
      const payload = JSON.parse(readFileSync(tmpFile, 'utf-8')) as {
        runTrace: RunTraceRecord | null;
        steps: RunStepRecord[];
        evalRun: EvalRunResult;
      };
      return { reason: 'ok', ...payload };
    } catch (err) {
      return {
        reason: 'failed',
        detail:
          `回放输出缺失或不可解析：${err instanceof Error ? err.message : String(err)}` +
          (stderrTail ? `；子进程 stderr 尾部：${stderrTail}` : ''),
      };
    }
  } finally {
    activeReplays -= 1;
    rmSync(workDir, { recursive: true, force: true });
  }
}
