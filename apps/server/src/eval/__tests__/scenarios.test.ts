/**
 * 内置评估场景集（BUILTIN_SCENARIOS）元校验。
 *
 * 校验维度（对应计划 todo 7）：
 * - id 唯一（防重复定义 / stale_state）
 * - deterministic 必有 script（每轮非空且含 finish）且 replayable === true
 * - live 必有 trials 且 replayable === false 且无 script
 * - assertions 非空且 kind 属于 EvalAssertion 判别联合
 * - behavior.approval 场景必有 requiredEnv.MYCOPILOT_E2E_TOOLS
 * - requiredEnv 键 ∈ { MYCOPILOT_E2E_TOOLS, CONTEXT_SUMMARIZE_THRESHOLD } 白名单
 *   （注：eval-env.ts 属 todo 8 尚不存在；todo 8 落地后本校验将升级为
 *   「requiredEnv 键集与 eval-env.ts 静态表一致」的强校验）
 * - 工具名 ∈ demo 白名单 ∪ e2e 工具集（http_fetch / web_search 禁入）
 *
 * 负例（malformed input 探查）：以合法场景为模板构造非法变体，
 * 断言同一组规则函数会将其拒绝——规则不是只对内置数据恒真。
 */
import { describe, expect, it } from 'vitest';
import type { EvalScenario } from '@my-copilot/shared';
import { BUILTIN_SCENARIOS } from '../scenarios/index.js';
import { DEMO_ALLOWED_TOOLS } from '../../demo/tools.js';

/** e2e 测试工具（MYCOPILOT_E2E_TOOLS=1 时注册，仅审批流场景使用）。 */
const E2E_TOOL_NAMES = new Set(['e2e_danger_tool', 'e2e_restricted_tool']);

/**
 * requiredEnv 白名单。todo 8 的 eval-env.ts 会以静态常量表写死同样的键集，
 * 届时本测试升级为直接 import 该表做一致性校验（见文件头注释）。
 */
const REQUIRED_ENV_WHITELIST = new Set([
  'MYCOPILOT_E2E_TOOLS',
  'CONTEXT_SUMMARIZE_THRESHOLD',
]);

/** EvalAssertion 判别联合的全部合法 kind。 */
const ASSERTION_KINDS = new Set([
  'status',
  'tool_sequence',
  'final_contains',
  'degraded',
  'summary_created',
  'approval_flow',
  'max_steps_hit',
]);

// ---------------------------------------------------------------------------
// 规则函数（正例与负例共用同一实现）
// ---------------------------------------------------------------------------

function duplicateIds(list: readonly EvalScenario[]): string[] {
  const seen = new Set<string>();
  const dupes: string[] = [];
  for (const s of list) {
    if (seen.has(s.id)) dupes.push(s.id);
    seen.add(s.id);
  }
  return dupes;
}

function deterministicProblems(s: EvalScenario): string[] {
  if (s.mode !== 'deterministic') return [];
  const problems: string[] = [];
  if (!s.script || s.script.length === 0) {
    problems.push('deterministic 场景缺少 script');
  } else {
    s.script.forEach((round, i) => {
      if (!Array.isArray(round) || round.length === 0) {
        problems.push(`script 第 ${i + 1} 轮不是非空事件数组`);
        return;
      }
      if (!round.some((e) => e.type === 'finish')) {
        problems.push(`script 第 ${i + 1} 轮缺少 finish 事件`);
      }
    });
  }
  if (s.replayable !== true) {
    problems.push('deterministic 场景必须 replayable === true');
  }
  return problems;
}

function liveProblems(s: EvalScenario): string[] {
  if (s.mode !== 'live') return [];
  const problems: string[] = [];
  if (typeof s.trials !== 'number' || s.trials < 1) {
    problems.push('live 场景必须声明 trials ≥ 1');
  }
  if (s.replayable !== false) {
    problems.push('live 场景必须 replayable === false');
  }
  if (s.script !== undefined) {
    problems.push('live 场景不应携带 script');
  }
  return problems;
}

