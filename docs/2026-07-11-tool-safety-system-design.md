# Tool 安全级别系统设计

> **状态**：设计阶段，待实现
> **创建**：2026-07-11
> **关联**：Phase 2 Agent 能力升级，为 Phase 3 自定义 Agent 预留

---

## 0. 背景与目标

### 0.1 问题

当前系统（Phase 2 产出）存在以下安全缺陷：

1. **三级危险度语义模糊** — `DangerLevel = 'low' | 'medium' | 'high'`，但实际只有 `high` 触发用户确认，`low` 与 `medium` 行为完全相同。用户配置时无从判断该选哪个。
2. **built-in 工具绕过安全检查** — `executor.ts` 中 built-in 工具直接执行，不经过 `dangerLevel` 判断。未来若内置 `http_fetch`、`execute_command` 等高风险工具，将存在安全漏洞。
3. **无"确认后免确认"机制** — 受限工具每次调用都需要确认，用户疲劳。当前仅有 `danger === 'high'` 的同步阻塞确认，无 session 级别缓存。
4. **MCP 动态工具无安全门禁** — 动态发现的 MCP 工具（未入库）直接执行，完全无安全检查。
5. **per-agent 安全级别无法覆盖** — `agent_tools` 表是纯 junction（`agent_id + tool_id`），同一工具在不同 agent 中只能是启用/禁用，无法设定不同安全级别。

### 0.2 目标

设计一套三组安全级别系统，满足：

- **明确语义**：每个级别对应明确的行为，用户一看就懂
- **统一执行路径**：built-in / DB / MCP 动态工具走同一套安全检查
- **per-agent 可覆盖**：同一工具在不同 agent 下可有不同安全级别
- **可扩展**：为 Phase 3 自定义 Agent 预留配置空间，当前阶段零运行时开销

### 0.3 业界参考

| 产品/框架 | 安全模型 | 借鉴点 |
|-----------|---------|--------|
| Claude Code | 六种权限模式（default/dontAsk/acceptEdits/bypassPermissions/plan/auto） | 会话级确认缓存 |
| GitHub Copilot | 沙箱 + 三种批准选项（单次/会话内/永不批准） | session 级别缓存粒度 |
| Cursor | 权限令牌（Read/Write/Shell）+ glob 模式匹配 | 资源前缀粒度控制 |
| Cline | 工具策略（autoApprove/manual/disable）+ 条件批准 | per-tool 独立策略 |

本方案采纳"三组分级 + session 级缓存 + per-agent 覆盖"模型，对应业界主流实践。

---

## 1. 三组安全级别定义

### 1.1 级别定义

| 级别 | 名称 | 行为 | 典型工具 |
|------|------|------|---------|
| `safe` | 安全 | **自动执行，无需用户确认** | `web_search`、`http_fetch`、`current_datetime`、`calculator` |
| `restricted` | 受限 | **首次调用需用户确认，确认后本 session 内同一工具免确认** | `list_directory`、`read_file`、`github_create_issue`、`slack_post_message` |
| `danger` | 危险 | **每次调用都需要用户确认** | `delete_file`、`execute_command`、`github_delete_repo` |

### 1.2 级别判定优先级

工具的**有效安全级别**（effective safety level）由多层配置叠加决定，优先级从高到低：

```
1. agent_tools.safety_level（per-agent 覆盖，如果 != 'inherit'）
2. tool.safetyLevel（tool 自身声明的默认级别）
3. fallback 'restricted'（未找到工具定义时的兜底）
```

### 1.3 安全约束：只能往更严格覆盖

agent 对 tool 的安全级别覆盖**只能往更严格的方向**，不能放松：

```
tool 默认级别 → agent 可覆盖为
─────────────────────────────────
safe          → safe（无变化，无意义但允许）
restricted    → restricted（无变化）、danger（更严格 ✅）
danger        → danger（无变化）
```

**禁止的覆盖**：
- tool 默认 `restricted` → agent 覆盖为 `safe` ❌（放松限制）
- tool 默认 `danger` → agent 覆盖为 `safe` 或 `restricted` ❌（放松限制）

**设计理由**：内置工具的默认安全级别是开发者基于工具能力做出的判断，是安全底线。自定义 agent 的使用者不应能绕过这个底线。如果工具作者认为 `execute_command` 是 `danger`，没有任何理由让某个 agent 把它变成 `safe`。

### 1.4 动态发现工具的默认级别

