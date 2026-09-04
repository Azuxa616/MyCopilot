# MCP 配置 JSON 化实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 MCP 新建/编辑表单改成"粘贴 JSON + 实时校验 + 表单内测试连通"，JSON 校验作为保存的唯一门禁。

**Architecture:** 前端 `McpFormModal` 用 JSON textarea 替换 transport/command/args/env/url 五个分字段；新增 `POST /api/mcps/test-config` 路由 + `manager.testConnection` 实现不落库的临时连接测试；前端 `validateConfigJson` 纯函数做语法+结构两层实时校验作为保存门禁。数据模型与现有 API 完全不变。

**Tech Stack:** React 19 + TypeScript + TailwindCSS 4（前端）；Hono + better-sqlite3 + @modelcontextprotocol/sdk（后端）；Vitest（测试）；共享类型 @my-copilot/shared。

**关联设计文档：** `docs/2026-08-10-mcp-json-config-design.md`

---

## 文件结构

| 文件 | 责任 | 改动 |
|------|------|------|
| `packages/shared/src/mcp.ts` | 新增 `TestMcpConfigParams` / `TestMcpConfigResult` 类型 | 新增 |
| `packages/shared/src/__tests__/mcp.test.ts` | 类型存在性测试 | 新增测试 |
| `apps/server/src/mcp/manager.ts` | 新增 `testConnection` 函数（独立于连接池的临时测试） | 新增导出 |
| `apps/server/src/mcp/index.ts` | barrel 导出 `testConnection` | 新增一行 |
| `apps/server/src/mcp/__tests__/manager.test.ts` | `testConnection` 单测 | 新增测试 |
| `apps/server/src/routes/mcps.ts` | 新增 `POST /test-config` 路由 | 新增路由 |
| `apps/server/src/routes/__tests__/mcps.test.ts` | 路由测试 | 新增测试 |
| `apps/web/src/utils/mcpConfig.ts` | `validateConfigJson` 纯函数（语法+结构校验） | 新建 |
| `apps/web/src/utils/mcpConfig.test.ts` | 校验函数单测 | 新建 |
| `apps/web/src/api/real.ts` | `testMcpConfig` API 函数 | 新增函数 |
| `apps/web/src/components/McpFormModal.tsx` | 重构：表单字段 → JSON textarea | 重写 |

**说明：** `apps/web/src/api/index.ts` 用 `import * as real; export const api = real`，`real.ts` 新增函数自动通过 `api.*` 暴露，**无需修改**。

---

## Task 1: shared 类型定义

**Files:**
- Modify: `packages/shared/src/mcp.ts`
- Test: `packages/shared/src/__tests__/mcp.test.ts`

- [ ] **Step 1: 写失败测试**

在 `packages/shared/src/__tests__/mcp.test.ts` 末尾的 `describe` 块内追加：

```typescript
  it('TestMcpConfigParams carries a McpConfig', () => {
    const params: TestMcpConfigParams = {
      config: { transport: 'stdio', command: 'npx' },
    };
    expect(params.config.transport).toBe('stdio');
  });

  it('TestMcpConfigResult success shape with tool names', () => {
    const ok: TestMcpConfigResult = {
      success: true,
      tools: ['browser_navigate', 'browser_click'],
    };
    expect(ok.success).toBe(true);
    expect(ok.tools).toHaveLength(2);
  });

  it('TestMcpConfigResult failure shape with error', () => {
    const fail: TestMcpConfigResult = {
      success: false,
      error: 'connection refused',
    };
    expect(fail.success).toBe(false);
    expect(fail.error).toBe('connection refused');
  });
```

并在文件顶部 import 中追加新类型：

```typescript
import type {
  McpTransport,
  McpConfig,
  Mcp,
  TestMcpConfigParams,
  TestMcpConfigResult,
} from '../mcp.js';
```

- [ ] **Step 2: 运行测试验证失败**

Run: `pnpm --filter @my-copilot/shared test`
Expected: FAIL — `TestMcpConfigParams` / `TestMcpConfigResult` 未导出（TS 编译错误或运行时 undefined）

- [ ] **Step 3: 实现类型**

