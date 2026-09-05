# MCP 配置 JSON 化设计

> **状态**：设计中
> **创建**：2026-08-10
> **关联**：MCP 管理页 `apps/web/src/views/settings/McpsPage.tsx`、表单组件 `apps/web/src/components/McpFormModal.tsx`

---

## 0. 背景与目标

### 0.1 问题

当前 MCP 新建/编辑采用**结构化表单**（`McpFormModal.tsx`）：用户需要分别填写 `transport` 下拉、`command` 输入框、`args` textarea（每行一个）、`env` textarea（`KEY=value` 每行一个）或 `url` 输入框。

这套表单存在以下体验问题：

1. **与 MCP 生态惯例不符** — MCP 配置在外部工具（Claude Desktop、Cursor、Cline、VSCode 等）和官方文档中普遍以 JSON 形式出现。用户从别处复制一段配置后，必须手工拆解成 command/args/env 三段分别粘贴，容易出错。
2. **args/env 的行分隔约定不透明** — 新手用户难以从 placeholder 猜出"每行一个"的规则，`env` 的 `KEY=value` 格式也无引导。
3. **无法整体粘贴/导出** — 没法把一条 MCP 配置作为完整 JSON 复制走或在版本库里管理。
4. **保存前无法验证连通** — 现有 `POST /api/mcps/:id/test` 要求先落库才能测试，用户若填错只能"保存→测试失败→编辑→再保存"反复。

### 0.2 目标

- **JSON 即配置**：用户在表单中直接粘贴 `McpConfig` JSON，系统校验语法与结构合法性作为**保存的唯一门禁**。
- **表单内测试连通**：提供"测试连通"按钮，在**不落库**的前提下临时连接 MCP Server、列出发现的工具，作为辅助验证手段（不阻塞保存）。
- **最小改动**：复用现有 `McpConfig` 类型、`validateMcpConfig` 校验、`trySynchronizeMcpTools` 同步逻辑，不改数据模型与已保存记录的兼容性。

### 0.3 非目标

- **不**支持 Claude Desktop 的 `{ "mcpServers": { ... } }` 包裹格式（本期仅扁平单 server 格式；多 server 批量导入留待后续）。
- **不**改动传输层实现 — `transport-factory.ts` 仍只支持 stdio，sse/http 在 JSON 中语法合法但测试连通会失败（错误透传，作为限制的自然反馈）。
- **不**改造 `McpsPage` 列表页（已保存记录的"测试并同步"、删除等操作不变）。
- **不**强制测试通过才能保存 — 测试连通是辅助功能，JSON 校验才是门禁。

### 0.4 业界参考

| 产品 | MCP 配置方式 | 借鉴点 |
|------|-------------|--------|
| Claude Desktop | 编辑 `claude_desktop_config.json`，`mcpServers` 包裹 | JSON 原生、可整体复制 |
| Cursor | Settings 面板内 JSON 编辑器 + "Test" 按钮 | 表单内即时测试 |
| Cline | JSON 文本框 + 解析预览 | 实时校验反馈 |

本方案采纳"扁平 JSON 文本框 + 实时校验 + 表单内测试"模型，对应 Cursor/Cline 的交互范式。

---

## 1. JSON 格式定义

### 1.1 格式：扁平单 server（直接对应 `McpConfig`）

JSON 文本框的内容是 `McpConfig` 类型的直接序列化，与 `packages/shared/src/mcp.ts:3` 完全对齐：

```typescript
interface McpConfig {
  transport: 'stdio' | 'sse' | 'http';
  command?: string;                    // stdio 必填
  args?: string[];
  env?: Record<string, string>;
  url?: string;                        // sse/http 必填
}
```

**stdio 示例**（playwright MCP）：

```json
{
  "transport": "stdio",
  "command": "npx",
  "args": ["-y", "@playwright/mcp@latest"],
  "env": {}
}
```

**sse/http 示例**（语法合法，但当前运行时测试会失败）：

```json
{
  "transport": "sse",
  "url": "https://example.com/sse"
}
```

### 1.2 为什么选扁平格式而非 Claude Desktop 格式

- **类型零迁移**：直接对应现有 `McpConfig`，无需新增解析层。
- **校验复用**：后端 `validateMcpConfig`（`routes/mcps.ts:27`）原样适用。
- **范围收敛**：一次只配一个 server，名称仍由用户在 JSON 外的 `name` 字段填写，语义清晰。
- 后续若需批量导入，可再扩展支持 `mcpServers` 包裹格式（见 §7 开放问题）。

---

## 2. UI 改造（`McpFormModal.tsx`）

### 2.1 字段变更