| 来源 | 默认级别 | 理由 |
|------|---------|------|
| built-in（代码注册） | 由 `describe().safetyLevel` 声明 | 开发者最了解工具能力 |
| DB 注册（用户创建的 tool） | 由用户在创建时指定 | 用户自担风险 |
| DB 注册（MCP-provided） | 由用户在创建时指定 | 用户自担风险 |
| MCP 动态发现（未入库） | **默认 `restricted`** | 外部来源，不可信，需首次确认 |

---

## 2. Session 级确认缓存

### 2.1 缓存规则

当 `restricted` 工具被用户确认后，在**当前 session 内**对**同一 tool**的后续调用免确认。

- **缓存 key**：`sessionId + toolName`（粒度 A，按工具名）
- **缓存生命周期**：session 结束即清除（in-memory，不持久化）
- **缓存范围**：仅 `restricted` 级别工具；`safe` 不需要缓存（永远免确认）；`danger` 不缓存（每次确认）

### 2.2 当前阶段限制（接受）

粒度 A（按工具名）意味着用户确认了 `list_directory('/home/user/docs')` 后，`list_directory('/etc')` 也免确认。这在当前阶段可接受，原因：

1. 当前是默认 agent（不可配置），无恶意工具注入风险
2. `restricted` 工具本身是"受限但有界"的操作（非删除/破坏性）
3. 实现简单，零额外配置

### 2.3 预留升级路径

未来可升级到粒度 B（工具名 + 资源前缀）：

```ts
// 未来可能的缓存 key（不实现，仅预留设计空间）
type ConfirmationCacheKey =
  | { toolName: string }                          // 粒度 A（当前）
  | { toolName: string; resourcePrefix: string }  // 粒度 B（未来）
```

数据模型设计时需考虑这一点，但当前不实现粒度 B 逻辑。

---

## 3. 数据模型

### 3.1 类型定义变更（`packages/shared/src/tool.ts`）

```ts
// ── 替换 ──
// 旧: export type DangerLevel = 'low' | 'medium' | 'high';
// 新:
export type SafetyLevel = 'safe' | 'restricted' | 'danger';

export interface Tool {
  id: string;
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
  type: ToolType;
  safetyLevel: SafetyLevel;        // 改名: dangerLevel → safetyLevel
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface CreateToolParams {
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
  type: ToolType;
  safetyLevel: SafetyLevel;        // 改名
  enabled?: boolean;
}

export interface UpdateToolParams {
  name?: string;
  description?: string;
  inputSchema?: ToolInputSchema;
  type?: ToolType;
  safetyLevel?: SafetyLevel;       // 改名
  enabled?: boolean;
}
```

### 3.2 per-agent 覆盖类型（`packages/shared/src/agent.ts`）

```ts
// agent_tools.safety_level 的运行时类型
export type AgentToolSafetyOverride = SafetyLevel | 'inherit';

export interface AgentToolBinding {
  agentId: string;
  toolId: string;
  safetyLevel: AgentToolSafetyOverride;
}
```

### 3.3 数据库 Schema 变更

#### Migration: `0003_tool_safety_redesign.sql`

```sql
-- 1. tools 表: danger_level 列改名为 safety_level，值域变更
--    SQLite 无法直接改 CHECK 约束，需要表重建

CREATE TABLE tools_new (
  id            TEXT PRIMARY KEY NOT NULL,
  name          TEXT NOT NULL,
  description   TEXT NOT NULL,
  input_schema  TEXT NOT NULL,
  type          TEXT NOT NULL CHECK (type IN ('built-in', 'mcp-provided')),
  safety_level  TEXT NOT NULL DEFAULT 'safe'
                CHECK (safety_level IN ('safe', 'restricted', 'danger')),
  source_mcp_id TEXT,
  enabled       INTEGER NOT NULL DEFAULT 1,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

-- 迁移数据: low→safe, medium→restricted, high→danger
INSERT INTO tools_new (id, name, description, input_schema, type, safety_level, source_mcp_id, enabled, created_at, updated_at)
SELECT
  id, name, description, input_schema, type,
  CASE danger_level
    WHEN 'low'    THEN 'safe'
    WHEN 'medium' THEN 'restricted'
    WHEN 'high'   THEN 'danger'
  END,
  source_mcp_id, enabled, created_at, updated_at
FROM tools;

DROP TABLE tools;
ALTER TABLE tools_new RENAME TO tools;

-- 2. agent_tools 表: 新增 safety_level 列
--    当前是纯 junction 表，需要重建
CREATE TABLE agent_tools_new (
  agent_id     TEXT NOT NULL,
  tool_id      TEXT NOT NULL,
  safety_level TEXT NOT NULL DEFAULT 'inherit'
               CHECK (safety_level IN ('safe', 'restricted', 'danger', 'inherit')),
  PRIMARY KEY (agent_id, tool_id)
);

-- 迁存现有数据（全部为 inherit）
INSERT INTO agent_tools_new (agent_id, tool_id, safety_level)
SELECT agent_id, tool_id, 'inherit' FROM agent_tools;

DROP TABLE agent_tools;
ALTER TABLE agent_tools_new RENAME TO agent_tools;
```

