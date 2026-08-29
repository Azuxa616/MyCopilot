/**
 * Todo 16 — DEMO_MODE 集成验证。
 *
 * 镜像 apps/server/src/index.ts 的路由挂载（不含 boot 副作用：serve、job
 * worker、MCP 同步、skills 目录同步、静态托管与 debug 路由——后两者由 env
 * 门控，本测试保持关闭）。在此之上做两件事：
 *
 * 1. 白名单矩阵全量枚举：遍历 Hono app 已注册全部路由路径 × 5 种方法，
 *    断言 demo token 的实际行为与 EXPECTED_DEMO_SURFACE 完全一致——
 *    白名单内 200/201/404、白名单外一律 403。期望表独立于
 *    tokenAuth.ts 的 DEMO_ROUTE_RULES 维护，二者漂移（新端点漏配或旧
 *    端点误开）都会在此暴露；死规则（匹配不到任何已注册路由）同样失败。
 * 2. 5 个新只读端点（todo 4/9）的显式断言 + 写方法拒绝 + admin 不受影响。
 *
 * 回放端点用真实子进程跑一个确定性场景（与 docker 同款 npx tsx 方式），
 * 不触网、不打真实 LLM。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { tokenAuthMiddleware } from '../middleware/tokenAuth.js';
import { errorMiddleware } from '../middleware/error.js';
import { initDatabase, getDb } from '../db/index.js';
import { healthApp } from '../routes/health.js';
import { providersApp } from '../routes/providers.js';
import { modelsApp } from '../routes/models.js';
import { sessionsApp } from '../routes/sessions.js';
import { messagesApp } from '../routes/messages.js';
import { toolsApp } from '../routes/tools.js';
import { createSkillsApp } from '../routes/skills.js';
import { mcpsApp } from '../routes/mcps.js';
import { pluginsApp } from '../routes/plugins.js';
import { jobsApp } from '../routes/jobs.js';
import { tracesApp } from '../routes/traces.js';
import { evalApp } from '../routes/eval.js';
import { authApp } from '../routes/auth.js';
import { listAllEnabledModels } from '../repo/model.js';
import { createSession } from '../repo/session.js';
import { createRun, updateRun, appendStep } from '../repo/runTrace.js';

const DEMO_TOKEN = 'demo-token-t16';
const ADMIN_TOKEN = 'admin-token-t16';
const PUBLIC_PATHS = ['/api/health'];
const METHODS: readonly string[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

/**
 * 期望的 demo 白名单语义（oracle，独立于 DEMO_ROUTE_RULES）：
 * demo 部署 spec §2 的 16 条基线 + todo 4/9 新增的 5 条只读 GET。
 */
const EXPECTED_DEMO_SURFACE: ReadonlyArray<{ method: string; pattern: RegExp }> = [
  { method: 'GET', pattern: /^\/api\/models$/ },
  { method: 'GET', pattern: /^\/api\/sessions$/ },
  { method: 'POST', pattern: /^\/api\/sessions$/ },
  { method: 'GET', pattern: /^\/api\/sessions\/[^/]+$/ },
  { method: 'PATCH', pattern: /^\/api\/sessions\/[^/]+$/ },
  { method: 'DELETE', pattern: /^\/api\/sessions\/[^/]+$/ },
  { method: 'GET', pattern: /^\/api\/sessions\/[^/]+\/messages$/ },
  { method: 'POST', pattern: /^\/api\/sessions\/[^/]+\/messages$/ },
  { method: 'GET', pattern: /^\/api\/sessions\/[^/]+\/summaries$/ },
  { method: 'POST', pattern: /^\/api\/sessions\/[^/]+\/messages\/stop$/ },
  { method: 'DELETE', pattern: /^\/api\/sessions\/[^/]+\/messages\/[^/]+$/ },
  { method: 'GET', pattern: /^\/api\/jobs$/ },
  { method: 'GET', pattern: /^\/api\/jobs\/stream$/ },
  { method: 'GET', pattern: /^\/api\/jobs\/[^/]+$/ },
  { method: 'POST', pattern: /^\/api\/jobs\/[^/]+\/cancel$/ },
  { method: 'GET', pattern: /^\/api\/auth\/me$/ },
  // todo 4：只读执行轨迹
  { method: 'GET', pattern: /^\/api\/sessions\/[^/]+\/runs$/ },
  { method: 'GET', pattern: /^\/api\/runs\/[^/]+$/ },
  // todo 9：只读评估端点
  { method: 'GET', pattern: /^\/api\/eval\/snapshot$/ },
  { method: 'GET', pattern: /^\/api\/eval\/scenarios$/ },
  { method: 'GET', pattern: /^\/api\/eval\/scenarios\/[^/]+\/replay$/ },
];