| 字段 | 现状 | 改造后 | 说明 |
|------|------|--------|------|
| `name` | 输入框 | **保留** | MCP 记录名称（元数据，不进 JSON） |
| `description` | textarea | **保留** | 描述（元数据） |
| `transport` | 下拉 | **删除** | 并入 JSON |
| `command` | 输入框 | **删除** | 并入 JSON |
| `args` | textarea（行分隔） | **删除** | 并入 JSON |
| `env` | textarea（`KEY=value`） | **删除** | 并入 JSON |
| `url` | 输入框 | **删除** | 并入 JSON |
| `config` JSON | — | **新增** | 大 textarea，承载 `McpConfig` |
| `enabled` | 开关 | **保留** | 启用开关（元数据） |
| 测试连通按钮 | — | **新增** | 表单内不落库测试 |

### 2.2 JSON 文本框

- 控件：`<textarea>`，monospace 字体，`min-h-[200px]`，`resize-y`
- Placeholder（stdio 示例）：
  ```json
  {
    "transport": "stdio",
    "command": "npx",
    "args": ["-y", "@playwright/mcp@latest"],
    "env": {}
  }
  ```
- 编辑模式：打开 modal 时回填 `JSON.stringify(mcp.config, null, 2)`

### 2.3 交互流程

```
用户粘贴 JSON
    │
    ▼
[实时校验 debounce 300ms]
    │
    ├─ JSON.parse 失败 ──► 红框 + 错误定位（行/列）
    ├─ 结构校验失败 ──► 红框 + 字段缺失提示
    │   （transport 合法？stdio 有 command？sse/http 有 url？）
    └─ 校验通过 ──► 绿框 + 摘要预览（如 "stdio · npx -y @playwright/mcp@latest"）
                        │
                        ├─ [测试连通] 按钮 ──► POST /api/mcps/test-config
                        │                      ├─ 成功：显示工具名列表
                        │                      └─ 失败：显示错误（不阻塞）
                        │
                        └─ [保存] 按钮 ──► POST /api/mcps 或 PATCH /api/mcps/:id
                                           （校验未过时 disabled）
```

### 2.4 状态管理

新增 state：

- `configText: string` — JSON 文本框内容
- `configError: string | null` — 校验错误信息（null 表示通过）
- `configPreview: string | null` — 校验通过后的摘要预览
- `testState: { loading, success?, tools?: string[], error? }` — 测试连通结果

删除 state：`transport`、`command`、`argsText`、`envText`、`url` 及对应的 `argsToText`/`textToArgs`/`envToText`/`textToEnv` 辅助函数（不再需要）。

---

## 3. 实时校验规则（前端）

校验分两层，debounce 约 300ms 后触发：

### 3.1 语法层

`JSON.parse(configText)`：
- 失败 → `configError = "JSON 语法错误：<native message>"`（如 `Unexpected token } in JSON at position 42`）
- 成功 → 进入结构层

### 3.2 结构层（镜像后端 `validateMcpConfig`）

解析出的对象按以下规则校验（与 `routes/mcps.ts:27-45` 一致）：

| 条件 | 错误信息 |
|------|---------|
| `transport` 不是 `stdio`/`sse`/`http` 之一 | `transport 必须是 stdio / sse / http 之一` |
| `transport === 'stdio'` 且 `command` 为空 | `stdio 传输需要非空 command` |
| `transport === 'sse' \| 'http'` 且 `url` 为空 | `${transport} 传输需要非空 url` |

### 3.3 摘要预览（校验通过时）

- stdio：`stdio · ${command} ${args.join(' ')}`（args 为空时省略）
- sse/http：`${transport} · ${url}`

### 3.4 门禁效果

- `configError !== null` 时，"测试连通"和"保存"按钮 `disabled`
- `name` 为空时，"保存"按钮 `disabled`（"测试连通"不受 name 影响，只看 JSON）

---

## 4. 测试连通接口（新增）

### 4.1 接口契约

```
POST /api/mcps/test-config
Content-Type: application/json

Request:
{
  "config": McpConfig
}

Response (success):
{
  "code": 0,
  "msg": "ok",
  "data": { "success": true, "tools": ["tool_a", "tool_b", ...] }
}

Response (failure — 连接/协议错误，非 4xx):
{
  "code": -1,
  "msg": "<error message>",
  "data": { "success": false, "error": "<error message>" }
}

Response (校验失败 — 4xx):
  → 走错误中间件，返回 400 + 错误信息
```

**关键设计**：
- **不落库**：不写入 `mcps` 表，不调用 `syncMcpTools`，不影响连接池
- **`tools` 返回工具名数组**（`string[]`），而非完整 `Tool[]` 对象 — 测试预览只需名称
- **连接失败返回 200 + `success: false`**（非 4xx/5xx）— 与现有 `POST /:id/test`（`routes/mcps.ts:114-136`）的风格一致，让前端用统一逻辑处理"测试失败"