### 3.4 安全约束验证（应用层）

在 `repo/tool.ts` 或 `repo/agent.ts` 的写入路径中增加校验：

```ts
/**
 * 验证 agent 对 tool 的安全级别覆盖是否合法。
 * 规则：覆盖级别只能比 tool 默认级别更严格，不能更宽松。
 *
 * 严格度排序: safe < restricted < danger
 */
const STRICTNESS: Record<SafetyLevel, number> = {
  safe: 0,
  restricted: 1,
  danger: 2,
};

export function assertValidOverride(
  toolDefault: SafetyLevel,
  override: SafetyLevel,
): void {
  if (STRICTNESS[override] < STRICTNESS[toolDefault]) {
    throw new Error(
      `Cannot override tool safety level from '${toolDefault}' to '${override}' ` +
      `(override must be equally or more strict, not less)`,
    );
  }
}
```

---

## 4. 统一执行路径

### 4.1 当前问题

```
当前 executor.ts 流程:
  1. built-in → 直接执行（无安全检查）❌
  2. DB tool → 仅检查 dangerLevel === 'high' → 确认
  3. MCP 动态 → 直接执行（无安全检查）❌
```

### 4.2 目标流程

```
统一后的 executor.ts 流程:
  1. 解析工具定义（built-in / DB / MCP 动态）
  2. 计算 effective safety level（agent override → tool default → fallback）
  3. 根据 safety level 执行安全检查:
     - safe → 直接执行
     - restricted → 查 session 确认缓存 → 命中则直接执行，未命中则等待确认
     - danger → 始终等待确认
  4. 执行工具（built-in executor / MCP route）
```

### 4.3 Session 确认缓存设计

```ts
// in-memory, session-scoped
// key: `${sessionId}:${toolName}`
const sessionConfirmations = new Map<string, true>();

function isConfirmedThisSession(sessionId: string, toolName: string): boolean {
  return sessionConfirmations.has(`${sessionId}:${toolName}`) === true;
}

function markConfirmed(sessionId: string, toolName: string): void {
  sessionConfirmations.set(`${sessionId}:${toolName}`, true);
}

function clearSessionConfirmations(sessionId: string): void {
  for (const key of sessionConfirmations.keys()) {
    if (key.startsWith(`${sessionId}:`)) {
      sessionConfirmations.delete(key);
    }
  }
}
```

**生命周期**：session 关闭或超时时清除（由 session 生命周期管理触发）。

---

## 5. 内置工具默认安全级别

### 5.1 已有内置工具

| 工具 | 默认级别 | 理由 |
|------|---------|------|
| `web_search` | `safe` | 只读搜索，无副作用 |
| `http_fetch` | `safe` | 只读 HTTP 请求（已有 SSRF 防护 + 5MB 限制） |

### 5.2 计划新增的只读内置工具

| 工具 | 默认级别 | 理由 |
|------|---------|------|
| `current_datetime` | `safe` | 纯生成，零副作用 |
| `calculator` | `safe` | 纯计算，零副作用 |
| `generate_uuid` | `safe` | 纯生成，零副作用 |
| `hash_text` | `safe` | 纯计算，零副作用 |
| `base64_encode` / `base64_decode` | `safe` | 纯编码转换 |
| `json_format` | `safe` | 纯文本处理 |
| `url_metadata` | `safe` | 只读 HTTP（轻量版 http_fetch） |

### 5.3 未来可能的高风险内置工具

| 工具 | 默认级别 | 理由 |
|------|---------|------|
| `list_directory` | `restricted` | 读取文件系统（需用户知晓） |
| `read_file` | `restricted` | 读取文件内容（隐私敏感） |
| `write_file` | `restricted` | 写入文件（有副作用但可恢复） |
| `delete_file` | `danger` | 删除文件（不可恢复） |
| `execute_command` | `danger` | 执行系统命令（最高风险） |

