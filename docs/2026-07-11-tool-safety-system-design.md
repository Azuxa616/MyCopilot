# Tool 安全级别系统设计

> **状态**：实现中
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

工具的**有效安全级别**（effective safety level）由多层配置叠加决定。各层均只能将级别提高；对外部来源先应用来源下限，再应用工具声明和 agent 覆盖：

```
effective = max(
  sourceFloor,                 // 外部 MCP 至少 restricted
  tool.safetyLevel,            // 工具自身默认级别
  agent_tools.safety_level,    // per-agent 覆盖；inherit 时忽略
)
```

无法解析到唯一、已启用的工具定义时，执行器必须返回错误，不能将 `fallback` 当作可执行工具的默认配置。`restricted` 仅用于动态发现工具在已确认来源后的保守下限。

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
| built-in（代码注册） | 由 `describe().safetyLevel` 声明 | 只能由应用代码提供执行实现 |
| MCP 自动同步入库 | `max(既有策略, restricted)` | Schema 和描述由 MCP Server 维护 |
| MCP 动态发现（同步前） | **默认 `restricted`** | 外部来源，不可信，需先同步来源 |

任何 MCP 工具（包括已入库的工具）都不能被表单或 API 标为 `safe`。如未来需要放行某个外部工具，必须通过独立的、可审计的管理员白名单，而不是修改工具声明。

---

## 2. Session 级确认缓存

### 2.1 缓存规则

当 `restricted` 工具被用户确认后，在**当前 session 内**对**相同工具和相同资源范围**的后续调用免确认。

- **缓存 key**：`sessionId + agentId + toolRef + policyVersion + resourceScope`；`toolRef` 必须包含工具 ID 和来源，不能只使用名称。**参数摘要（argumentsDigest）不进入缓存 key**，只落在 `ToolApproval` 审计记录上——否则每次参数都不同的查询型工具（如 context7 的 `resolve-library-id`）会退化为"每套参数确认一次"，与 UI 承诺"确认后本会话内将不再重复询问此工具"矛盾。
- **资源范围**：文件类工具使用规范化、受根目录约束的路径前缀；HTTP 工具使用规范化 origin；无法安全计算范围的工具按**整个工具**缓存确认（`resourceScope = 'tool'`），即会话内确认一次后同工具任意参数免确认（`danger` 级别不受此影响，仍每次确认）。
- **缓存生命周期**：仅保存在运行时内存，进程重启后失效并重新确认；另设显式“撤销本会话授权”和固定闲置 TTL。当前 `sessions` 是持久化会话记录，不能把“session 结束”当作已有的生命周期事件。
- **失效条件**：工具禁用、工具/Agent/MCP 配置变化、策略版本变化、用户停止运行或删除会话时，必须清除相应缓存。
- **缓存范围**：仅 `restricted` 级别工具；`safe` 不需要缓存（永远免确认）；`danger` 不缓存（每次确认）

### 2.2 首版必须满足的资源约束

不能采用仅按工具名缓存的粒度 A。用户确认 `list_directory('/home/user/docs')` 后，`list_directory('/etc')` 必须重新确认；否则 `restricted` 文件工具会被一次授权扩大为任意本地读取。

1. 路径参数先进行解析、符号链接检查和允许根目录校验，再生成资源前缀；解析失败时拒绝执行。
2. 无法定义资源范围的受限操作（例如带任意参数的第三方查询）按整个工具缓存确认（`resourceScope = 'tool'`）：会话内确认一次后，同工具的不同参数调用免确认。**修订说明**（2026-08-16）：首版曾规定此类操作按每次确认处理，但实践证明查询型 MCP 工具在 agent loop 的每一轮都会弹出确认框（每次调用参数几乎必然不同），确认疲劳反而削弱安全性；且这与确认对话框承诺的"本会话内不再重复询问此工具"直接矛盾。有明确资源边界的工具（path/origin）仍保持按范围的细粒度缓存，粒度 A 的风险（一次授权扩大为任意本地读取）不受影响。
3. 不同 agent、不同 MCP 来源和不同策略版本不得共享授权；参数摘要只用于 `ToolApproval` 审计与防重放校验，不作为缓存隔离维度。