const ruleIndexOf = (method: string, path: string): number =>
  EXPECTED_DEMO_SURFACE.findIndex(
    (r) => r.method === method && r.pattern.test(path),
  );

const isPublicPath = (path: string): boolean =>
  PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`));

/** 与 index.ts:75-117 一致的挂载（顺序保持：health 先于 tokenAuth）。 */
function createMirrorApp(): Hono {
  const app = new Hono();
  app.onError(errorMiddleware());
  app.route('/api/health', healthApp);
  app.use('/api/*', tokenAuthMiddleware(PUBLIC_PATHS, DEMO_TOKEN));
  app.route('/api/providers', providersApp);
  app.route('/api/providers/:providerId/models', modelsApp);
  app.route('/api/sessions', sessionsApp);
  app.route('/api/sessions/:sessionId/messages', messagesApp);
  app.route('/api/tools', toolsApp);
  app.route('/api/skills', createSkillsApp({}));
  app.route('/api/mcps', mcpsApp);
  app.route('/api/plugins', pluginsApp);
  app.route('/api/jobs', jobsApp);
  app.route('/api/auth', authApp);
  app.route('/api', tracesApp);
  app.route('/api/eval', evalApp);
  app.get('/api/models', (c) => c.json({ data: listAllEnabledModels() }));
  return app;
}

/** 把路由模式中的 :param / * 通配替换成探针值（不与任何字面量段冲突）。 */
function concretize(pattern: string): string {
  return pattern
    .replace(/:[^/]+/g, 'probe-param')
    .replace(/\*/g, 'probe-file.md');
}

let seededSessionId = '';
let seededRunId = '';

const TEST_DB_DIR = mkdtempSync(join(tmpdir(), 'demo-integration-'));

beforeAll(() => {
  initDatabase(TEST_DB_DIR);
  getDb()
    .prepare("INSERT OR REPLACE INTO config (key, value) VALUES ('auth_token', ?)")
    .run(ADMIN_TOKEN);

  // 造一条真实 Run，让 GET /api/runs/:id 能断言 200（而非 404 兜底）
  const session = createSession({ title: '[demo-integration] probe' });
  const run = createRun({ sessionId: session.id, userMessageId: 'probe-user-msg' });
  updateRun(run.id, { status: 'completed', stopReason: 'end_turn', iterations: 2 });
  appendStep({ runId: run.id, seq: 1, type: 'llm_call', durationMs: 12 });
  appendStep({
    runId: run.id,
    seq: 2,
    type: 'tool_exec',
    toolName: 'calculator',
    argsPreview: '{"expression":"2+3"}',
    resultPreview: '5',
    durationMs: 8,
  });
  seededSessionId = session.id;
  seededRunId = run.id;
});

afterAll(() => {
  rmSync(TEST_DB_DIR, { recursive: true, force: true });
});

type ApiResponse<T = unknown> = { code: number; msg: string; data: T };

async function demoRequest(
  app: Hono,
  path: string,
  method: string = 'GET',
  signal?: AbortSignal,
): Promise<Response> {
  const hasBody = method === 'POST' || method === 'PUT' || method === 'PATCH';
  return app.request(path, {
    method,
    headers: {
      Authorization: `Bearer ${DEMO_TOKEN}`,
      ...(hasBody ? { 'content-type': 'application/json' } : {}),
    },
    ...(hasBody ? { body: '{}' } : {}),
    ...(signal ? { signal } : {}),
  });
}

describe('demo 白名单矩阵全量枚举', () => {
  it('全部已注册路由 × 5 方法：demo 行为与期望白名单逐格一致（白名单内 200/201/404，白名单外 403）', async () => {
    const app = createMirrorApp();
    const routePaths = [
      ...new Set(
        app.routes.filter((r) => METHODS.includes(r.method)).map((r) => concretize(r.path)),
      ),
    ].sort();
    // 覆盖面下限：路由被意外移除（漏挂载）在此暴露
    expect(routePaths.length).toBeGreaterThanOrEqual(46);

    const matchedRules = new Set<number>();
    for (const path of routePaths) {
      for (const method of METHODS) {
        const label = `${method} ${path}`;
        // /api/jobs/stream 是活 SSE：status 断言后立刻 abort，让 onAbort
        // 清掉轮询 interval（hono streamSSE 监听 raw.signal）
        const sseController = path === '/api/jobs/stream' ? new AbortController() : undefined;
        const res = await demoRequest(app, path, method, sseController?.signal);
        if (sseController) {
          sseController.abort();
          await new Promise((r) => setTimeout(r, 10));
        }
        if (isPublicPath(path)) {
          expect(res.status, `${label}: 公共路径不应被鉴权拦截`).not.toBe(403);
          expect(res.status, `${label}: 公共路径应为 200 或 404`).toBeLessThan(500);
        } else {
          const ruleIndex = ruleIndexOf(method, path);
          if (ruleIndex >= 0) {
            matchedRules.add(ruleIndex);
            expect(
              [200, 201, 404],
              `${label}: 白名单内 demo 应得 200/201/404（201=POST /api/sessions 创建）`,
            ).toContain(res.status);
          } else {
            expect(res.status, `${label}: 白名单外 demo 应一律 403（默认拒绝）`).toBe(403);
          }
        }
      }
    }
    // 反向覆盖：期望表里的每条规则都必须命中至少一个已注册路由组合——
    // 死规则（对应端点已不存在或从未存在）视为白名单腐化，失败。
    const deadRules = EXPECTED_DEMO_SURFACE.filter((_, i) => !matchedRules.has(i));
    expect(deadRules, '期望白名单存在匹配不到任何已注册路由的死规则').toEqual([]);
  });
});

describe('5 个新只读端点（todo 4/9）demo 集成', () => {
  const app = createMirrorApp();

  it('GET /api/sessions/:id/runs → 200，含 stepCount 聚合', async () => {
    const res = await demoRequest(app, `/api/sessions/${seededSessionId}/runs`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ApiResponse<Array<{ id: string; stepCount: number }>>;
    expect(body.code).toBe(0);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe(seededRunId);
    expect(body.data[0].stepCount).toBe(2);
  });

  it('GET /api/runs/:runId → 200，含全部 steps（真实落库数据）', async () => {
    const res = await demoRequest(app, `/api/runs/${seededRunId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ApiResponse<{ run: { id: string; status: string }; steps: Array<{ seq: number; type: string; toolName: string | null }> }>;
    expect(body.data.run.id).toBe(seededRunId);
    expect(body.data.run.status).toBe('completed');
    expect(body.data.steps).toHaveLength(2);
    expect(body.data.steps[1].toolName).toBe('calculator');
  });

  it('GET /api/eval/snapshot → 200，返回已提交快照（9 个确定性场景）', async () => {
    const res = await demoRequest(app, '/api/eval/snapshot');
    expect(res.status).toBe(200);
    const body = (await res.json()) as ApiResponse<{ generatedAt: string; scenarios: Array<{ mode: string }> }>;
    expect(typeof body.data.generatedAt).toBe('string');
    expect(body.data.scenarios).toHaveLength(9);
    expect(body.data.scenarios.every((s) => s.mode === 'deterministic')).toBe(true);
  });

  it('GET /api/eval/scenarios → 200，19 项场景元数据', async () => {
    const res = await demoRequest(app, '/api/eval/scenarios');
    expect(res.status).toBe(200);
    const body = (await res.json()) as ApiResponse<unknown[]>;
    expect(body.data).toHaveLength(19);
  });

  it('GET /api/eval/scenarios/:id/replay → 200（真实子进程确定性回放，不触网）', { timeout: 120_000 }, async () => {
    const res = await demoRequest(
      app,
      '/api/eval/scenarios/multi-step-tool-chain/replay',
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as ApiResponse<{ runTrace: { status: string } | null; steps: Array<{ type: string; toolName: string | null }>; evalRun: { status: string; scenarioId: string } }>;
    expect(body.data.runTrace?.status).toBe('completed');
    const toolSteps = body.data.steps.filter((s) => s.type === 'tool_exec');
    expect(toolSteps.map((s) => s.toolName)).toEqual(['calculator', 'json_format']);
    expect(body.data.evalRun).toMatchObject({
      scenarioId: 'multi-step-tool-chain',
      status: 'pass',
    });
  });
});