> 注意：当前阶段不加文件系统工具，但此处明确未来加入时的安全级别。

---

## 6. 前端交互设计

### 6.1 工具创建/编辑表单

工具管理页面（ToolsPage）的安全级别选择器：

- 显示为三个选项的单选按钮组：
  - 🟢 **安全（自动执行）**：适合纯查询、搜索类工具
  - 🟡 **受限（首次确认）**：适合读写文件、修改资源的工具
  - 🔴 **危险（每次确认）**：适合删除文件、执行命令等不可逆操作
- 每个选项附带说明文字，帮助用户理解

### 6.2 对话中的确认交互

当 agent loop 遇到需要确认的工具调用时：

**restricted 工具首次确认**：
```
┌─────────────────────────────────────────────┐
│  🔧 Agent 想要使用工具: list_directory       │
│  参数: { "path": "/home/user/docs" }        │
│                                              │
│  ⚠️ 这是受限工具，需要您确认                  │
│  确认后本会话内将不再重复询问此工具            │
│                                              │
│  [允许]  [拒绝]                              │
└─────────────────────────────────────────────┘
```

**danger 工具每次确认**：
```
┌─────────────────────────────────────────────┐
│  🔴 Agent 想要使用工具: delete_file          │
│  参数: { "path": "/home/user/temp/old.log" }│
│                                              │
│  ⚠️ 这是危险操作，每次执行都需要确认          │
│                                              │
│  [允许]  [拒绝]                              │
└─────────────────────────────────────────────┘
```

### 6.3 SSE 事件流

新增 StreamEvent 类型用于通知前端需要确认：

```ts
// 新增事件类型（packages/shared/src/stream-event.ts）
| { type: 'tool_confirmation_required'; toolCall: ToolCall; safetyLevel: SafetyLevel }
```

前端收到此事件后渲染确认弹窗，用户选择后调用 `/api/tools/confirm/:callId`。

---

## 7. 向后兼容

### 7.1 数据迁移

- `DangerLevel` 旧值自动映射：`low → safe`、`medium → restricted`、`high → danger`
- 迁移通过 migration SQL 完成，无数据丢失

### 7.2 API 兼容

- `dangerLevel` 字段改名为 `safetyLevel`，是 **breaking change**
- 由于当前所有消费者都是内部代码（无外部 API 客户端），改名安全
- 前端 API client 需同步更新字段名

### 7.3 内置工具注册

built-in 工具的 `describe()` 方法需要从返回 `dangerLevel` 改为返回 `safetyLevel`，值域从 `'low'|'medium'|'high'` 改为 `'safe'|'restricted'|'danger'`。

---

## 8. 实现计划

### 8.1 不在本阶段实现

本文档是**设计文档**，不包含代码改动。实现将在后续任务中进行。

### 8.2 实现时的任务拆分（参考）

| 任务 | 涉及文件 | 说明 |
|------|---------|------|
| Migration SQL | `migration/sql/0003_*.sql` | 表重建 + 数据迁移 |
| Shared 类型更新 | `packages/shared/src/tool.ts`, `agent.ts` | `DangerLevel` → `SafetyLevel` |
| Repo 更新 | `repo/tool.ts` | 字段改名 |
| 确认缓存 | `tools/confirmation.ts` | 新增 session 级缓存 |
| Executor 统一路径 | `tools/executor.ts` | 三来源统一安全检查 |
| Agent override 校验 | `repo/tool.ts` 或 `repo/agent.ts` | `assertValidOverride` |
| 前端工具表单 | `ToolsPage.tsx` | 安全级别选择器更新 |
| 前端确认弹窗 | `ChatShell/` | 确认 UI 组件 |

---

## 9. 决策记录

| 决策 | 选择 | 理由 | 日期 |
|------|------|------|------|
| 级别数量 | 3 组（safe/restricted/danger） | 语义清晰，覆盖完整 | 2026-07-11 |
| restricted 缓存粒度 | 粒度 A（按工具名） | 当前阶段简单优先，预留升级 | 2026-07-11 |
| per-agent 覆盖方向 | 只能往更严格 | 防止自定义 agent 绕过安全底线 | 2026-07-11 |
| MCP 动态工具默认级别 | `restricted` | 外部来源不可信 | 2026-07-11 |
| built-in 统一安全检查 | 是 | 消除安全绕过漏洞 | 2026-07-11 |
| 字段命名 | `safetyLevel`（非 `dangerLevel`） | 语义更正向，避免"danger=0 是最安全还是最危险"的歧义 | 2026-07-11 |
