# Current State Baseline - Code Assumptions Verification

验证日期: 2026-08-01

## 1. "同工具 >3 次防死循环"机制

**假设描述**: 防死循环机制使用硬编码常量 3，计数方式是 per-run 还是 per-session？

**验证方法**: 读取 `apps/server/src/agent-loop/runner.ts`，搜索 MAX_SAME_TOOL_CALLS 和 toolCallCounts

**真实结果**:

- **硬编码常量**: `MAX_SAME_TOOL_CALLS = 3` 定义于 `apps/server/src/agent-loop/runner.ts:265`
- **计数方式**: **per-run**。`toolCallCounts` Map 在 `runAgentLoop` 函数内部初始化（`apps/server/src/agent-loop/runner.ts:264`），每次 agent run 都会重新创建
- **触发逻辑**: 第 441-461 行，当某个工具调用次数 >= 3 时，插入系统消息并清空计数器

**对 RFC 的影响**:

- **正确性**: 假设部分正确 - 确实是硬编码 3，但是 per-run 而非 per-session
- **T2 (工具策略)**: 如果需要更细粒度的控制（如 per-session 限流或可配置阈值），需要引入新的状态管理机制
- **T7 (MCP)**: 当前机制适用于所有工具类型（built-in 和 MCP），无需差异化处理

---

## 2. 3 级安全策略 (safe/restricted/danger)

**假设描述**: `danger` 是否是独立的安全等级，还是仅仅是 `restricted + require_confirmation`？

**验证方法**: 读取 `apps/server/src/tools/executor.ts`，搜索 STRICTNESS 映射和 confirmation 逻辑

**真实结果**:

- **独立等级**: `danger` 是独立的安全等级，`apps/server/src/tools/executor.ts:25-29` 定义了 STRICTNESS 映射

  ```typescript
  const STRICTNESS: Record<SafetyLevel, number> = {
    safe: 0,
    restricted: 1,
    danger: 2,
  };
  ```

- **触发分支**: `apps/server/src/tools/executor.ts:61-63`

  ```typescript
  const needsConfirmation =
    safetyLevel === 'danger' ||
    (safetyLevel === 'restricted' && !isConfirmedThisSession(cacheKey));
  ```

- **区别**:
  - `danger`: **每次调用都需要确认**（无条件）
  - `restricted`: 仅在**未在当前会话确认过**时需要确认（有会话级缓存）

**对 RFC 的影响**:

- **正确性**: 假设错误 - `danger` 是独立等级，不仅仅是 `restricted + confirmation`
- **T2 (工具策略)**: 设计 agent 工具权限继承规则时，必须区分 `danger` 和 `restricted` 的语义差异
- **T4 (Agent 工具绑定)**: per-agent override 需要遵循"只能更严格"原则（`apps/server/src/repo/agent.ts:14-24`），即不能从 `danger` 降级到 `restricted` 或 `safe`

---

## 3. MCP 集成支持 Transport 类型

**假设描述**: 当前 MCP 集成支持 stdio、Streamable HTTP 还是 SSE legacy？

**验证方法**: 读取 `apps/server/src/mcp/manager.ts` 和 `transport-factory.ts`

**真实结果**:

- **当前支持**: **仅 stdio**。`apps/server/src/mcp/transport-factory.ts:12-24`
- **代码注释**: 第 7 行明确说明 `T7 scope: only 'stdio' is supported. 'sse' and 'http' are deferred to later tasks.`
- **错误处理**: 第 23 行对不支持的 transport 抛出错误 `throw new Error('Unsupported MCP transport: ${config.transport}')`

**对 RFC 的影响**:

- **正确性**: 假设部分正确 - 只支持 stdio，HTTP/SSE 尚未实现
- **T7 (MCP)**: RFC 中关于 MCP 传输层的设计需要优先考虑 stdio 的现有实现
- **依赖决策**: 如果 RFC 需要 HTTP/SSE 支持，需要 T1 明确是否扩展 transport-factory.ts

---

## 4. 11 种 SSE 事件类型

**假设描述**: SSE 协议中具体定义了 11 种事件类型

**验证方法**: 读取 `apps/server/src/streaming/sse-protocol.ts`，列出所有 SSEEventType

**真实结果**:

- **事件类型枚举** (`apps/server/src/streaming/sse-protocol.ts:2-13`):
  1. `placeholder` - 占位符事件，客户端创建 UI
  2. `delta` - 内容增量
  3. `done` - 流完成
  4. `error` - 流错误
  5. `aborted` - 流中止
  6. `tool_call_start` - 工具调用开始
  7. `tool_call_delta` - 工具调用增量
  8. `tool_call_done` - 工具调用完成
  9. `tool_result` - 工具执行结果
  10. `confirmation_required` - 工具确认请求
  11. `job_status` - 后台任务状态

**对 RFC 的影响**:

- **正确性**: 假设正确 - 确实是 11 种事件类型
- **T2 (工具策略)**: `confirmation_required` 事件已有完整定义，前端需要实现对应的 UI
- **T5 (后台任务)**: `job_status` 事件已预留，可直接用于任务进度推送