在 `packages/shared/src/mcp.ts` 末尾追加：

```typescript
export interface TestMcpConfigParams {
  config: McpConfig;
}

export interface TestMcpConfigResult {
  success: boolean;
  tools?: string[];
  error?: string;
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `pnpm --filter @my-copilot/shared test`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/shared/src/mcp.ts packages/shared/src/__tests__/mcp.test.ts
git commit -m "feat(shared): add TestMcpConfigParams and TestMcpConfigResult types"
```

---

## Task 2: manager.testConnection（后端临时连接测试）

**Files:**
- Modify: `apps/server/src/mcp/manager.ts`
- Modify: `apps/server/src/mcp/index.ts`
- Test: `apps/server/src/mcp/__tests__/manager.test.ts`

- [ ] **Step 1: 写失败测试**

在 `apps/server/src/mcp/__tests__/manager.test.ts` 的 import 块中追加 `testConnection`：

```typescript
import {
  ensureConnected,
  listTools,
  callTool,
  disconnect,
  disconnectAll,
  listAllTools,
  getConnection,
  testConnection,
  __clearConnectionsForTests,
} from '../manager.js';
```

在文件末尾（最后一个 `});` 之前）追加新的 describe 块：

```typescript
  // --- testConnection ----------------------------------------------------
  describe('testConnection', () => {
    it('returns success and tool names when connect + listTools succeed', async () => {
      proto.connect.mockResolvedValue(undefined);
      proto.listTools.mockResolvedValue({
        tools: [
          { name: 'browser_navigate', inputSchema: { type: 'object' } },
          { name: 'browser_click', inputSchema: { type: 'object' } },
        ],
      });

      const result = await testConnection(stdioConfig);

      expect(result.success).toBe(true);
      expect(result.tools).toEqual(['browser_navigate', 'browser_click']);
      expect(result.error).toBeUndefined();
      // client.close() is always invoked (cleanup).
      expect(proto.close).toHaveBeenCalledTimes(1);
    });

    it('returns failure with error when connect throws', async () => {
      proto.connect.mockRejectedValue(new Error('spawn ENOENT'));

      const result = await testConnection(stdioConfig);

      expect(result.success).toBe(false);
      expect(result.tools).toEqual([]);
      expect(result.error).toBe('spawn ENOENT');
      // close() is still called in finally even on failure.
      expect(proto.close).toHaveBeenCalledTimes(1);
    });

    it('returns failure when listTools throws', async () => {
      proto.connect.mockResolvedValue(undefined);
      proto.listTools.mockRejectedValue(new Error('protocol error'));

      const result = await testConnection(stdioConfig);

      expect(result.success).toBe(false);
      expect(result.error).toBe('protocol error');
      expect(proto.close).toHaveBeenCalledTimes(1);
    });

    it('does not pollute the connection pool', async () => {
      proto.connect.mockResolvedValue(undefined);
      proto.listTools.mockResolvedValue({ tools: [] });

      await testConnection(stdioConfig);

      // testConnection must NOT register anything in the pool.
      // getConnection only knows about ensureConnected-managed entries.
      expect(getConnection('__test__')).toBeUndefined();
      expect(getConnection('any')).toBeUndefined();
    });

    it('wraps non-Error throws into a generic error message', async () => {
      proto.connect.mockRejectedValue('string error');

      const result = await testConnection(stdioConfig);

      expect(result.success).toBe(false);
      expect(result.error).toBe('连接失败');
    });
  });
```

- [ ] **Step 2: 运行测试验证失败**

Run: `pnpm --filter server test -- --run apps/server/src/mcp/__tests__/manager.test.ts`
Expected: FAIL — `testConnection` 未导出（import 报错）

- [ ] **Step 3: 实现 testConnection**

在 `apps/server/src/mcp/manager.ts` 的 `getConnection` 函数之后、`__clearConnectionsForTests` 之前，追加：

