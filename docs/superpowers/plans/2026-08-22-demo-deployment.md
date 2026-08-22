# MyCopilot 演示版安全部署 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 DEMO_MODE 双 token 降权、API key 脱敏、demo 工具过滤、演示数据播种，以及同机双实例部署配置（演示公开 / 自用仅本机）。

**Architecture:** 服务端新增 `DEMO_MODE` 环境变量驱动的角色分级（admin 全权限 / demo 白名单），`tokenAuthMiddleware` 升级为双 token；providers 路由层做 apiKey 掩码往返；`demo/` 新模块承载工具白名单过滤与启动播种；前端经 `/api/auth/me` 识别角色并隐藏设置入口；Docker 双 compose 项目实现网络与数据隔离。

**Tech Stack:** Hono 4 + better-sqlite3（现有）、Zustand（现有）、Docker Compose、nginx（宿主机配置，文档化交付）。

**Spec:** `docs/superpowers/specs/2026-08-22-demo-deployment-design.md`

---

## ⚠️ 执行前必读

1. **工作区有用户在途改动**（`agent-loop/runner.ts`、`prompt/assembler.ts`、`tools/executor.ts`、`web/store/sessionStore.ts`、`views/settings/SkillsPage.tsx`、两个 docs 文件）。本计划**不触碰这些文件**。每次提交必须 `git add <明确列出的文件>`，**禁止** `git add -A` / `git add .`。
2. 提交信息风格：英文语义化 `type(scope): message`（与 git log 一致）。
3. 所有测试命令在仓库根目录执行。单文件测试：`pnpm --filter server test -- <路径>`（vitest 位置过滤）。
4. 当前分支 `prase-2-dev`，无 upstream——只提交，不推送。

## 文件结构总览

| 动作 | 文件 | 职责 |
|---|---|---|
| Create | `packages/shared/src/auth.ts` | `AuthRole` / `AuthInfo` 类型 |
| Modify | `packages/shared/src/index.ts` | barrel 导出 auth 模块 |
| Modify | `apps/server/src/config.ts` | `demoMode` / `demoToken` 解析 + fail-fast |
| Modify | `apps/server/src/middleware/tokenAuth.ts` | 双 token 角色分级 + demo 路由白名单 |
| Create | `apps/server/src/utils/mask.ts` | `maskApiKey` / `isMaskedApiKey` |
| Modify | `apps/server/src/routes/providers.ts` | 响应脱敏 + PATCH 掩码往返 |
| Create | `apps/server/src/routes/auth.ts` | `GET /api/auth/me` |
| Create | `apps/server/src/demo/tools.ts` | demo 工具白名单过滤 |
| Create | `apps/server/src/demo/seed.ts` | 演示 Provider/Model 播种 |
| Modify | `apps/server/src/index.ts` | 挂载 auth 路由、传 demoToken、启动播种 |
| Modify | `apps/server/src/streaming/lifecycle.ts` | 工具列表套 `filterDemoTools` |
| Modify | `apps/server/src/jobs/worker.ts` | 同上（异步 job 路径） |
| Modify | `apps/web/src/api/real.ts` | `fetchAuthMe` |
| Modify | `apps/web/src/store/configStore.ts` | `role` 状态 + 校验切换到 `/api/auth/me` |
| Modify | `apps/web/src/components/Asider/index.tsx` | demo 角色隐藏设置导航 |
| Create | `docker/docker-compose.demo.yml` | 演示实例（127.0.0.1:3100） |
| Create | `docker/.env.demo.example` | 演示实例环境变量模板 |
| Create | `docker/reset-demo.sh` | 每日重置脚本 |
| Modify | `docker/docker-compose.yml` | 自用实例端口改绑 127.0.0.1 |
| Create | `docs/deploy-demo.md` | nginx + cron + 上线手册（中文） |
| Test | 各 `__tests__/` 新文件（见各任务） | 单元/集成测试 |

---

### Task 1: shared 类型 — `AuthRole` / `AuthInfo`

**Files:**
- Create: `packages/shared/src/auth.ts`
- Modify: `packages/shared/src/index.ts`
- Test: 无（纯类型模块，无运行时代码，与 `mcp.ts` 等纯类型模块一致的豁免）

- [ ] **Step 1: 创建类型文件**

```typescript
// packages/shared/src/auth.ts

/** 调用方角色：admin = 全权限（AUTH_TOKEN），demo = 演示白名单（DEMO_TOKEN）。 */
export type AuthRole = 'admin' | 'demo';

/** GET /api/auth/me 响应体（data 字段）。 */
export interface AuthInfo {
  role: AuthRole;
  demoMode: boolean;
}
```

- [ ] **Step 2: barrel 导出**

在 `packages/shared/src/index.ts` 追加一行（放在现有导出列表末尾）：

```typescript
export * from './auth.js';
```

- [ ] **Step 3: 验证 shared 构建**

Run: `pnpm --filter @my-copilot/shared build`
Expected: 编译通过，无错误。

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/auth.ts packages/shared/src/index.ts
git commit -m "feat(shared): add AuthRole and AuthInfo types for dual-token auth"
```

---

### Task 2: 服务端配置 — `demoMode` / `demoToken` + fail-fast

**Files:**
- Modify: `apps/server/src/config.ts`
- Create: `apps/server/src/__tests__/config.demo.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// apps/server/src/__tests__/config.demo.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { loadConfig } from '../config.js';