### 2.3 预留升级路径

未来可按工具能力升级为更细的资源范围、参数模式或用户自定义授权策略：

```ts
type ConfirmationCacheKey = {
  sessionId: string;
  agentId: string;
  toolId: string;
  sourceMcpId?: string;
  policyVersion: string;
  resourceScope: string;
};
```

数据模型设计时需考虑这一点；资源范围是首版安全边界，不是后续可选优化。

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

### 3.5 per-agent 运行时接入

`agent_tools` 新增字段本身不足以形成 per-agent 安全边界。当前会话、`runAgentLoop`、`ToolExecutionContext` 和异步 job payload 均未携带 `agentId`；实现时必须将其作为同一条不可丢失的运行时上下文传递：

```
会话选择的 agentId
  → enabled tools 过滤 + agent_tools 覆盖读取
  → RunAgentLoopParams / ToolExecutionContext
  → PendingToolApproval / ConfirmationCacheKey
  → 异步 job payload 与恢复检查点
```

- 没有选定自定义 agent 时使用显式的默认 agent ID，而不是省略该字段；这样默认路径与 Phase 3 路径共享同一安全检查。
- 更新工具默认级别时，必须同时校验所有既有 `agent_tools` 覆盖仍符合“只能加严”规则；不能只在创建或更新 binding 时校验。
- 修改 agent 的工具绑定、MCP 绑定或策略时必须递增对应策略版本，并使未执行的待确认记录与 session 缓存失效。

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
  1. 解析唯一工具身份（built-in / DB / MCP 动态）并验证已启用
  2. 计算 effective safety level（来源下限 → tool default → agent override）
  3. 根据 safety level 执行安全检查:
     - safe → 直接执行
     - restricted → 查具备资源范围的 session 确认缓存 → 命中则直接执行，未命中则创建待确认记录
     - danger → 始终创建待确认记录
  4. 执行工具（built-in executor / MCP route）
```

### 4.3 工具身份与路由约束

当前执行器以 `toolCall.name` 路由，内置工具优先、DB 工具按名称查找、MCP 会逐个尝试调用。该行为不能作为安全系统的基础：同名工具可能命中错误来源，确认缓存也会串用。

执行前必须将模型传来的名称解析为不可歧义的 `ToolRef`：

```ts
interface ToolRef {
  id: string;
  advertisedName: string; // 给 LLM 的唯一名称
  source: 'built-in' | 'db' | 'mcp';
  sourceMcpId?: string;
  policyVersion: string;
}
```

- 广告给 LLM 的名称在一次运行内必须唯一；同名 MCP 工具需使用稳定的来源前缀或别名。
- DB 工具必须按 `id` 解析；MCP 工具必须按 `sourceMcpId` 精确路由，禁止“依次尝试所有 MCP”。
- 工具禁用、MCP 断连、工具定义或策略版本变化后，旧 `ToolRef` 与旧缓存均不可继续执行。

### 4.4 确认记录、令牌与取消

确认不是由模型调用 ID 直接授权。服务端在每次需要确认时生成不可预测的 `approvalId`，并将下列记录持久化或在同步模式中至少保留到请求结束：

```ts
interface PendingToolApproval {
  approvalId: string;
  runId: string;
  sessionId: string;
  agentId: string;
  tool: ToolRef;
  argumentsDigest: string;
  resourceScope: string;
  safetyLevel: SafetyLevel;
  policyVersion: string;
  expiresAt: number;
  state: 'pending' | 'approved' | 'rejected' | 'expired' | 'cancelled';
}
```

- 确认 API 只接受 `approvalId`；服务端必须校验发起确认的用户拥有该会话和运行。当前项目使用单一 token，进入多用户模式前必须补充会话所有者模型；不得将 LLM 返回的 `toolCall.id` 或可猜测的 `sessionId` 作为授权令牌。
- 服务端在等待前校验参数摘要、资源范围和策略版本；确认后的任何不一致都作废并重新请求确认。
- `waitForConfirmation` 必须接收 `AbortSignal`。用户停止、SSE 断开、会话删除、超时或进程关闭时应取消待确认记录并解析为拒绝，不能继续占用 agent loop 或 worker。
- 同一次 `approvalId` 只能结算一次；所有允许、拒绝、超时、取消和实际执行结果均需写入审计日志。

### 4.5 Session 确认缓存设计

```ts
// in-memory, session-scoped
// key: stable hash of ConfirmationCacheKey
const sessionConfirmations = new Map<string, true>();