---

## 5. Summarizer 触发机制

**假设描述**: Summarizer 是自动触发还是手动触发？阈值是多少（消息数还是 token 数）？

**验证方法**: 读取 `apps/server/src/prompt/summarizer.ts` 和 `runner.ts` 中的 maybeSummarizeHistory

**真实结果**:

- **触发方式**: **自动触发**。在 agent loop 每轮迭代开始时调用 (`apps/server/src/agent-loop/runner.ts:290`)
- **阈值类型**: **Token 数阈值** + **最小消息数阈值**
  - Token 阈值: `DEFAULT_SUMMARY_THRESHOLD = 30_000` (`runner.ts:123`)，可通过环境变量 `CONTEXT_SUMMARIZE_THRESHOLD` 覆盖
  - 最小消息数: `MIN_MESSAGES_TO_SUMMARIZE = 5` (`runner.ts:130`)
- **触发逻辑** (`runner.ts:154-216`):
  1. 检查 token 数是否超过阈值
  2. 检查未摘要的消息数是否 >= 5
  3. 两个条件都满足才调用 summarizer

**对 RFC 的影响**:

- **正确性**: 假设部分正确 - 是自动触发，但阈值是 token + 消息数双条件，非单一阈值
- **T5 (后台任务)**: 当前 summarizer 设计已适用于同步和异步场景，无需调整
- **T1 决策点**: 如果 RFC 需要手动触发 summarizer，需要扩展 API 接口

---

## 6. Per-agent Override "只能更严格" 计算逻辑

**假设描述**: Per-agent override 的"只能更严格"约束在注册时还是运行时计算？具体公式是什么？

**验证方法**: 读取 `apps/server/src/repo/agent.ts` 和 `tools/executor.ts` 中的 resolveEffectiveSafetyLevel

**真实结果**:

- **计算时机**: **运行时**。在 `executeToolCall` 中调用 `resolveEffectiveSafetyLevel` (`apps/server/src/tools/executor.ts:48`)
- **注册时验证**: 在 `setAgentToolBinding` 时使用 `assertValidOverride` 验证约束 (`apps/server/src/repo/agent.ts:36-49`)
- **具体公式** (`executor.ts:219-230`):

  ```typescript
  function resolveEffectiveSafetyLevel(tool: Tool, ref: ToolRef, agentId: string): SafetyLevel {
    let level = ref.source === 'mcp'
      ? stricterLevel(tool.safetyLevel, 'restricted')  // MCP 工具最小是 restricted
      : tool.safetyLevel;

    const override = getAgentToolSafetyOverride(agentId, tool.id);
    if (override !== 'inherit') level = stricterLevel(level, override);
    return level;
  }
  ```

- **stricterLevel 函数** (`executor.ts:232-234`):

  ```typescript
  function stricterLevel(first: SafetyLevel, second: SafetyLevel): SafetyLevel {
    return STRICTNESS[first] >= STRICTNESS[second] ? first : second;
  }
  ```

**对 RFC 的影响**:

- **正确性**: 假设正确 - 注册时验证，运行时计算
- **T4 (Agent 工具绑定)**: RFC 的 agent 工具权限设计可以直接使用现有的 `stricterLevel` 函数
- **T2 (工具策略)**: MCP 工具的默认安全级别固定为 `restricted`，这影响了 T2 中的工具分类设计

---

## 7. Skill vs MCP 分类（知识插件 vs 能力插件）

**假设描述**: Skill = 知识插件、MCP = 能力插件这个分类在代码库中是否有定义，还是仅是用户的心智模型？

**验证方法**: 在整个代码库中搜索 "knowledge plugin" 和 "capability plugin" 关键词

**真实结果**:

- **搜索结果**: **NOT_FOUND** - 代码库中不存在 "knowledge plugin" 或 "capability plugin" 关键词
- **Skill 位置**: `apps/server/src/skills/`，通过 Markdown 定义工作方式
- **MCP 位置**: `apps/server/src/mcp/`，通过 stdio 传输连接外部工具服务

**对 RFC 的影响**:

- **正确性**: 假设错误 - 这个分类是用户心智模型，非代码定义
- **T1 决策点**: RFC 需要明确定义 Skill 和 MCP 的语义边界。现有代码库未对两者进行概念分类
- **T7 (MCP)**: 如果 RFC 需要引入"知识插件"概念，需要新建模块或在现有模块中明确定义

---

## 8. 3 份既有设计文档的状态标注

**假设描述**: `docs/2026-06-20-*`、`docs/2026-07-11-*`、`docs/2026-07-12-*` 这 3 份设计文档在 README 或 docs/ 中是否被标注为 ratified/proposal/draft？

**验证方法**: 读取 `README.md` 和 `docs/` 目录结构，查找文档状态标记

**真实结果**:

- **README.md 引用**: `README.md:138` 提及"扩展功能前建议先阅读 `docs/` 中的设计文档"，但**未标注具体文档状态**
- **文档文件**:
  - `F:\MyProjects\MyCopilot\docs\2026-06-20-fullstack-agent-upgrade-design.md`
  - `F:\MyProjects\MyCopilot\docs\2026-07-11-tool-safety-system-design.md`
  - `F:\MyProjects\MyCopilot\docs\2026-07-12-common-builtin-tools-plan.md`
- **状态标记**: **NOT_FOUND** - README 和文档本身均无 ratified/proposal/draft 标记

**对 RFC 的影响**:

- **正确性**: 假设错误 - 无任何状态标记
- **T1 决策点**: RFC 需要建立文档状态管理机制（如目录结构、命名约定或元数据）
- **依赖影响**: 无法确认 3 份文档的实现状态，需要逐一比对 RFC 任务与文档内容

---

## 9. MCP 工具 DB 持久化的幂等性和唯一约束

**假设描述**: MCP 工具的 DB 持久化是否支持卸载/重装的幂等性？是否有 unique constraint？

**验证方法**: 读取 `apps/server/src/db/schema.sql` 和迁移文件 `0001_phase2_messages_extend.sql`、`0003_tool_safety_redesign.sql`

**真实结果**:

- **幂等性**: **支持**。`apps/server/src/db/index.ts:26` 使用 `db.exec(schemaSql)`，schema 使用 `CREATE TABLE IF NOT EXISTS`
- **MCP 工具表**: 从迁移文件 `0001_phase2_messages_extend.sql:24-28` 可见 `tools` 表定义
- **Unique Constraint**: **存在**。`apps/server/src/migration/sql/0003_tool_safety_redesign.sql:36-37`:

  ```sql
  CREATE UNIQUE INDEX idx_tools_name_type_source
  ON tools(name, type, COALESCE(source_mcp_id, ''));
  ```

- **卸载/重装**: MCP 工具是**瞬态的**，**不持久化到 DB**。`apps/server/src/mcp/manager.ts:10-11` 注释:

  ```text
  MCP-provided tools are NOT persisted to the DB tools table; they're transient.
  ```

**对 RFC 的影响**:

- **正确性**: 假设错误 - MCP 工具不持久化到 DB，unique constraint 仅适用于 built-in 工具
- **T7 (MCP)**: MCP 工具管理是运行时的，每次连接 MCP 服务器都会重新列出工具
- **T2 (工具策略)**: 工具持久化仅针对 built-in 工具，MCP 工具的安全级别固定为 `restricted`

---

## 10. 前端 Zustand Store 的公共 API

**假设描述**: 前端 Zustand stores (`apps/web/src/store/`) 是否有公共 API 或 React Context 供外部扩展使用？还是纯内部实现？

**验证方法**: 读取 `apps/web/src/store/` 下的所有 store 文件，查找 export 语句和 Context 定义

**真实结果**:

- **Store 文件**:
  - `sessionStore.ts` - 导出 `useSessionStore` hook
  - `configStore.ts` - 导出 `useConfigStore` hook
  - `userStore.ts` - 导出 `useUserStore` hook
  - `debugStore.ts` - 导出 `useDebugStore` hook
- **公共 API**: **存在**。所有 store 都通过 `export const use{StoreName} = create<{...}>()` 导出 hook
- **React Context**: **无**。代码库中未使用 React Context 封装 stores
- **使用方式**: 组件直接导入并使用 hooks，例如 `apps/web/src/components/ChatShell/` 中的组件

**对 RFC 的影响**:

- **正确性**: 假设部分正确 - 有公共 API（hooks），但无 Context
- **T1 决策点**: 如果 RFC 需要支持外部扩展，现有设计已足够（导入 hooks 直接使用）
- **架构影响**: RFC 的前端扩展设计可以直接使用现有的 Zustand hooks，无需引入 Context 层

---

## 验证总结

| 编号 | 假设 | 状态 | NOT_FOUND |
| ------ | ------ | ------ | ----------- |
| 1 | 同工具 >3 次防死循环 | 部分正确（per-run 非 per-session） | 否 |
| 2 | danger 是独立等级 | 正确 | 否 |
| 3 | MCP 支持 stdio/HTTP/SSE | 部分正确（仅 stdio） | 否 |
| 4 | 11 种 SSE 事件 | 正确 | 否 |
| 5 | Summarizer 自动触发 | 部分正确（token+消息数双阈值） | 否 |
| 6 | per-agent override 计算逻辑 | 正确 | 否 |
| 7 | Skill vs MCP 分类定义 | 错误（代码库无此分类） | 是 |
| 8 | 设计文档状态标记 | 错误（无任何标记） | 是 |
| 9 | MCP 工具 DB 持久化 | 错误（MCP 工具不持久化） | 是 |
| 10 | Zustand 公共 API | 部分正确（有 hooks 无 Context） | 否 |

**NOT_FOUND 计数**: 3 个（满足 ≤ 3 的要求）
**"真实结果" 计数**: 10 个（满足 ≥ 7 的要求）