### 4.2 路由注册位置

在 `routes/mcps.ts` 中，`POST /test-config` 注册在 `POST /`（创建）之后、`GET /:id` 之前。Hono 按注册顺序匹配，`/test-config` 是字面路径不会被 `/:id` 捕获（方法不同且路径层级不同，无冲突）。

### 4.3 类型定义（`packages/shared/src/mcp.ts` 新增）

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

---

## 5. 后端实现

### 5.1 `mcp/manager.ts` 新增 `testConnection`

新增导出函数，**独立于连接池**操作（不经过 `connections` Map）：

```typescript
/**
 * 临时连接测试：建立连接 → 列工具 → 立即关闭，不污染连接池。
 * 用于 POST /api/mcps/test-config（不落库的表单内测试）。
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

**设计要点**：
- 复用 `createTransport`、`safeClose`、`DEFAULT_TIMEOUT_MS`
- 用独立的 `Client` 实例，不写入 `connections` Map，测完即关
- `connect` / `listTools` 共享同一个超时（30s），覆盖进程启动慢、协议握手卡死等场景
- 不抛异常 — 失败信息进 `error` 字段返回（与现有 `/:id/test` 风格一致）

### 5.2 `routes/mcps.ts` 新增 `POST /test-config`

```typescript
mcpsApp.post('/test-config', async (c) => {
  const body = await c.req.json();
  validateMcpConfig(body.config);  // 复用现有校验，失败抛 400
  const result = await testConnection(body.config);
  return c.json({
    code: result.success ? 0 : -1,
    msg: result.success ? 'ok' : (result.error ?? '连接失败'),
    data: result,
  });
});
```

从 `../mcp/index.js` 增加 `testConnection` 导入。

### 5.3 不变项

- `validateMcpConfig`（`routes/mcps.ts:27`）原样复用
- `POST /`（创建）、`PATCH /:id`（更新）的 `trySynchronizeMcpTools` 行为不变
- `POST /:id/test`（已保存记录的测试并同步）不变
- `mcp/sync.ts`、`repo/mcp.ts`、`repo/tool.ts` 不变

---

## 6. 前端实现

### 6.1 `McpFormModal.tsx` 重构

**删除**：
- `TRANSPORTS` 常量、`transport`/`command`/`argsText`/`envText`/`url` state
- `argsToText`/`textToArgs`/`envToText`/`textToEnv` 辅助函数
- transport 下拉、command 输入、args/env textarea、url 输入的 JSX
- `validate`、`buildConfig` 中的分传输逻辑

**新增**：
- `configText`/`configError`/`configPreview`/`testState` state
- `validateConfigJson(text): { error: string | null; preview: string | null; config: McpConfig | null }` — 封装 §3 的两层校验
- `useEffect` 监听 `configText`，debounce 300ms 后调 `validateConfigJson` 更新 `configError`/`configPreview`
- JSON textarea JSX（带红/绿边框、错误提示行、摘要预览行）
- "测试连通"按钮：调 `api.testMcpConfig(config)`，结果写入 `testState`
- `handleSubmit`：从 `configText` 解析出 `McpConfig`，组装 `CreateMcpParams`/`UpdateMcpParams`

**保留**：`name`/`description`/`enabled` 字段、modal 外壳、编辑模式回填逻辑（回填 `JSON.stringify(mcp.config, null, 2)`）。

### 6.2 `api/real.ts` 新增 `testMcpConfig`

```typescript
/**
 * Test an MCP config without persisting (form-internal connectivity check)
 * POST /api/mcps/test-config
 */