describe('demo 写方法与越权回归', () => {
  const app = createMirrorApp();

  it.each([
    ['POST', '/api/eval/snapshot'],
    ['POST', '/api/eval/scenarios'],
    ['DELETE', '/api/runs/probe-param'],
    ['PATCH', '/api/sessions/probe-param/runs'],
    ['POST', '/api/sessions/probe-param/runs'],
  ])('demo token %s %s → 403（未注册方法/写方法均默认拒绝）', async (method, path) => {
    const res = await demoRequest(app, path, method);
    expect(res.status).toBe(403);
  });

  it('demo token GET /api/providers 仍 403（基线回归），admin token 200（白名单不影响 admin）', async () => {
    const demo = await demoRequest(app, '/api/providers');
    expect(demo.status).toBe(403);
    const admin = await app.request('/api/providers', {
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    expect(admin.status).toBe(200);
  });

  it('未知路径 /api/no-such-endpoint → demo 403（默认拒绝先于 404 泄露路由面）', async () => {
    const res = await demoRequest(app, '/api/no-such-endpoint');
    expect(res.status).toBe(403);
  });

  it('无 token 访问新端点 → 401（白名单不绕过认证）', async () => {
    const res = await app.request('/api/eval/snapshot');
    expect(res.status).toBe(401);
  });
});