```typescript
/**
 * 临时连接测试：建立连接 → 列工具 → 立即关闭，不污染连接池。
 *
 * 用于 POST /api/mcps/test-config（不落库的表单内测试）。失败信息进 `error`
 * 字段返回，不抛异常 —— 与现有 POST /:id/test 的风格一致。
 */
export async function testConnection(
  config: McpConfig,
  timeoutMs?: number,
): Promise<{ success: boolean; tools: string[]; error?: string }> {
  const timeout = timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const client = new Client({
    name: 'my-copilot-test',
    version: '1.0.0',
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const transport = createTransport(config);
    await client.connect(transport);
    const result = await client.listTools();
    return {
      success: true,
      tools: result.tools.map((t) => t.name),
    };
  } catch (err) {
    return {
      success: false,
      tools: [],
      error: err instanceof Error ? err.message : '连接失败',
    };
  } finally {
    clearTimeout(timer);
    await safeClose(client);
  }
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `pnpm --filter server test -- --run apps/server/src/mcp/__tests__/manager.test.ts`
Expected: PASS — 5 个新增用例全部通过

- [ ] **Step 5: 在 barrel 导出 testConnection**

修改 `apps/server/src/mcp/index.ts`，在第一个 `export { ... } from './manager.js'` 块中加入 `testConnection`：

```typescript
export {
  ensureConnected,
  listTools,
  callTool,
  disconnect,
  disconnectAll,
  listAllTools,
  getConnection,
  testConnection,
  __clearConnectionsForTests,
} from './manager.js';
export type { McpConnection, McpConnectionHealth } from './manager.js';
export { createTransport } from './transport-factory.js';
export {
  synchronizeMcpTools,
  trySynchronizeMcpTools,
  synchronizeAllEnabledMcps,
} from './sync.js';
```

- [ ] **Step 6: 提交**

```bash
git add apps/server/src/mcp/manager.ts apps/server/src/mcp/index.ts apps/server/src/mcp/__tests__/manager.test.ts
git commit -m "feat(server): add testConnection for non-persisting MCP connectivity check"
```

---

## Task 3: POST /test-config 路由

**Files:**
- Modify: `apps/server/src/routes/mcps.ts`
- Test: `apps/server/src/routes/__tests__/mcps.test.ts`

- [ ] **Step 1: 扩展 mock 并写失败测试**

在 `apps/server/src/routes/__tests__/mcps.test.ts` 中，先把 `testConnection` 加入 `../../mcp/index.js` 的 mock：

```typescript
vi.mock('../../mcp/index.js', () => ({
  disconnect: vi.fn().mockResolvedValue(undefined),
  synchronizeMcpTools: vi.fn(),
  trySynchronizeMcpTools: vi.fn().mockResolvedValue(null),
  testConnection: vi.fn(),
}));
```

在 import 块中追加 `testConnection`：

```typescript
import {
  disconnect,
  synchronizeMcpTools,
  trySynchronizeMcpTools,
  testConnection,
} from '../../mcp/index.js';
```

在文件末尾（最后一个 `});` 之前）追加测试：

```typescript
  describe('POST /test-config', () => {
    beforeEach(() => {
      vi.mocked(testConnection).mockReset();
    });

    it('returns 400 when config is missing transport', async () => {
      const app = createTestApp();
      const res = await app.request('/test-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: { command: 'npx' } }),
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 when stdio config has no command', async () => {
      const app = createTestApp();
      const res = await app.request('/test-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          config: { transport: 'stdio', args: ['-y'] },
        }),
      });
      expect(res.status).toBe(400);
    });

    it('returns success and tool names when testConnection succeeds', async () => {
      vi.mocked(testConnection).mockResolvedValue({
        success: true,
        tools: ['browser_navigate', 'browser_click'],
      });

      const app = createTestApp();
      const res = await app.request('/test-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: stdioConfig }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        code: number;
        data: { success: boolean; tools: string[] };
      };
      expect(body.code).toBe(0);
      expect(body.data.success).toBe(true);
      expect(body.data.tools).toEqual(['browser_navigate', 'browser_click']);
      expect(testConnection).toHaveBeenCalledWith(stdioConfig);
    });

    it('returns code -1 when testConnection reports failure', async () => {
      vi.mocked(testConnection).mockResolvedValue({
        success: false,
        tools: [],
        error: 'spawn ENOENT',
      });

      const app = createTestApp();
      const res = await app.request('/test-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: stdioConfig }),
      });
      // Note: HTTP 200 with code=-1, consistent with POST /:id/test.
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        code: number;
        msg: string;
        data: { success: boolean; error: string };
      };
      expect(body.code).toBe(-1);
      expect(body.msg).toBe('spawn ENOENT');
      expect(body.data.success).toBe(false);
      expect(body.data.error).toBe('spawn ENOENT');
    });
  });