function isConfirmedThisSession(key: ConfirmationCacheKey): boolean {
  return sessionConfirmations.has(hashConfirmationCacheKey(key)) === true;
}

function markConfirmed(key: ConfirmationCacheKey): void {
  sessionConfirmations.set(hashConfirmationCacheKey(key), true);
}

function clearSessionConfirmations(sessionId: string): void {
  for (const key of sessionConfirmations.keys()) {
    if (keyBelongsToSession(key, sessionId)) {
      sessionConfirmations.delete(key);
    }
  }
}
```

**生命周期**：进程重启、会话删除、停止运行、授权撤销、闲置 TTL 和策略变更均会使缓存失效。实现不能依赖当前不存在的“session 关闭”事件。

---

## 5. 内置工具默认安全级别

### 5.1 已有内置工具

| 工具 | 默认级别 | 理由 |
|------|---------|------|
| `web_search` | `safe` | 只读搜索，无副作用 |
| `http_fetch` | `restricted` | 可访问任意网络目标；首版必须确认，且现有 SSRF 防护不足以支持自动执行 |

`http_fetch` 只有在完成以下条件后才可重新评估为 `safe`：对 DNS 解析出的全部 IPv4/IPv6 地址和每次重定向目标实施私网、回环、链路本地和云元数据地址拦截；禁止 DNS rebinding；并在部署层设置出站网络策略。仅检查原始 URL hostname 和响应大小不是充分的 SSRF 防护。

### 5.2 计划新增的只读内置工具

| 工具 | 默认级别 | 理由 |
|------|---------|------|
| `current_datetime` | `safe` | 纯生成，零副作用 |
| `calculator` | `safe` | 纯计算，零副作用 |
| `generate_uuid` | `safe` | 纯生成，零副作用 |
| `hash_text` | `safe` | 纯计算，零副作用 |
| `base64_encode` / `base64_decode` | `safe` | 纯编码转换 |
| `json_format` | `safe` | 纯文本处理 |
| `url_metadata` | `restricted` | 与 `http_fetch` 相同的网络边界，不能因返回更少内容而自动执行 |

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

### 6.1 工具来源与管理界面

工具管理页面不提供“新建 Tool”或直接删除功能。工具只有两个受信来源：

1. **built-in**：开发者实现 `ToolExecutor` 并在服务启动时注册；界面只读展示，不能编辑、禁用或删除。
2. **MCP-provided**：创建、更新或测试 MCP 连接时自动发现并同步。名称、描述、Schema 和来源只读；界面只允许启用/禁用，以及把安全级别从 `restricted` 提高到 `danger`。

MCP 同步采用幂等 upsert：新工具默认 `restricted`，再次同步更新描述和 Schema、保留用户设置的更严格级别；远端已删除的工具自动禁用；删除 MCP 来源时清理其工具记录和 agent bindings。

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

确认事件不是 LLM adapter 的 `StreamEvent`，而是 agent loop 的运行时事件。新增 `AgentLoopEvent` 分支，并复用现有 SSE `confirmation_required` 事件名：

```ts
// apps/server/src/agent-loop/runner.ts
| {
    type: 'tool_confirmation_required';
    approval: PendingToolApproval;
    toolCall: ToolCall;
  }