describe('loadConfig DEMO_MODE', () => {
  afterEach(() => {
    delete process.env.DEMO_MODE;
    delete process.env.DEMO_TOKEN;
    delete process.env.AUTH_TOKEN;
  });

  it('throws when DEMO_MODE=1 without DEMO_TOKEN', () => {
    process.env.DEMO_MODE = '1';
    delete process.env.DEMO_TOKEN;
    expect(() => loadConfig()).toThrow(/DEMO_TOKEN/);
  });

  it('parses demo flags and trims token', () => {
    process.env.DEMO_MODE = '1';
    process.env.DEMO_TOKEN = '  demo-token  ';
    const config = loadConfig();
    expect(config.demoMode).toBe(true);
    expect(config.demoToken).toBe('demo-token');
  });

  it('defaults to demo off', () => {
    delete process.env.DEMO_MODE;
    const config = loadConfig();
    expect(config.demoMode).toBe(false);
    expect(config.demoToken).toBeNull();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter server test -- src/__tests__/config.demo.test.ts`
Expected: FAIL —— `demoMode` 属性不存在（类型错误或 undefined）。

- [ ] **Step 3: 实现**

`apps/server/src/config.ts` 的 `ServerConfig` 接口追加两个字段（放在 `maxAttachmentSizeMb: number;` 之后）：

```typescript
  demoMode: boolean;
  demoToken: string | null;
```

`loadConfig` 内，`maxAttachmentSizeMb` 解析之后、`return` 之前追加：

```typescript
  // DEMO_MODE — dual-token demo role
  // (spec: docs/superpowers/specs/2026-08-22-demo-deployment-design.md §2)
  const demoMode = process.env.DEMO_MODE === '1';
  const demoToken = process.env.DEMO_TOKEN?.trim() || null;
  if (demoMode && !demoToken) {
    throw new Error('DEMO_MODE=1 requires DEMO_TOKEN to be set');
  }
```

`return` 对象追加：

```typescript
    demoMode,
    demoToken,
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter server test -- src/__tests__/config.demo.test.ts`
Expected: PASS（3 个用例）。

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/config.ts apps/server/src/__tests__/config.demo.test.ts
git commit -m "feat(server): parse DEMO_MODE/DEMO_TOKEN config with fail-fast validation"
```

---

### Task 3: 掩码工具函数 — `maskApiKey` / `isMaskedApiKey`

**Files:**
- Create: `apps/server/src/utils/mask.ts`
- Create: `apps/server/src/utils/__tests__/mask.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// apps/server/src/utils/__tests__/mask.test.ts
import { describe, it, expect } from 'vitest';
import { maskApiKey, isMaskedApiKey } from '../mask.js';

describe('maskApiKey', () => {
  it('masks long keys keeping first/last 4 chars', () => {
    expect(maskApiKey('sk-1234567890abcdef')).toBe('sk-1****cdef');
  });

  it('fully masks keys of 8 chars or fewer', () => {
    expect(maskApiKey('12345678')).toBe('****');
    expect(maskApiKey('short')).toBe('****');
    expect(maskApiKey('')).toBe('****');
  });
});

describe('isMaskedApiKey', () => {
  it('treats empty and ****-containing values as masked', () => {
    expect(isMaskedApiKey('')).toBe(true);
    expect(isMaskedApiKey('sk-1****cdef')).toBe(true);
  });

  it('treats real keys as not masked', () => {
    expect(isMaskedApiKey('sk-real-key-value')).toBe(false);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter server test -- src/utils/__tests__/mask.test.ts`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 实现**

```typescript
// apps/server/src/utils/mask.ts

/**
 * Mask an API key for API responses: first 4 + `****` + last 4.
 * Keys of 8 chars or fewer are fully masked so nothing leaks.
 */
export function maskApiKey(key: string): string {
  if (key.length <= 8) return '****';
  return `${key.slice(0, 4)}****${key.slice(-4)}`;
}

/**
 * True when a submitted apiKey value is a masked round-trip (or empty)
 * and must therefore NOT overwrite the stored key on PATCH.
 * Real API keys never contain `****`.
 */
export function isMaskedApiKey(key: string): boolean {
  return key === '' || key.includes('****');
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter server test -- src/utils/__tests__/mask.test.ts`
Expected: PASS（4 个用例）。

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/utils/mask.ts apps/server/src/utils/__tests__/mask.test.ts
git commit -m "feat(server): add apiKey masking helpers for provider responses"
```

---

### Task 4: `tokenAuthMiddleware` 双 token 角色分级

**Files:**
- Modify: `apps/server/src/middleware/tokenAuth.ts`
- Modify: `apps/server/src/middleware/__tests__/tokenAuth.test.ts`（追加 describe，不改已有用例）

- [ ] **Step 1: 追加失败测试**

在 `apps/server/src/middleware/__tests__/tokenAuth.test.ts` 文件末尾（现有 `describe('tokenAuthMiddleware', ...)` 之后）追加：

```typescript
describe('tokenAuthMiddleware demo token', () => {
  function createDemoApp() {
    const app = new Hono();
    app.use('/api/*', tokenAuthMiddleware(['/api/health'], 'demo-token-456'));
    app.onError(errorMiddleware());

    app.get('/api/sessions', (c) => c.json({ data: [] }));
    app.post('/api/sessions', (c) => c.json({ data: {} }), 201);
    app.get('/api/models', (c) => c.json({ data: [] }));
    app.get('/api/providers', (c) => c.json({ data: [] }));
    app.get('/api/jobs/abc', (c) => c.json({ data: {} }));
    app.post('/api/jobs/abc/cancel', (c) => c.json({ data: {} }));
    app.get('/api/auth/me', (c) => c.json({ data: { role: 'demo' } }));
    return app;
  }

  const demoApp = createDemoApp();

  it('demo token can GET /api/models (whitelisted)', async () => {
    const res = await demoApp.request('/api/models', {
      headers: { Authorization: 'Bearer demo-token-456' },
    });
    expect(res.status).toBe(200);
  });

  it('demo token can POST /api/sessions (whitelisted)', async () => {
    const res = await demoApp.request('/api/sessions', {
      method: 'POST',
      headers: { Authorization: 'Bearer demo-token-456' },
    });
    expect(res.status).toBe(201);
  });

  it('demo token can GET /api/jobs/:id and POST cancel (whitelisted)', async () => {
    const res1 = await demoApp.request('/api/jobs/abc', {
      headers: { Authorization: 'Bearer demo-token-456' },
    });
    expect(res1.status).toBe(200);
    const res2 = await demoApp.request('/api/jobs/abc/cancel', {
      method: 'POST',
      headers: { Authorization: 'Bearer demo-token-456' },
    });
    expect(res2.status).toBe(200);
  });

  it('demo token gets 403 on /api/providers (not whitelisted)', async () => {
    const res = await demoApp.request('/api/providers', {
      headers: { Authorization: 'Bearer demo-token-456' },
    });
    expect(res.status).toBe(403);
  });

  it('admin token (config table) bypasses whitelist on /api/providers', async () => {
    const res = await demoApp.request('/api/providers', {
      headers: { Authorization: 'Bearer test-token-123' },
    });
    expect(res.status).toBe(200);
  });

  it('unknown token gets 401 even on whitelisted route', async () => {
    const res = await demoApp.request('/api/models', {
      headers: { Authorization: 'Bearer no-such-token' },
    });
    expect(res.status).toBe(401);
  });

  it('without demoToken configured, demo-like token gets 401', async () => {
    const app = new Hono();
    app.use('/api/*', tokenAuthMiddleware(['/api/health']));
    app.onError(errorMiddleware());
    app.get('/api/sessions', (c) => c.json({ data: [] }));
    const res = await app.request('/api/sessions', {
      headers: { Authorization: 'Bearer demo-token-456' },
    });
    expect(res.status).toBe(401);
  });
});
```

注意：`test-token-123` 依赖文件顶部 `beforeAll` 已写入 config 表的既有 token。

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter server test -- src/middleware/__tests__/tokenAuth.test.ts`
Expected: 新用例 FAIL（当前签名无第二参数，demo token 401）。

- [ ] **Step 3: 实现中间件升级**

`apps/server/src/middleware/tokenAuth.ts` 整体替换为：

```typescript
import type { MiddlewareHandler } from 'hono';
import { getDb } from '../db/index.js';
import { HttpError } from './error.js';

/**
 * Demo-role route whitelist: method + path regex pairs.
 * Anything NOT matching → 403 for demo tokens (default deny).
 * Spec: docs/superpowers/specs/2026-08-22-demo-deployment-design.md §2
 */
const DEMO_ROUTE_RULES: ReadonlyArray<{ method: string; pattern: RegExp }> = [
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
];

function isDemoRouteAllowed(method: string, path: string): boolean {
  return DEMO_ROUTE_RULES.some(
    (rule) => rule.method === method && rule.pattern.test(path),
  );
}

/**
 * Token auth with optional demo role.
 *
 * - Admin token (config table `auth_token`): full access.
 * - Demo token (optional second arg, from DEMO_TOKEN env): whitelist only.
 * - Default deny: routes not in DEMO_ROUTE_RULES are admin-only.
 */
export function tokenAuthMiddleware(
  publicPaths: string[],
  demoToken?: string,
): MiddlewareHandler {
  return async (c, next) => {
    // Skip public paths
    if (publicPaths.some(p => c.req.path === p || c.req.path.startsWith(p + '/'))) {
      await next();
      return;
    }

    const authHeader = c.req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new HttpError(401, 'Unauthorized');
    }

    const token = authHeader.slice(7);

    // Admin token — full access
    const db = getDb();
    const row = db.prepare("SELECT value FROM config WHERE key = 'auth_token'").get() as { value: string } | undefined;
    if (row && row.value === token) {
      await next();
      return;
    }

    // Demo token — whitelist only
    if (demoToken && demoToken === token) {
      if (!isDemoRouteAllowed(c.req.method, c.req.path)) {
        throw new HttpError(403, 'Forbidden');
      }
      await next();
      return;
    }

    throw new HttpError(401, 'Unauthorized');
  };
}
```

先确认 `HttpError` 支持 403：检查 `apps/server/src/middleware/error.ts` 中 `HttpError` 构造签名（若第一个参数限定特定状态码字面量联合类型，按其类型补充 403）。若 error 中间件对 403 有默认处理分支则无需改动；否则在 error.ts 的状态处理中加入 403（保持既有代码风格，不重构）。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter server test -- src/middleware/__tests__/tokenAuth.test.ts`
Expected: PASS（既有 7 例 + 新 7 例全过）。

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/middleware/tokenAuth.ts apps/server/src/middleware/__tests__/tokenAuth.test.ts
git commit -m "feat(server): dual-token role auth with demo route whitelist (default deny)"
```

---

### Task 5: `GET /api/auth/me` 路由 + index.ts 接线

**Files:**
- Create: `apps/server/src/routes/auth.ts`
- Create: `apps/server/src/routes/__tests__/auth.test.ts`
- Modify: `apps/server/src/index.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// apps/server/src/routes/__tests__/auth.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { Hono } from 'hono';
import { authApp } from '../auth.js';
import { errorMiddleware } from '../../middleware/error.js';

function createApp() {
  const app = new Hono();
  app.onError(errorMiddleware());
  app.route('/api/auth', authApp);
  return app;
}

describe('GET /api/auth/me', () => {
  const app = createApp();

  afterEach(() => {
    delete process.env.DEMO_MODE;
    delete process.env.DEMO_TOKEN;
  });

  it('returns demo role for demo token in demo mode', async () => {
    process.env.DEMO_MODE = '1';
    process.env.DEMO_TOKEN = 'demo-tok';
    const res = await app.request('/api/auth/me', {
      headers: { Authorization: 'Bearer demo-tok' },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { role: 'demo', demoMode: true } });
  });

  it('returns admin role for non-demo token', async () => {
    process.env.DEMO_MODE = '1';
    process.env.DEMO_TOKEN = 'demo-tok';
    const res = await app.request('/api/auth/me', {
      headers: { Authorization: 'Bearer admin-tok' },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { role: 'admin', demoMode: true } });
  });

  it('reports demoMode false when DEMO_MODE unset', async () => {
    delete process.env.DEMO_MODE;
    const res = await app.request('/api/auth/me', {
      headers: { Authorization: 'Bearer admin-tok' },
    });
    expect(await res.json()).toEqual({ data: { role: 'admin', demoMode: false } });
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter server test -- src/routes/__tests__/auth.test.ts`
Expected: FAIL —— `../auth.js` 模块不存在。

- [ ] **Step 3: 实现路由**

```typescript
// apps/server/src/routes/auth.ts
import { Hono } from 'hono';
import { successResponse } from '../utils/response.js';

export const authApp = new Hono();

// GET /me — identify the caller's role for the frontend.
// Mounted after tokenAuthMiddleware in index.ts, so the bearer token is
// already validated; here we only classify admin vs demo.
authApp.get('/me', (c) => {
  const authHeader = c.req.header('Authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const demoToken = process.env.DEMO_TOKEN?.trim() || null;
  const role = demoToken && token === demoToken ? 'demo' : 'admin';
  const demoMode = process.env.DEMO_MODE === '1';
  return successResponse(c, { role, demoMode });
});
```

- [ ] **Step 4: index.ts 接线**

`apps/server/src/index.ts` 三处修改：

1. import 区追加（与其他 routes import 并列）：

```typescript
import { authApp } from './routes/auth.js';
```

2. 中间件挂载改为传入 demoToken（原第 57 行）：

```typescript
app.use('/api/*', tokenAuthMiddleware(['/api/health'], config.demoToken ?? undefined));
```

3. 路由挂载区追加（`app.route('/api/jobs', jobsApp);` 之后）：

```typescript
app.route('/api/auth', authApp);
```

- [ ] **Step 5: 运行确认通过 + 类型检查**

Run: `pnpm --filter server test -- src/routes/__tests__/auth.test.ts && pnpm typecheck`
Expected: 测试 PASS（3 例）；typecheck 无错误。

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/routes/auth.ts apps/server/src/routes/__tests__/auth.test.ts apps/server/src/index.ts
git commit -m "feat(server): add /api/auth/me role endpoint and wire demoToken into auth middleware"
```

---

### Task 6: providers 路由脱敏 + PATCH 掩码往返

**Files:**
- Modify: `apps/server/src/routes/providers.ts`
- Create: `apps/server/src/routes/__tests__/providers.masking.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// apps/server/src/routes/__tests__/providers.masking.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Hono } from 'hono';
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { providersApp } from '../providers.js';
import { errorMiddleware } from '../../middleware/error.js';
import { initDatabase } from '../../db/index.js';
import { createProvider, getProvider } from '../../repo/provider.js';

const TEST_DATA_DIR = resolve('.test-data-providers-masking');

function createApp() {
  const app = new Hono();
  app.onError(errorMiddleware());
  app.route('/api/providers', providersApp);
  return app;
}

const app = createApp();
let providerId = '';

beforeAll(() => {
  mkdirSync(TEST_DATA_DIR, { recursive: true });
  initDatabase(TEST_DATA_DIR);
  const created = createProvider({
    name: 'P1',
    type: 'openai',
    baseUrl: 'https://api.example.com',
    apiKey: 'sk-1234567890abcdef',
    enabled: true,
  });
  providerId = created.id;
});

afterAll(() => {
  try { rmSync(TEST_DATA_DIR, { recursive: true, force: true }); } catch { /* best-effort */ }
});

describe('providers apiKey masking', () => {
  it('GET / masks apiKey in list', async () => {
    const res = await app.request('/api/providers');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ apiKey: string }> };
    expect(body.data[0].apiKey).toBe('sk-1****cdef');
  });

  it('GET /:id masks apiKey in detail', async () => {
    const res = await app.request(`/api/providers/${providerId}`);
    const body = (await res.json()) as { data: { apiKey: string } };
    expect(body.data.apiKey).toBe('sk-1****cdef');
  });

  it('PATCH with masked apiKey keeps stored key', async () => {
    const res = await app.request(`/api/providers/${providerId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Renamed', apiKey: 'sk-1****cdef' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { name: string; apiKey: string } };
    expect(body.data.name).toBe('Renamed');
    expect(body.data.apiKey).toBe('sk-1****cdef');
    // stored key untouched
    expect(getProvider(providerId)?.apiKey).toBe('sk-1234567890abcdef');
  });

  it('PATCH with empty apiKey keeps stored key', async () => {
    const res = await app.request(`/api/providers/${providerId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: '' }),
    });
    expect(res.status).toBe(200);
    expect(getProvider(providerId)?.apiKey).toBe('sk-1234567890abcdef');
  });

  it('PATCH with a new real apiKey updates it', async () => {
    const res = await app.request(`/api/providers/${providerId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: 'sk-newkey-987654321' }),
    });
    expect(res.status).toBe(200);
    expect(getProvider(providerId)?.apiKey).toBe('sk-newkey-987654321');
  });

  it('POST response masks apiKey', async () => {
    const res = await app.request('/api/providers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'P2',
        type: 'openai',
        baseUrl: 'https://api2.example.com',
        apiKey: 'sk-abcdef1234567890',
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { apiKey: string } };
    expect(body.data.apiKey).toBe('sk-a****7890');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter server test -- src/routes/__tests__/providers.masking.test.ts`
Expected: FAIL —— 响应中 apiKey 为明文。

- [ ] **Step 3: 实现**

`apps/server/src/routes/providers.ts` 修改：

1. import 追加：

```typescript
import { maskApiKey, isMaskedApiKey } from '../utils/mask.js';
```

2. import 追加（与既有 `import type { CreateProviderParams } from '@my-copilot/shared';` 合并为一个 type import）：

```typescript
import type { Provider } from '@my-copilot/shared';
```

`providersApp` 定义之后追加辅助函数：

```typescript
function maskProvider(provider: Provider): Provider {
  return { ...provider, apiKey: maskApiKey(provider.apiKey) };
}
```

3. 各 handler 改为：

```typescript
providersApp.get('/', (c) => {
  const data = listProviders();
  return successResponse(c, data.map(maskProvider));
});
```

```typescript
  const data = createProvider(body);
  return successResponse(c, maskProvider(data), 201);
```

```typescript
providersApp.get('/:id', (c) => {
  const id = c.req.param('id');
  const data = getProvider(id);
  if (!data) {
    throw new HttpError(404, 'Provider not found');
  }
  return successResponse(c, maskProvider(data));
});
```

```typescript
providersApp.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  // Masked/empty apiKey round-trip → keep the stored key
  if (typeof body.apiKey === 'string' && isMaskedApiKey(body.apiKey)) {
    delete body.apiKey;
  }
  const data = updateProvider(id, body);
  if (!data) {
    throw new HttpError(404, 'Provider not found');
  }
  return successResponse(c, maskProvider(data));
});
```

`POST /:id/test` 不改（响应不含 key，且读取的是 repo 层原始 key）。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter server test -- src/routes/__tests__/providers.masking.test.ts`
Expected: PASS（6 例）。

- [ ] **Step 5: 回归既有 providers 测试**

Run: `pnpm --filter server test -- src/routes/__tests__/providers.test.ts`
Expected: PASS。若有用例断言明文 apiKey，将其改为断言掩码值（这是预期行为变更，spec §3）。

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/routes/providers.ts apps/server/src/routes/__tests__/providers.masking.test.ts apps/server/src/routes/__tests__/providers.test.ts
git commit -m "feat(server): mask provider apiKey in responses and treat masked values as no-op on PATCH"
```

---

### Task 7: demo 工具白名单过滤

**Files:**
- Create: `apps/server/src/demo/tools.ts`
- Create: `apps/server/src/demo/__tests__/tools.test.ts`
- Modify: `apps/server/src/streaming/lifecycle.ts`
- Modify: `apps/server/src/jobs/worker.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// apps/server/src/demo/__tests__/tools.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { filterDemoTools, DEMO_ALLOWED_TOOLS } from '../tools.js';
import type { Tool } from '@my-copilot/shared';

function builtinTool(name: string): Tool {
  return {
    id: `t-${name}`,
    name,
    description: '',
    inputSchema: { fields: [] },
    type: 'built-in',
    safetyLevel: 'safe',
    sourceMcpId: null,
    policyVersion: 'v1',
    enabled: true,
    createdAt: 0,
    updatedAt: 0,
  };
}

function mcpTool(name: string): Tool {
  return { ...builtinTool(name), type: 'mcp-provided', safetyLevel: 'restricted', sourceMcpId: 'm1' };
}

afterEach(() => {
  delete process.env.DEMO_MODE;
});

describe('DEMO_ALLOWED_TOOLS', () => {
  it('contains only non-network safe built-ins', () => {
    expect(DEMO_ALLOWED_TOOLS.has('calculator')).toBe(true);
    expect(DEMO_ALLOWED_TOOLS.has('current_datetime')).toBe(true);
    expect(DEMO_ALLOWED_TOOLS.has('http_fetch')).toBe(false);
    expect(DEMO_ALLOWED_TOOLS.has('web_search')).toBe(false);
  });
});

describe('filterDemoTools', () => {
  it('passes everything through when DEMO_MODE unset', () => {
    const tools = [builtinTool('http_fetch'), builtinTool('calculator'), mcpTool('x')];
    expect(filterDemoTools(tools)).toEqual(tools);
  });

  it('keeps only whitelisted built-ins in demo mode', () => {
    process.env.DEMO_MODE = '1';
    const tools = [
      builtinTool('calculator'),
      builtinTool('http_fetch'),
      builtinTool('web_search'),
      mcpTool('anything'),
    ];
    expect(filterDemoTools(tools)).toEqual([builtinTool('calculator')]);
  });

  it('drops all mcp-provided tools in demo mode', () => {
    process.env.DEMO_MODE = '1';
    expect(filterDemoTools([mcpTool('a'), mcpTool('b')])).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter server test -- src/demo/__tests__/tools.test.ts`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 实现**

```typescript
// apps/server/src/demo/tools.ts
import type { Tool } from '@my-copilot/shared';

/**
 * Built-in tool names allowed in DEMO_MODE. Whitelist (not blacklist) on
 * purpose: new built-ins must be consciously reviewed before demo exposure.
 * Network-capable tools (http_fetch, web_search) are excluded — SSRF surface.
 * Spec: docs/superpowers/specs/2026-08-22-demo-deployment-design.md §4
 */
export const DEMO_ALLOWED_TOOLS: ReadonlySet<string> = new Set([
  'current_datetime',
  'calculator',
  'generate_uuid',
  'hash_text',
  'base64_encode',
  'base64_decode',
  'json_format',
]);

/** True when the server runs in DEMO_MODE. */
export function isDemoMode(): boolean {
  return process.env.DEMO_MODE === '1';
}

/**
 * Filter a tool list down to what a demo instance may advertise to the LLM.
 * No-op outside DEMO_MODE; in demo mode keeps whitelisted built-ins only
 * (MCP-provided tools are always dropped).
 */
export function filterDemoTools(tools: Tool[]): Tool[] {
  if (!isDemoMode()) return tools;
  return tools.filter(
    (tool) => tool.type === 'built-in' && DEMO_ALLOWED_TOOLS.has(tool.name),
  );
}
```

- [ ] **Step 4: 接线两个调用点**

`apps/server/src/streaming/lifecycle.ts`：import 追加

```typescript
import { filterDemoTools } from '../demo/tools.js';
```

`enabledTools` 构造（原第 69-75 行）改为：

```typescript
  const enabledTools = filterDemoTools([
    ...listRegisteredTools(),
    ...listEnabledTools().filter(
      (tool) =>
        tool.type === 'mcp-provided' && tool.sourceMcpId !== null,
    ),
  ]);
```

`apps/server/src/jobs/worker.ts`：在 `registerAgentLoopHandler` 内的动态 import 数组中，`{ listRegisteredTools }` 行后追加一项：

```typescript
      { filterDemoTools },
```

对应 `import('../demo/tools.js')` 追加到 `Promise.all` 数组（与 listRegisteredTools 的 import 相邻）。`tools` 构造（原第 268-271 行）改为：

```typescript
    const tools = filterDemoTools([
      ...listRegisteredTools(),
      ...listEnabledTools().filter((tool) => tool.type === 'mcp-provided'),
    ]);
```

- [ ] **Step 5: 运行确认通过 + 回归**

Run: `pnpm --filter server test -- src/demo/__tests__/tools.test.ts && pnpm --filter server test -- src/streaming/__tests__/lifecycle.test.ts && pnpm --filter server test -- src/agent-loop/__tests__/integration.test.ts`
Expected: 全部 PASS（lifecycle 测试 mock 了 listEnabledTools，过滤在 DEMO_MODE 未设时为直通，不受影响）。

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/demo/tools.ts apps/server/src/demo/__tests__/tools.test.ts apps/server/src/streaming/lifecycle.ts apps/server/src/jobs/worker.ts
git commit -m "feat(server): whitelist demo-mode tool advertisement (drop network and MCP tools)"
```

---

### Task 8: 演示数据播种

**Files:**
- Create: `apps/server/src/demo/seed.ts`
- Create: `apps/server/src/demo/__tests__/seed.test.ts`
- Modify: `apps/server/src/index.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// apps/server/src/demo/__tests__/seed.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { initDatabase } from '../../db/index.js';
import { seedDemoData } from '../seed.js';
import { listProviders, deleteProvider } from '../../repo/provider.js';
import { listAllEnabledModels } from '../../repo/model.js';

const TEST_DATA_DIR = resolve('.test-data-demo-seed');

beforeAll(() => {
  mkdirSync(TEST_DATA_DIR, { recursive: true });
  initDatabase(TEST_DATA_DIR);
});

afterAll(() => {
  try { rmSync(TEST_DATA_DIR, { recursive: true, force: true }); } catch { /* best-effort */ }
});

describe('seedDemoData', () => {
  it('seeds provider+model from env, then is idempotent', () => {
    process.env.DEMO_PROVIDER_BASE_URL = 'https://api.example.com';
    process.env.DEMO_PROVIDER_API_KEY = 'sk-demo';
    process.env.DEMO_PROVIDER_MODEL = 'glm-4-flash';
    process.env.DEMO_PROVIDER_NAME = 'Demo';

    const first = seedDemoData();
    expect(first.seeded).toBe(true);
    expect(listProviders()).toHaveLength(1);
    expect(listAllEnabledModels()).toHaveLength(1);
    expect(listProviders()[0].baseUrl).toBe('https://api.example.com');

    const second = seedDemoData();
    expect(second.seeded).toBe(false);
    expect(listProviders()).toHaveLength(1);
    expect(listAllEnabledModels()).toHaveLength(1);
  });

  it('throws when providers empty but env incomplete', () => {
    for (const p of listProviders()) deleteProvider(p.id);
    delete process.env.DEMO_PROVIDER_BASE_URL;
    delete process.env.DEMO_PROVIDER_API_KEY;
    delete process.env.DEMO_PROVIDER_MODEL;
    delete process.env.DEMO_PROVIDER_NAME;

    expect(() => seedDemoData()).toThrow(/DEMO_PROVIDER/);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter server test -- src/demo/__tests__/seed.test.ts`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 实现**

```typescript
// apps/server/src/demo/seed.ts
import { listProviders, createProvider } from '../repo/provider.js';
import { createModel } from '../repo/model.js';

export interface DemoSeedResult {
  seeded: boolean;
}

/**
 * Seed the demo instance with one provider + model from env vars.
 * Idempotent: skipped entirely when any provider already exists.
 * Called at startup when DEMO_MODE=1 (spec §5).
 */
export function seedDemoData(): DemoSeedResult {
  if (listProviders().length > 0) {
    return { seeded: false };
  }

  const baseUrl = process.env.DEMO_PROVIDER_BASE_URL;
  const apiKey = process.env.DEMO_PROVIDER_API_KEY;
  const modelName = process.env.DEMO_PROVIDER_MODEL;
  if (!baseUrl || !apiKey || !modelName) {
    throw new Error(
      'DEMO_MODE=1 with an empty providers table requires DEMO_PROVIDER_BASE_URL, DEMO_PROVIDER_API_KEY and DEMO_PROVIDER_MODEL',
    );
  }

  const provider = createProvider({
    name: process.env.DEMO_PROVIDER_NAME || 'Demo Provider',
    type: 'openai',
    baseUrl,
    apiKey,
    enabled: true,
  });
  createModel(provider.id, {
    name: modelName,
    displayName: modelName,
    enabled: true,
  });

  return { seeded: true };
}
```

注意 `createModel` 的实际签名是 `createModel(providerId, params: Omit<CreateModelParams, 'providerId'>)`（`apps/server/src/repo/model.ts:41`），上面代码已按此签名书写。

- [ ] **Step 4: index.ts 启动接线**

`apps/server/src/index.ts`：

1. import 追加：

```typescript
import { seedDemoData } from './demo/seed.js';
```

2. `const config = loadConfig(db);` 之后插入：

```typescript
// Demo seeding — create the demo provider/model when DEMO_MODE=1 and the
// providers table is empty (idempotent; daily reset re-triggers it).
if (config.demoMode) {
  try {
    const result = seedDemoData();
    console.log(`[demo] seed: ${result.seeded ? 'created demo provider/model' : 'skipped (providers exist)'}`);
  } catch (err) {
    console.error('[demo] seed failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
```

- [ ] **Step 5: 运行确认通过 + typecheck**

Run: `pnpm --filter server test -- src/demo/__tests__/seed.test.ts && pnpm typecheck`
Expected: PASS（2 例）；typecheck 无错误。

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/demo/seed.ts apps/server/src/demo/__tests__/seed.test.ts apps/server/src/index.ts
git commit -m "feat(server): seed demo provider/model at startup in DEMO_MODE"
```

---

### Task 9: 前端 — 角色识别与设置入口隐藏

**Files:**
- Modify: `apps/web/src/api/real.ts`
- Modify: `apps/web/src/store/configStore.ts`
- Modify: `apps/web/src/components/Asider/index.tsx`
- Create: `apps/web/src/store/configStore.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// apps/web/src/store/configStore.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useConfigStore } from './configStore';

function mockFetchOnce(status: number, body?: unknown) {
  const fn = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body ?? {}), { status }),
  );
  vi.stubGlobal('fetch', fn);
  return fn;
}

beforeEach(() => {
  useConfigStore.setState({
    authToken: null,
    role: null,
    tokenError: null,
    isTokenModalOpen: true,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('submitAuthToken', () => {
  it('accepts admin token and stores role', async () => {
    mockFetchOnce(200, { data: { role: 'admin', demoMode: false } });
    await useConfigStore.getState().submitAuthToken('admin-tok');
    const s = useConfigStore.getState();
    expect(s.authToken).toBe('admin-tok');
    expect(s.role).toBe('admin');
    expect(s.isTokenModalOpen).toBe(false);
    expect(s.tokenError).toBeNull();
  });

  it('accepts demo token and stores demo role', async () => {
    mockFetchOnce(200, { data: { role: 'demo', demoMode: true } });
    await useConfigStore.getState().submitAuthToken('demo-tok');
    const s = useConfigStore.getState();
    expect(s.authToken).toBe('demo-tok');
    expect(s.role).toBe('demo');
  });

  it('rejects invalid token with 401 and flags error', async () => {
    mockFetchOnce(401);
    await useConfigStore.getState().submitAuthToken('bad');
    const s = useConfigStore.getState();
    expect(s.authToken).toBeNull();
    expect(s.tokenError).toBe('令牌无效，请重试');
  });

  it('flags network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fail')));
    await useConfigStore.getState().submitAuthToken('any');
    expect(useConfigStore.getState().tokenError).toBe('网络错误，无法验证令牌');
  });
});

describe('clearAuthToken', () => {
  it('resets role and reopens modal', () => {
    useConfigStore.setState({ authToken: 'x', role: 'demo', isTokenModalOpen: false });
    useConfigStore.getState().clearAuthToken();
    const s = useConfigStore.getState();
    expect(s.authToken).toBeNull();
    expect(s.role).toBeNull();
    expect(s.isTokenModalOpen).toBe(true);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter web test -- src/store/configStore.test.ts`
Expected: FAIL —— `role` 状态不存在，且校验仍打 `/api/providers`。

- [ ] **Step 3: 实现 api 层**

`apps/web/src/api/real.ts`：在顶部 `@my-copilot/shared` 的类型 import 中追加 `AuthInfo`（该 import 已存在，只加名字）；在 `// ─── Provider APIs ───` 之前插入：

```typescript
// ─── Auth APIs ───

export async function fetchAuthMe(): Promise<AuthInfo> {
    const response = await enhancedFetch<{ data: AuthInfo }>('/api/auth/me', {
        method: 'GET',
        timeout: 30000,
    });
    return response.data;
}
```

- [ ] **Step 4: 实现 store**

`apps/web/src/store/configStore.ts`：

1. 接口 `ConfigStore` 追加（`tokenError` 字段之后）：

```typescript
    /** Caller role resolved via /api/auth/me; null until first successful auth. */
    role: 'admin' | 'demo' | null;
```

2. 初始 state 追加（`tokenError: null,` 之后）：`role: null,`

3. `clearAuthToken` 改为：

```typescript
            clearAuthToken: () => set({ authToken: null, role: null, isTokenModalOpen: true }),
```

4. `submitAuthToken` 整体替换（校验端点从 `/api/providers` 换成 `/api/auth/me` —— **关键**：demo token 访问 `/api/providers` 会得到 403，原实现会把演示访客挡在门外）：

```typescript
            submitAuthToken: async (token) => {
                // Validate against /api/auth/me (works for BOTH admin and demo
                // tokens; the old /api/providers probe 403'd demo tokens).
                try {
                    const res = await fetch('/api/auth/me', {
                        headers: { Authorization: `Bearer ${token}` },
                    });
                    if (res.ok) {
                        const body = (await res.json()) as { data: { role: 'admin' | 'demo' } };
                        set({ authToken: token, role: body.data.role, isTokenModalOpen: false, tokenError: null });
                    } else if (res.status === 401) {
                        set({ tokenError: '令牌无效，请重试' });
                    } else {
                        set({ tokenError: `验证失败（HTTP ${res.status}），请重试` });
                    }
                } catch {
                    set({ tokenError: '网络错误，无法验证令牌' });
                }
            },
```

（保持用原生 `fetch` + 显式 header 的既有模式——此刻新 token 尚未入 store，`enhancedFetch` 的自动带 token 帮不上忙。）

- [ ] **Step 5: Asider 隐藏设置导航**

`apps/web/src/components/Asider/index.tsx`：

1. 组件内（`goToSettings` 定义之前的 store 读取区，参照文件顶部既有的 `useSessionStore` 读取）追加：

```tsx
  // demo 角色隐藏设置入口（demo token 无权访问设置页接口，避免一屏 403）
  const role = useConfigStore((state) => state.role);
```

若 `useConfigStore` 尚未 import，在文件顶部补 `import { useConfigStore } from '../../store/configStore'`。

2. footer 中设置区块（`<span ...>设置</span>` 与四项导航按钮所在的 `<div className="flex flex-col">`，现第 134-161 行）整体包进条件渲染：

```tsx
        {role !== 'demo' && (
          <div className="flex flex-col">
            {/* ……原设置区块内容原样保留…… */}
          </div>
        )}
```

注意条件用 `!== 'demo'` 而非 `=== 'admin'`：旧版本 localStorage 里没有 `role` 字段（zustand persist 合并后为 `null`），自用版升级后不重新登录也能继续看到设置入口。

- [ ] **Step 6: 运行确认通过 + 回归 + typecheck**

Run: `pnpm --filter web test -- src/store/configStore.test.ts && pnpm --filter web test && pnpm typecheck`
Expected: 新测试 PASS（6 例）；web 既有测试无回归；typecheck 无错误。

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/api/real.ts apps/web/src/store/configStore.ts apps/web/src/components/Asider/index.tsx apps/web/src/store/configStore.test.ts
git commit -m "feat(web): resolve auth role via /api/auth/me and hide settings nav for demo role"
```

---

### Task 10: Docker — 演示实例 compose + 自用实例收紧

**Files:**
- Create: `docker/docker-compose.demo.yml`
- Create: `docker/.env.demo.example`
- Create: `docker/reset-demo.sh`
- Modify: `docker/docker-compose.yml`

- [ ] **Step 1: 创建演示 compose**

```yaml
# docker/docker-compose.demo.yml
# 演示实例：仅绑定 127.0.0.1:3100，由宿主机 nginx 反代对外。
# 与自用实例（docker-compose.yml，project mycopilot）使用不同 project
# name 与数据卷 → 独立 bridge 网络 + 独立 SQLite，互不可达。
version: '3.9'
name: mycopilot-demo
services:
  mycopilot-demo:
    build:
      context: ..
      dockerfile: docker/Dockerfile
    ports:
      - "127.0.0.1:3100:3000"
    volumes:
      - ./demo-data:/app/data
    environment:
      - AUTH_TOKEN=${AUTH_TOKEN:?set in docker/.env.demo}
      - DEMO_MODE=1
      - DEMO_TOKEN=${DEMO_TOKEN:?set in docker/.env.demo}
      - DEMO_PROVIDER_NAME=${DEMO_PROVIDER_NAME:-Demo Provider}
      - DEMO_PROVIDER_BASE_URL=${DEMO_PROVIDER_BASE_URL:?set in docker/.env.demo}
      - DEMO_PROVIDER_API_KEY=${DEMO_PROVIDER_API_KEY:?set in docker/.env.demo}
      - DEMO_PROVIDER_MODEL=${DEMO_PROVIDER_MODEL:?set in docker/.env.demo}
      - DATA_DIR=/app/data
      - PORT=3000
      - CORS_ORIGIN=${CORS_ORIGIN:-*}
      - LOG_LEVEL=${LOG_LEVEL:-info}
      - MAX_ATTACHMENT_SIZE_MB=2
      - SERVER_PUBLIC_DIR=/app/apps/web/dist
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3
```

- [ ] **Step 2: 创建环境变量模板**

```bash
# docker/.env.demo.example
# 复制为 docker/.env.demo 并填入真实值。此文件含密钥，永不提交。
#   cp .env.demo.example .env.demo

# 管理员 token（长随机串，仅自己用）：openssl rand -hex 32
AUTH_TOKEN=

# 公开演示 token（写在简历上，仅白名单权限）：openssl rand -hex 16
DEMO_TOKEN=

# 演示专用低额度 LLM（在供应商控制台设月度上限）
DEMO_PROVIDER_NAME=GLM Demo
DEMO_PROVIDER_BASE_URL=https://open.bigmodel.cn/api
DEMO_PROVIDER_API_KEY=
DEMO_PROVIDER_MODEL=glm-4-flash

# 演示域名（同源部署下 CORS 影响不大，显式写上）
CORS_ORIGIN=https://demo.example.com
```

- [ ] **Step 3: 创建重置脚本**

```bash
#!/usr/bin/env bash
# docker/reset-demo.sh
# 每日重置演示实例：清空演示数据卷并重建（DEMO_MODE 启动时自动重新播种）。
# crontab 示例（宿主机）：
#   30 4 * * * /path/to/MyCopilot/docker/reset-demo.sh >> /var/log/mycopilot-demo-reset.log 2>&1
set -euo pipefail
cd "$(dirname "$0")"

docker compose -f docker-compose.demo.yml --env-file .env.demo down
rm -rf ./demo-data
docker compose -f docker-compose.demo.yml --env-file .env.demo up -d
```

Run: `git update-index --add --chmod=+x docker/reset-demo.sh`（Windows 下无法 chmod，用 git 记录可执行位；并确保文件以 LF 保存）。

- [ ] **Step 4: 自用实例收紧到 127.0.0.1**

`docker/docker-compose.yml` 的 ports 改为：

```yaml
    ports:
      - "127.0.0.1:3000:3000"
```

（自用版不再公网可达：本机直连 + Tailscale/SSH 隧道访问，见 spec §1。）

- [ ] **Step 5: 验证 compose 语法**

Run: `docker compose -f docker/docker-compose.demo.yml --env-file docker/.env.demo.example config --quiet`
Expected: 无报错退出（exit 0）。若 `.env.demo.example` 的空值触发 `:?` 校验，属预期——说明必填校验生效；此时改用临时填充的 env 文件验证，或接受该报错作为校验证据。

- [ ] **Step 6: .gitignore 检查**

确认 `docker/demo-data/` 与 `docker/.env.demo` 不会被提交。若 `.gitignore` 无相关条目则追加：

```
docker/demo-data/
docker/.env.demo
```

- [ ] **Step 7: Commit**

```bash
git add docker/docker-compose.demo.yml docker/.env.demo.example docker/reset-demo.sh docker/docker-compose.yml .gitignore
git commit -m "chore(docker): add isolated demo compose with env-gated secrets and loopback-only self-host"
```

---

### Task 11: 部署文档（nginx + cron + 上线手册）

**Files:**
- Create: `docs/deploy-demo.md`

- [ ] **Step 1: 撰写文档（中文，代码块保留原文）**

文档结构（完整写出，不留 TBD）：

````markdown
# 演示版部署手册

面向简历演示链接的上线与日常运维。设计依据：`docs/superpowers/specs/2026-08-22-demo-deployment-design.md`。

## 拓扑

- `demo.<域名>` → nginx(443) → `127.0.0.1:3100` → mycopilot-demo 容器（DEMO_MODE=1）
- 自用实例 → `127.0.0.1:3000`，不进 nginx；外出经 Tailscale/SSH 隧道
- 两个 compose project 独立网络与数据卷，互不可达

## 首次上线步骤

1. 构建镜像并启动两实例：
   ```bash
   cd docker
   cp .env.demo.example .env.demo   # 填入真实值
   docker compose up -d                          # 自用（project: docker 自身目录名）
   docker compose -f docker-compose.demo.yml --env-file .env.demo up -d
   ```
2. 验证：`curl http://127.0.0.1:3100/api/health` 返回 ok。
3. nginx 配置（见下节），`nginx -t && systemctl reload nginx`。
4. DNS：`demo.<域名>` A 记录指向服务器。
5. 防火墙：仅放行 80/443；确认 3000/3100 未对公网开放（`ss -tlnp | grep -E '3000|3100'` 应只出现在 127.0.0.1）。

## nginx 站点配置

`limit_req_zone` / `limit_conn_zone` 必须放在 `http {}` 级（如 `/etc/nginx/conf.d/demo-ratelimit.conf`）：

```nginx
limit_req_zone $binary_remote_addr zone=demo_api:10m rate=30r/m;
limit_req_zone $binary_remote_addr zone=demo_chat:10m rate=10r/m;
limit_conn_zone $binary_remote_addr zone=demo_conn:10m;
```

站点（`/etc/nginx/sites-available/demo.example.com.conf`，按发行版放入对应目录）：

```nginx
server {
    listen 443 ssl;
    server_name demo.example.com;

    # 复用已有证书或 acme.sh 签发
    # ssl_certificate     /path/to/fullchain.pem;
    # ssl_certificate_key /path/to/privkey.pem;

    client_max_body_size 3m;

    # 聊天 + 会话 SSE：更严限流，关闭缓冲
    location /api/sessions/ {
        limit_req zone=demo_chat burst=5 nodelay;
        limit_conn demo_conn 10;
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_read_timeout 3600s;
    }

    # 任务进度 SSE
    location /api/jobs/stream {
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;
        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_read_timeout 3600s;
    }

    location /api/ {
        limit_req zone=demo_api burst=10 nodelay;
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
    }

    location / {
        proxy_pass http://127.0.0.1:3100;
        proxy_set_header Host $host;
    }
}

server {
    listen 80;
    server_name demo.example.com;
    return 301 https://$host$request_uri;
}
```

## 每日重置

宿主机 crontab（`crontab -e`）：

```
30 4 * * * /path/to/MyCopilot/docker/reset-demo.sh >> /var/log/mycopilot-demo-reset.log 2>&1
```

效果：访客数据最多存活 24 小时；演示 Provider 每次重置后自动重新播种，token 不变。

## 上线后验收清单

- [ ] 打开 `https://demo.<域名>`，输入 DEMO_TOKEN，30 秒内能流式对话
- [ ] demo 角色看不到侧栏"设置"区块
- [ ] 手动 `curl -H "Authorization: Bearer <DEMO_TOKEN>" https://demo.<域名>/api/providers` 返回 403
- [ ] 快速连发消息触发 429
- [ ] 执行 `docker/reset-demo.sh` 后链接仍可用
- [ ] 公网扫描 3000/3100 端口不通

## 故障排查

| 现象 | 排查 |
|---|---|
| 聊天不流式、整段蹦出 | nginx 未对 `/api/sessions/` 关 `proxy_buffering` |
| 演示 token 登录被拒 | `.env.demo` 的 DEMO_TOKEN 与输入不一致；看 `docker compose -f docker-compose.demo.yml logs` |
| 重置后无法对话 | 播种失败：检查三个 DEMO_PROVIDER_* 变量与 LLM 余额 |
````

- [ ] **Step 2: Commit**

```bash
git add docs/deploy-demo.md
git commit -m "docs(deploy): add demo deployment runbook with nginx rate limiting and daily reset"
```

---

### Task 12: 全量验证

**Files:** 无新增（验证任务）

- [ ] **Step 1: 全量测试**

Run: `pnpm test`
Expected: 全部 PASS。仅当失败由本计划改动引起时修复；用户在途改动的既有失败如实上报，不扩大范围。

- [ ] **Step 2: 类型 + Lint**

Run: `pnpm typecheck && pnpm lint`
Expected: 无错误。

- [ ] **Step 3: 本地端到端冒烟（可选但推荐）**

```bash
# 终端 1（PowerShell）：
$env:DEMO_MODE='1'; $env:DEMO_TOKEN='demo-smoke'; $env:AUTH_TOKEN='admin-smoke';
$env:DEMO_PROVIDER_BASE_URL='https://open.bigmodel.cn/api'; $env:DEMO_PROVIDER_API_KEY='<真实演示key>';
$env:DEMO_PROVIDER_MODEL='glm-4-flash'; pnpm --filter server dev
# 终端 2：
curl.exe -H "Authorization: Bearer demo-smoke" http://localhost:3000/api/models        # 200
curl.exe -H "Authorization: Bearer demo-smoke" http://localhost:3000/api/providers    # 403
curl.exe -H "Authorization: Bearer admin-smoke" http://localhost:3000/api/providers   # 200，apiKey 为掩码
curl.exe -H "Authorization: Bearer demo-smoke" http://localhost:3000/api/auth/me      # {"data":{"role":"demo","demoMode":true}}
```

Expected: 注释所示四组结果。结束后清掉本地 `data/` 中冒烟产生的演示库（或直接删除 `apps/server/data/` 下本次生成的 db——该目录本就 gitignored，属临时数据）。

- [ ] **Step 4: 最终提交（若有冒烟修复）**

```bash
git status   # 确认无本计划文件的未提交残留
```

---

## Self-Review 记录

- **Spec 覆盖**：§1 拓扑→Task 10/11；§2 双 token→Task 2/4/5/9；§3 脱敏→Task 3/6；§4 工具过滤/限流/附件→Task 7/10/11；§5 播种/重置→Task 8/10/11；§6 测试→各任务 TDD + Task 12。无缺口。
- **占位符**：无 TBD/TODO；所有代码块均为可直接落盘的完整实现。
- **类型一致性**：`AuthRole`/`AuthInfo`（Task 1）与 routes/auth.ts 返回、web store `role` 一致；`filterDemoTools`/`isDemoMode`/`DEMO_ALLOWED_TOOLS`（Task 7）在 Task 5/7 间引用一致；`maskApiKey`/`isMaskedApiKey`（Task 3）与 Task 6 用法一致；`demoMode`/`demoToken`（Task 2）与 index.ts 接线（Task 5/8）一致。
- **风险点**：① `HttpError` 是否支持 403 已在 Task 4 Step 3 显式交代检查路径；② 既有 `providers.test.ts` 若断言明文 key，Task 6 Step 5 已给出处置；③ 旧 localStorage 无 role 的兼容已用 `role !== 'demo'` 处理。