function assertionProblems(s: EvalScenario): string[] {
  if (!Array.isArray(s.assertions) || s.assertions.length === 0) {
    return ['assertions 不能为空'];
  }
  return s.assertions
    .filter((a) => !ASSERTION_KINDS.has(a.kind))
    .map((a) => `未知断言 kind：${String(a.kind)}`);
}

function approvalEnvProblems(s: EvalScenario): string[] {
  if (s.behavior?.approval === undefined) return [];
  if (s.requiredEnv?.MYCOPILOT_E2E_TOOLS !== '1') {
    return ['behavior.approval 场景必须 requiredEnv.MYCOPILOT_E2E_TOOLS === "1"'];
  }
  return [];
}

function requiredEnvProblems(s: EvalScenario): string[] {
  if (!s.requiredEnv) return [];
  return Object.keys(s.requiredEnv)
    .filter((key) => !REQUIRED_ENV_WHITELIST.has(key))
    .map((key) => `requiredEnv 键 "${key}" 不在白名单 ${[...REQUIRED_ENV_WHITELIST].join(' / ')}`);
}

function toolNameProblems(s: EvalScenario): string[] {
  const allowed = new Set([...DEMO_ALLOWED_TOOLS, ...E2E_TOOL_NAMES]);
  return s.tools.filter((name) => !allowed.has(name)).map((name) => `工具 "${name}" 不在 demo 白名单 ∪ e2e 工具集`);
}

// ---------------------------------------------------------------------------
// 正例：内置场景集
// ---------------------------------------------------------------------------

const deterministic = BUILTIN_SCENARIOS.filter((s) => s.mode === 'deterministic');
const live = BUILTIN_SCENARIOS.filter((s) => s.mode === 'live');

describe('BUILTIN_SCENARIOS 元校验', () => {
  it('场景总数 ≥19（确定性 ≥9 + live ≥10）', () => {
    expect(BUILTIN_SCENARIOS.length).toBeGreaterThanOrEqual(19);
    expect(deterministic.length).toBeGreaterThanOrEqual(9);
    expect(live.length).toBeGreaterThanOrEqual(10);
  });

  it('id 全局唯一', () => {
    expect(duplicateIds(BUILTIN_SCENARIOS)).toEqual([]);
  });

  it('deterministic 场景必有非空 script（每轮含 finish）且 replayable === true', () => {
    for (const s of deterministic) {
      expect(deterministicProblems(s)).toEqual([]);
    }
  });

  it('live 场景必有 trials ≥1、replayable === false、无 script', () => {
    for (const s of live) {
      expect(liveProblems(s)).toEqual([]);
    }
  });

  it('所有场景 assertions 非空且 kind 合法', () => {
    for (const s of BUILTIN_SCENARIOS) {
      expect(assertionProblems(s)).toEqual([]);
    }
  });

  it('behavior.approval 场景必有 requiredEnv.MYCOPILOT_E2E_TOOLS', () => {
    for (const s of BUILTIN_SCENARIOS) {
      expect(approvalEnvProblems(s)).toEqual([]);
    }
    // 内置集中确实存在审批场景，规则不是空转
    expect(BUILTIN_SCENARIOS.some((s) => s.behavior?.approval !== undefined)).toBe(true);
  });

  it('requiredEnv 键 ∈ 白名单（todo 8 落地 eval-env.ts 后升级为静态表一致性校验）', () => {
    for (const s of BUILTIN_SCENARIOS) {
      expect(requiredEnvProblems(s)).toEqual([]);
    }
  });

  it('工具名 ∈ demo 白名单 ∪ e2e 工具集（http_fetch / web_search 禁入）', () => {
    for (const s of BUILTIN_SCENARIOS) {
      expect(toolNameProblems(s)).toEqual([]);
    }
  });

  it('确定性场景禁用网络工具（grep 语义在测试内固化）', () => {
    const networkTools = ['http_fetch', 'web_search'];
    for (const s of BUILTIN_SCENARIOS) {
      expect(s.tools.filter((t) => networkTools.includes(t))).toEqual([]);
    }
  });

  it('打印场景清单（Manual-QA 数据形状）', () => {
    const lines = BUILTIN_SCENARIOS.map(
      (s) =>
        `${s.id} | ${s.mode} | replayable=${String(s.replayable)} | assertions=${s.assertions.length}`,
    );
    for (const line of lines) {
      console.log(`[scenario] ${line}`);
    }
    expect(lines.length).toBe(BUILTIN_SCENARIOS.length);
  });
});