// SSE payload（apps/server/src/streaming/sse-protocol.ts）
{
  approvalId: string;
  messageId: string;
  toolCallId: string;
  toolName: string;
  arguments: string;
  safetyLevel: SafetyLevel;
  expiresAt: number;
}
```

执行器必须先创建待确认记录，再经 `runner → lifecycle → SSE` 发送事件，最后等待结算；不能在 executor 内直接阻塞而不通知 runner。前端收到事件后展示工具来源、资源范围、参数和过期时间，用户选择后调用 `POST /api/tools/confirm/:approvalId`。前端仅持有 `approvalId`，服务端负责会话归属与参数一致性校验。

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

### 7.4 同步与异步运行语义

同步 SSE 和 `AGENT_ASYNC_MODE=true` 必须使用同一份确认状态机，不能仅复用 `executeToolCall` 的阻塞等待逻辑。

- **同步模式**：创建待确认记录后立即发送 SSE 事件；等待过程必须响应 abort，并在连接断开时取消。
- **异步模式**：job 进入 `waiting_confirmation` 状态并持久化待确认记录，前端可通过 job 查询或 job SSE 立即获取事件；批准或拒绝后从保存的检查点继续，而不是从头重新运行整个 agent loop。
- **重启与重试**：进程重启后，未结算确认必须过期或恢复为待确认，绝不能自动批准。已经开始的外部副作用调用不能盲目重试；调用要携带持久化的 idempotency key，并保存结果。无法保证幂等的危险 MCP 工具在不确定结果时应标记为“需要人工核验”，而非自动再次执行。
- **并行调用**：一个 LLM 回合中的每个工具调用拥有独立 `approvalId` 和执行状态；一个工具被拒绝不应错误批准或取消其他工具调用，除非用户显式停止整次运行。

### 7.5 迁移和运行时校验

- SQL 文件应位于 `apps/server/src/migration/sql/0003_tool_safety_redesign.sql`，并沿用项目的 migration runner 事务机制。
- `safety_level` 的 CHECK 约束、API 输入校验和 repo 写入校验必须同时存在；TypeScript 类型不能替代运行时校验。
- 迁移时保留 `source_mcp_id`，为现有工具计算初始 `policyVersion`；新字段和确认记录需建立按 `session_id`、`run_id`、`expires_at` 查询的索引。
- API 更新工具、MCP 或 agent 后，应在同一事务或同一临界区中使相关缓存和待确认记录失效，避免“确认后策略被升级但仍执行旧请求”的竞态。

---

## 8. 实现计划

### 8.1 实施状态

本文档对应实现已启动。内置工具只读注册、MCP 自动同步、安全级别迁移和确认链路按下表推进；文档继续作为验收标准。

### 8.2 实现时的任务拆分（参考）

| 任务 | 涉及文件 | 说明 |
|------|---------|------|
| Migration SQL | `apps/server/src/migration/sql/0003_*.sql` | 表重建、数据迁移、策略版本和待确认记录 |
| Shared 类型更新 | `packages/shared/src/tool.ts`, `agent.ts` | `DangerLevel` → `SafetyLevel` |
| Repo 更新 | `repo/tool.ts`, `repo/agent.ts` | 字段改名、来源下限、策略版本及所有写路径校验 |
| 确认状态机 | `tools/confirmation.ts` | approvalId、过期、取消、审计和资源范围缓存 |
| Executor 统一路径 | `tools/executor.ts` | 唯一 ToolRef 解析、精确 MCP 路由、三来源统一安全检查 |
| Agent runtime 接入 | `streaming/`, `agent-loop/`, `jobs/` | 传递 agentId、暂停/恢复异步 job、处理重启与中止 |
| SSE 与前端确认 | `streaming/`, `ChatShell/` | 发送 approvalId、展示来源/范围、确认与撤销 UI |
| 安全测试 | server/web tests | 路由冲突、缓存范围、取消、并行、重启、策略失效与 sync/async E2E |

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
| 确认缓存粒度 | 工具身份 + agent + 策略版本 + 资源范围 | 防止一次确认扩大到其他来源或敏感资源 | 2026-07-11 |
| 确认令牌 | 服务端随机 `approvalId` | 禁止将模型 call ID 或 session ID 当作授权凭据 | 2026-07-11 |
| 异步任务确认 | 持久化暂停/恢复 | 避免后台 worker 阻塞、重启重复调用或丢失确认 | 2026-07-11 |
| `http_fetch` 初始级别 | `restricted` | 现有 SSRF 防护不足以支持自动执行 | 2026-07-11 |