export async function testMcpConfig(config: McpConfig): Promise<TestMcpConfigResult> {
    const response = await enhancedFetch<{
        data: TestMcpConfigResult;
    }>('/api/mcps/test-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config }),
        timeout: 45000,  // 留足 stdio 进程启动时间
    });
    return response.data;
}
```

从 `@my-copilot/shared` 增加 `TestMcpConfigParams`/`TestMcpConfigResult`、`McpConfig` 导入。

### 6.3 `api/index.ts` barrel

导出 `testMcpConfig`（遵循 AGENTS.md "Components import the API through `api/index.ts`" 约定）。

### 6.4 不变项

- `McpsPage.tsx` 列表页不改（已保存记录的测试仍走 `POST /:id/test`）
- `fetchMcps`/`createMcp`/`updateMcp`/`deleteMcp`/`testMcp` API 不变

---

## 7. 边界与已知限制

| 场景 | 行为 |
|------|------|
| JSON 里 `transport: 'sse'` 或 `'http'` | 语法合法可通过 JSON 校验；但点"测试连通"时 `createTransport` 会抛 `Unsupported MCP transport`，错误透传到 `testState.error` |
| 测试连通超时 | 30s（`DEFAULT_TIMEOUT_MS`），超时后 `testConnection` 返回 `success: false` + 超时错误信息 |
| 编辑模式改 JSON 后保存 | 后端 `PATCH /:id` 已有 `disconnect` 旧连接 + `trySynchronizeMcpTools` 重连逻辑（`routes/mcps.ts:89-94`），无需改 |
| JSON 含未知字段（如 `type`、`cwd`） | 当前忽略不报错（`validateMcpConfig` 只检查必要字段）。前端 `JSON.parse` 成功即通过，多余字段不影响 |
| 空的 `args: []` 或 `env: {}` | 合法，与 `undefined` 等价处理（`buildConfig` 现有逻辑已处理空数组/空对象） |

---

## 8. 测试策略

### 8.1 后端单测

- `apps/server/src/mcp/__tests__/manager.test.ts`：新增 `testConnection` 测试用例
  - stdio 成功路径（mock `createTransport` + Client）
  - 连接失败路径（command 不存在）
  - 超时路径
  - 验证不污染 `connections` pool（`getConnection('__test__')` 为空）
- `apps/server/test/routes/__tests__/mcps.test.ts`：新增 `POST /test-config` 测试
  - 校验失败返回 400（缺 transport、stdio 无 command）
  - 成功路径（mock `testConnection`）
  - 连接失败返回 200 + `success: false`

### 8.2 前端单测

- `McpFormModal` 组件测试（如已有测试文件则补充，否则遵循现有组件测试规范）
  - 粘贴非法 JSON → 红框 + 保存按钮 disabled
  - 粘贴合法 JSON → 绿框 + 摘要预览
  - 编辑模式回填正确序列化
  - 测试连通按钮调 `testMcpConfig`

### 8.3 共享类型测试

- `packages/shared/src/__tests__/mcp.test.ts`：新增 `TestMcpConfigParams`/`TestMcpConfigResult` 类型存在性断言

### 8.4 手动验证

- 添加 playwright MCP：粘贴示例 JSON → 绿框 → 点测试连通 → 看到 `browser_*`/`page_*` 工具名 → 保存 → 列表页可见
- 编辑现有 MCP：回填 JSON 正确 → 改 command 后保存 → 列表页 command 更新

---

## 9. 兼容性

- **已保存的 MCP 记录**：数据库 schema 不变（`mcps` 表、`McpConfig` JSON 列），现有记录完全兼容
- **现有 API**：`GET/POST/PATCH/DELETE /api/mcps`、`POST /:id/test`、`POST /:id/sync` 全部不变，仅**新增** `POST /test-config`
- **工具同步**：`syncMcpTools`、`repo/mcp.ts`、`repo/tool.ts` 不变
- **前端列表页**：`McpsPage.tsx` 不改

---

## 10. 开放问题

| 问题 | 当前决定 | 备注 |
|------|---------|------|
| 是否后续支持 Claude Desktop `mcpServers` 包裹格式（批量导入） | 暂不支持 | 扁平格式已满足单 server 配置需求；批量导入可作为后续增强 |
| 是否在 JSON 校验时拒绝未知字段（严格模式） | 宽松忽略 | 降低用户使用门槛；如 `cwd` 等字段当前无意义但不报错 |
| 测试连通是否暴露完整 `Tool[]`（含 `inputSchema`） | 仅返回工具名 | 表单预览只需名称；完整 schema 在保存后由同步逻辑落库 |

---

## 11. 涉及文件清单

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `packages/shared/src/mcp.ts` | 新增类型 | `TestMcpConfigParams`、`TestMcpConfigResult` |
| `packages/shared/src/__tests__/mcp.test.ts` | 新增测试 | 类型断言 |
| `apps/server/src/mcp/manager.ts` | 新增函数 | `testConnection` |
| `apps/server/src/mcp/__tests__/manager.test.ts` | 新增测试 | `testConnection` 用例 |
| `apps/server/src/routes/mcps.ts` | 新增路由 | `POST /test-config` |
| `apps/server/test/routes/__tests__/mcps.test.ts` | 新增测试 | 路由用例 |
| `apps/web/src/components/McpFormModal.tsx` | 重构 | 表单→JSON 文本框 |
| `apps/web/src/api/real.ts` | 新增函数 | `testMcpConfig` |
| `apps/web/src/api/index.ts` | 导出 | `testMcpConfig` |

预计净新增代码约 200 行，净删除约 120 行（移除表单字段及相关辅助函数）。