// ---------------------------------------------------------------------------
// 负例：malformed input 探查（同一规则函数必须拒绝非法变体）
// ---------------------------------------------------------------------------

/** 以确定性合法场景为模板的可变克隆工厂。 */
function validDeterministicClone(): EvalScenario {
  return structuredClone(deterministic[0]!);
}

describe('元校验负例（malformed input）', () => {
  it('重复 id 被拒（stale_state：id 唯一性防重复定义）', () => {
    const list = [validDeterministicClone(), validDeterministicClone()];
    expect(duplicateIds(list)).toEqual([list[1]!.id]);
  });

  it('deterministic 缺 script 被拒', () => {
    const bad = validDeterministicClone();
    bad.script = undefined;
    expect(deterministicProblems(bad)).toContain('deterministic 场景缺少 script');
  });

  it('deterministic 的 script 存在无 finish 的轮次被拒', () => {
    const bad = validDeterministicClone();
    bad.script = [[{ type: 'content', text: '没有 finish' }]];
    expect(deterministicProblems(bad)).toContain('script 第 1 轮缺少 finish 事件');
  });

  it('deterministic replayable !== true 被拒', () => {
    const bad = validDeterministicClone();
    bad.replayable = false;
    expect(deterministicProblems(bad)).toContain('deterministic 场景必须 replayable === true');
  });

  it('live 缺 trials 被拒', () => {
    const bad: EvalScenario = {
      id: 'bad-live',
      name: '非法 live',
      description: '负例',
      category: 'task',
      mode: 'live',
      tools: ['calculator'],
      userMessage: 'x',
      replayable: false,
      assertions: [{ kind: 'status', expected: 'completed' }],
    };
    expect(liveProblems(bad)).toContain('live 场景必须声明 trials ≥ 1');
  });

  it('live replayable !== false 被拒', () => {
    const bad: EvalScenario = {
      id: 'bad-live-2',
      name: '非法 live',
      description: '负例',
      category: 'task',
      mode: 'live',
      tools: ['calculator'],
      userMessage: 'x',
      trials: 3,
      replayable: true,
      assertions: [{ kind: 'status', expected: 'completed' }],
    };
    expect(liveProblems(bad)).toContain('live 场景必须 replayable === false');
  });

  it('空 assertions 被拒', () => {
    const bad = validDeterministicClone();
    bad.assertions = [];
    expect(assertionProblems(bad)).toEqual(['assertions 不能为空']);
  });

  it('behavior.approval 缺 MYCOPILOT_E2E_TOOLS 被拒', () => {
    const bad = validDeterministicClone();
    bad.behavior = { approval: 'approve' };
    expect(approvalEnvProblems(bad)).toEqual([
      'behavior.approval 场景必须 requiredEnv.MYCOPILOT_E2E_TOOLS === "1"',
    ]);
  });

  it('requiredEnv 白名单外键被拒', () => {
    const bad = validDeterministicClone();
    bad.requiredEnv = { OUTHOUSE_API_KEY: '1' };
    expect(requiredEnvProblems(bad)).toHaveLength(1);
  });

  it('网络工具（http_fetch / web_search）被拒', () => {
    for (const name of ['http_fetch', 'web_search']) {
      const bad = validDeterministicClone();
      bad.tools = [name];
      expect(toolNameProblems(bad)).toEqual([
        `工具 "${name}" 不在 demo 白名单 ∪ e2e 工具集`,
      ]);
    }
  });
});