```

- [ ] **Step 2: 运行测试验证失败**

Run: `pnpm --filter server test -- --run apps/server/src/routes/__tests__/mcps.test.ts`
Expected: FAIL — `/test-config` 路由不存在（返回 404）

- [ ] **Step 3: 实现路由**

在 `apps/server/src/routes/mcps.ts` 中：

顶部 import 追加 `testConnection`：

```typescript
import {
  disconnect,
  synchronizeMcpTools,
  trySynchronizeMcpTools,
  testConnection,
} from '../mcp/index.js';
```

在 `mcpsApp.post('/', ...)` 路由之后、`mcpsApp.get('/:id', ...)` 之前，插入新路由：

```typescript
mcpsApp.post('/test-config', async (c) => {
  const body = await c.req.json();
  validateMcpConfig(body?.config);

  const result = await testConnection(body.config);
  return c.json({
    code: result.success ? 0 : -1,
    msg: result.success ? 'ok' : (result.error ?? '连接失败'),
    data: result,
  });
});
```

- [ ] **Step 4: 运行测试验证通过**

Run: `pnpm --filter server test -- --run apps/server/src/routes/__tests__/mcps.test.ts`
Expected: PASS — 新增 4 个用例全部通过，原有用例不受影响

- [ ] **Step 5: 提交**

```bash
git add apps/server/src/routes/mcps.ts apps/server/src/routes/__tests__/mcps.test.ts
git commit -m "feat(server): add POST /api/mcps/test-config route for form-internal connectivity check"
```

---

## Task 4: 前端校验纯函数 + API 函数

**Files:**
- Create: `apps/web/src/utils/mcpConfig.ts`
- Create: `apps/web/src/utils/mcpConfig.test.ts`
- Modify: `apps/web/src/api/real.ts`

### Part A: validateConfigJson 纯函数（TDD）

- [ ] **Step 1: 写失败测试**

创建 `apps/web/src/utils/mcpConfig.test.ts`：

```typescript
import { describe, it, expect } from 'vitest'
import { validateConfigJson } from './mcpConfig'

describe('validateConfigJson', () => {
  it('rejects empty input', () => {
    const r = validateConfigJson('')
    expect(r.config).toBeNull()
    expect(r.error).toBe('配置不能为空')
    expect(r.preview).toBeNull()
  })

  it('rejects whitespace-only input', () => {
    const r = validateConfigJson('   \n  \t  ')
    expect(r.error).toBe('配置不能为空')
  })

  it('rejects invalid JSON with a syntax error message', () => {
    const r = validateConfigJson('{ transport: "stdio" }')
    expect(r.config).toBeNull()
    expect(r.error).toMatch(/JSON 语法错误/)
  })

  it('rejects JSON that is an array', () => {
    const r = validateConfigJson('[]')
    expect(r.error).toBe('JSON 必须是一个对象')
  })

  it('rejects JSON that is a primitive', () => {
    const r = validateConfigJson('"hello"')
    expect(r.error).toBe('JSON 必须是一个对象')
  })

  it('rejects missing transport', () => {
    const r = validateConfigJson('{"command": "npx"}')
    expect(r.error).toBe('transport 必须是 stdio / sse / http 之一')
  })

  it('rejects invalid transport value', () => {
    const r = validateConfigJson('{"transport": "ftp", "url": "x"}')
    expect(r.error).toBe('transport 必须是 stdio / sse / http 之一')
  })

  it('rejects stdio without command', () => {
    const r = validateConfigJson('{"transport": "stdio", "args": ["-y"]}')
    expect(r.error).toBe('stdio 传输需要非空 command')
  })

  it('rejects stdio with empty command string', () => {
    const r = validateConfigJson('{"transport": "stdio", "command": "  "}')
    expect(r.error).toBe('stdio 传输需要非空 command')
  })

  it('rejects sse without url', () => {
    const r = validateConfigJson('{"transport": "sse"}')
    expect(r.error).toBe('sse 传输需要非空 url')
  })

  it('rejects http without url', () => {
    const r = validateConfigJson('{"transport": "http"}')
    expect(r.error).toBe('http 传输需要非空 url')
  })

  it('accepts valid stdio config and builds preview', () => {
    const r = validateConfigJson(
      '{"transport":"stdio","command":"npx","args":["-y","@playwright/mcp@latest"],"env":{}}',
    )
    expect(r.error).toBeNull()
    expect(r.config).toEqual({
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@playwright/mcp@latest'],
      env: {},
    })
    expect(r.preview).toBe('stdio · npx -y @playwright/mcp@latest')
  })

  it('accepts valid stdio config without args', () => {
    const r = validateConfigJson('{"transport":"stdio","command":"node"}')
    expect(r.error).toBeNull()
    expect(r.preview).toBe('stdio · node')
  })

  it('accepts valid sse config and builds preview', () => {
    const r = validateConfigJson(
      '{"transport":"sse","url":"https://example.com/sse"}',
    )
    expect(r.error).toBeNull()
    expect(r.config?.transport).toBe('sse')
    expect(r.preview).toBe('sse · https://example.com/sse')
  })

  it('ignores unknown fields (lenient mode)', () => {
    const r = validateConfigJson(
      '{"transport":"stdio","command":"npx","cwd":"/tmp","type":"local"}',
    )
    expect(r.error).toBeNull()
    expect(r.config?.command).toBe('npx')
  })
})
```

- [ ] **Step 2: 运行测试验证失败**

Run: `pnpm --filter web test -- --run apps/web/src/utils/mcpConfig.test.ts`
Expected: FAIL — `./mcpConfig` 模块不存在

- [ ] **Step 3: 实现 validateConfigJson**

创建 `apps/web/src/utils/mcpConfig.ts`：

```typescript
import type { McpConfig } from '@my-copilot/shared'

export interface ConfigValidation {
  /** 解析成功且结构合法时为对象，否则 null */
  config: McpConfig | null
  /** 错误信息，通过校验时为 null */
  error: string | null
  /** 校验通过时的摘要预览，否则 null */
  preview: string | null
}

const VALID_TRANSPORTS = new Set(['stdio', 'sse', 'http'])

/**
 * 校验 MCP 配置 JSON 文本：语法层（JSON.parse）+ 结构层（镜像后端
 * validateMcpConfig 的 transport/command/url 规则）。供 McpFormModal
 * 做实时校验与保存门禁。
 */
export function validateConfigJson(text: string): ConfigValidation {
  const trimmed = text.trim()
  if (trimmed.length === 0) {
    return { config: null, error: '配置不能为空', preview: null }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch (err) {
    const msg = err instanceof Error ? err.message : '解析失败'
    return { config: null, error: `JSON 语法错误：${msg}`, preview: null }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { config: null, error: 'JSON 必须是一个对象', preview: null }
  }

  const obj = parsed as Record<string, unknown>
  const transport = obj.transport
  if (
    typeof transport !== 'string' ||
    !VALID_TRANSPORTS.has(transport)
  ) {
    return {
      config: null,
      error: 'transport 必须是 stdio / sse / http 之一',
      preview: null,
    }
  }

  if (transport === 'stdio') {
    if (
      typeof obj.command !== 'string' ||
      obj.command.trim().length === 0
    ) {
      return {
        config: null,
        error: 'stdio 传输需要非空 command',
        preview: null,
      }
    }
  } else {
    if (typeof obj.url !== 'string' || obj.url.trim().length === 0) {
      return {
        config: null,
        error: `${transport} 传输需要非空 url`,
        preview: null,
      }
    }
  }

  const config = parsed as McpConfig
  return { config, error: null, preview: buildPreview(config) }
}

function buildPreview(config: McpConfig): string {
  if (config.transport === 'stdio') {
    const parts = [config.command ?? '']
    if (config.args && config.args.length > 0) {
      parts.push(config.args.join(' '))
    }
    return `stdio · ${parts.join(' ').trim()}`
  }
  return `${config.transport} · ${config.url ?? ''}`
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `pnpm --filter web test -- --run apps/web/src/utils/mcpConfig.test.ts`
Expected: PASS — 全部 16 个用例通过

### Part B: testMcpConfig API 函数

- [ ] **Step 5: 在 real.ts 新增 testMcpConfig**

在 `apps/web/src/api/real.ts` 中，顶部 import 块加入新类型（在现有 `@my-copilot/shared` import 里追加）：

```typescript
import type {
    // ...existing imports...
    McpConfig,
    TestMcpConfigResult,
} from '@my-copilot/shared';
```

（若 `McpConfig` 已 import 则只追加 `TestMcpConfigResult`。）

在 `testMcp` 函数之后追加：

```typescript
/**
 * Test an MCP config WITHOUT persisting — form-internal connectivity check.
 * POST /api/mcps/test-config
 *
 * Unlike `testMcp(id)`, this does not save the MCP first; it connects to the
 * server described by `config`, lists tools, and disconnects. Used by the
 * JSON config form's "测试连通" button.
 */
export async function testMcpConfig(
    config: McpConfig,
): Promise<TestMcpConfigResult> {
    const response = await enhancedFetch<{
        data: TestMcpConfigResult;
    }>('/api/mcps/test-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config }),
        // stdio spawn + initialize handshake can take a while; allow headroom
        // beyond the server's 30s internal timeout.
        timeout: 45000,
    });
    return response.data;
}
```

- [ ] **Step 6: 类型检查**

Run: `pnpm --filter web typecheck`
Expected: PASS — 无类型错误（`api.testMcpConfig` 自动通过 barrel 可用）

- [ ] **Step 7: 提交**

```bash
git add apps/web/src/utils/mcpConfig.ts apps/web/src/utils/mcpConfig.test.ts apps/web/src/api/real.ts
git commit -m "feat(web): add validateConfigJson util and testMcpConfig API"
```

---

## Task 5: McpFormModal 重构（JSON textarea + 实时校验 + 测试连通）

**Files:**
- Modify (rewrite): `apps/web/src/components/McpFormModal.tsx`

- [ ] **Step 1: 重写 McpFormModal.tsx**

用以下完整内容替换 `apps/web/src/components/McpFormModal.tsx`：

```typescript
// McpFormModal - Create / edit an MCP server connection via JSON config.
//
// 用户直接粘贴 McpConfig JSON（扁平格式，对应 @my-copilot/shared 的 McpConfig）。
// 前端用 validateConfigJson 做语法+结构实时校验作为保存门禁；"测试连通"
// 按钮调 POST /api/mcps/test-config 做不落库的临时连接测试。

import { useState, useEffect, useMemo } from 'react'
import type {
  Mcp,
  McpConfig,
  CreateMcpParams,
  UpdateMcpParams,
} from '@my-copilot/shared'
import { api } from '../api'
import Modal from './common/Modal'
import { FormField, formControlClassName } from './common/FormField'
import { validateConfigJson } from '../utils/mcpConfig'

export interface McpFormModalProps {
  open: boolean
  onClose: () => void
  /** When set, the modal edits this MCP; otherwise it creates a new one. */
  mcp?: Mcp | null
  onSave: (params: CreateMcpParams | UpdateMcpParams) => void
}

const DEFAULT_CONFIG_TEXT = `{
  "transport": "stdio",
  "command": "npx",
  "args": ["-y", "@playwright/mcp@latest"],
  "env": {}
}`

interface TestState {
  loading: boolean
  success?: boolean
  tools?: string[]
  error?: string
}

export default function McpFormModal({
  open,
  onClose,
  mcp,
  onSave,
}: McpFormModalProps) {
  const isEdit = Boolean(mcp)

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [configText, setConfigText] = useState(DEFAULT_CONFIG_TEXT)
  const [enabled, setEnabled] = useState(true)
  const [test, setTest] = useState<TestState>({ loading: false })

  // Reset / hydrate whenever the modal opens or the target mcp changes.
  useEffect(() => {
    if (!open) return
    if (mcp) {
      setName(mcp.name)
      setDescription(mcp.description)
      setConfigText(JSON.stringify(mcp.config, null, 2))
      setEnabled(mcp.enabled)
    } else {
      setName('')
      setDescription('')
      setConfigText(DEFAULT_CONFIG_TEXT)
      setEnabled(true)
    }
    setTest({ loading: false })
  }, [open, mcp])

  // 实时校验（每次 render 都算；validateConfigJson 是纯函数且很轻）。
  const validation = useMemo(() => validateConfigJson(configText), [configText])

  const canSave =
    name.trim().length > 0 && validation.config !== null

  const handleTest = async () => {
    if (!validation.config) return
    setTest({ loading: true })
    try {
      const result = await api.testMcpConfig(validation.config)
      setTest({
        loading: false,
        success: result.success,
        tools: result.tools,
        error: result.error,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : '请求失败'
      setTest({ loading: false, success: false, error: msg })
    }
  }

  const handleSubmit = () => {
    if (!validation.config) return
    const params: CreateMcpParams | UpdateMcpParams = {
      name: name.trim(),
      description: description.trim(),
      config: validation.config,
      enabled,
    }
    onSave(params)
    onClose()
  }

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={isEdit ? '编辑 MCP' : '新建 MCP'}
      width="640px"
    >
      <div className="flex flex-col gap-4">
        {/* Name */}
        <FormField label="名称" required>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={formControlClassName}
            placeholder="例如：playwright"
          />
        </FormField>

        {/* Description */}
        <FormField label="描述">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className={`${formControlClassName} min-h-[60px] resize-y`}
            placeholder="MCP 用途描述（可选）"
          />
        </FormField>

        {/* Config JSON */}
        <FormField label="配置 JSON" required error={validation.error ?? undefined}>
          <textarea
            value={configText}
            onChange={(e) => setConfigText(e.target.value)}
            className={`${formControlClassName} min-h-[200px] resize-y font-mono text-xs ${
              validation.error
                ? 'border-error-300 focus:border-error-400'
                : validation.config
                  ? 'border-success-300 focus:border-success-400'
                  : ''
            }`}
            placeholder={DEFAULT_CONFIG_TEXT}
            spellCheck={false}
          />
          {validation.preview && !validation.error && (
            <span className="text-xs text-success-600 font-mono break-words">
              {validation.preview}
            </span>
          )}
        </FormField>

        {/* Test connectivity result */}
        {test.success !== undefined && !test.loading && (
          <div
            className={`px-3 py-2 rounded-lg text-xs border ${
              test.success
                ? 'bg-success-50 border-success-200 text-success-700'
                : 'bg-error-50 border-error-200 text-error-600'
            }`}
          >
            {test.success ? (
              <div className="flex flex-col gap-1">
                <span className="font-medium">
                  连接成功 · {test.tools?.length ?? 0} 个工具
                </span>
                {test.tools && test.tools.length > 0 && (
                  <span className="font-mono break-words">
                    {test.tools.join(', ')}
                  </span>
                )}
              </div>
            ) : (
              <span>连接失败：{test.error}</span>
            )}
          </div>
        )}

        {/* Enabled toggle */}
        <label className="flex items-center gap-2 text-sm text-text-primary cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="w-4 h-4"
          />
          <span>启用此 MCP</span>
        </label>

        {/* Actions */}
        <div className="flex justify-between gap-3 mt-2">
          <button
            onClick={handleTest}
            disabled={!validation.config || test.loading}
            className="px-4 py-2 text-sm text-text-primary bg-bg-secondary border border-border-base rounded-lg hover:bg-bg-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {test.loading ? '测试中...' : '测试连通'}
          </button>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-text-primary bg-bg-secondary border border-border-base rounded-lg hover:bg-bg-hover transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleSubmit}
              disabled={!canSave}
              className="px-4 py-2 text-sm bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors font-medium disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isEdit ? '保存' : '创建'}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
```

**关键变更说明：**
- 删除：`TRANSPORTS` 常量、`McpTransport`/`McpConfig` 中间态、`transport`/`command`/`argsText`/`envText`/`url` state、`argsToText`/`textToArgs`/`envToText`/`textToEnv` 辅助函数、transport 下拉与所有分传输字段 JSX、`buildConfig`/`validate` 中的分传输逻辑
- 新增：`configText` state、`validateConfigJson` 实时校验（`useMemo`）、`test` state + `handleTest`、JSON textarea + 红/绿边框 + 错误/预览、测试连通按钮 + 结果展示
- `CreateMcpParams`/`UpdateMcpParams` 不再区分（结构一致，统一构造）

- [ ] **Step 2: 类型检查 + lint**

Run: `pnpm --filter web typecheck`
Expected: PASS

Run: `pnpm --filter web lint`
Expected: PASS（无未使用变量、无类型错误）

- [ ] **Step 3: 运行全量测试确保无回归**

Run: `pnpm test`
Expected: PASS — 所有现有测试 + 新增测试全部通过

- [ ] **Step 4: 手动验证**

启动 `pnpm dev`，在浏览器打开 http://localhost:5173 → 侧边栏 MCPs → + 新建 MCP：

1. 粘贴合法 stdio JSON（如 placeholder 默认值）→ 应显示绿框 + 预览 `stdio · npx -y @playwright/mcp@latest`
2. 删除 `command` 字段 → 应显示红框 + 错误 `stdio 传输需要非空 command`，保存/测试按钮 disabled
3. 粘贴语法错误 JSON（如 `{transport:}`）→ 红框 + `JSON 语法错误：...`
4. 点"测试连通"（playwright MCP）→ 显示 `连接成功 · N 个工具` + 工具名列表
5. 填名称 → 点"创建" → 列表页出现新记录
6. 编辑刚创建的记录 → JSON 框回填正确 → 改 command 后保存 → 列表页更新

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/components/McpFormModal.tsx
git commit -m "feat(web): replace MCP form fields with JSON config textarea + live validation + connectivity test"
```

---

## 自审清单

### Spec 覆盖核对

| 设计文档章节 | 实现任务 | 状态 |
|-------------|---------|------|
| §1 JSON 格式定义（扁平 McpConfig） | Task 4 validateConfigJson 镜像规则 | ✓ |
| §2 UI 改造（字段变更） | Task 5 McpFormModal 重写 | ✓ |
| §3 实时校验规则（语法+结构） | Task 4 validateConfigJson + 测试 | ✓ |
| §4 测试连通接口 | Task 2 testConnection + Task 3 路由 | ✓ |
| §5.1 manager.testConnection | Task 2 | ✓ |
| §5.2 routes POST /test-config | Task 3 | ✓ |
| §6.1 McpFormModal 重构 | Task 5 | ✓ |
| §6.2 testMcpConfig API | Task 4 Part B | ✓ |
| §6.3 api/index.ts barrel | 无需改动（自动 `import *`）| ✓ 已修正设计文档 |
| §8 测试策略 | Task 1-4 含单测；Task 5 含手动验证 | ✓ |

### 类型一致性核对

- `testConnection` 签名：`(config: McpConfig, timeoutMs?: number) => Promise<{ success, tools, error? }>` —— Task 2 实现、Task 3 mock、设计文档 §5.1 一致 ✓
- `testMcpConfig` 签名：`(config: McpConfig) => Promise<TestMcpConfigResult>` —— Task 4 实现、Task 5 调用一致 ✓
- `validateConfigJson` 签名：`(text: string) => ConfigValidation` —— Task 4 实现 + 测试、Task 5 调用一致 ✓
- `TestMcpConfigResult`：`{ success: boolean; tools?: string[]; error?: string }` —— Task 1 定义贯穿全链 ✓

### 占位符扫描

无 TBD/TODO/"add error handling"/"similar to" 等占位符。所有代码步骤均含完整可执行代码。✓
