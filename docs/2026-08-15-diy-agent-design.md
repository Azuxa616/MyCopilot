# DIY Agent（用户自定义 Agent）设计

**日期：** 2026-08-15
**状态：** 设计定稿，待用户批准后转入实施计划
**分支：** prase-2-dev
**来源：** "嵌入其他 agent（pi、cursor sdk 等）+ 用户 DIY agent" 需求的头脑风暴产物

## 背景与动机

MyCopilot 已具备完整的多轮 agent loop（`apps/server/src/agent-loop/runner.ts`）、三级工具安全体系（safe/restricted/danger + 审批流）、MCP、skills 与后台 job 模式。代码中已存在大量"半成品"痕迹：

- `packages/shared/src/agent.ts` 已定义 `Agent` 类型（含 `systemPrompt`、`modelId`、`toolIds`、`skillIds`、`mcpIds`）
- 迁移已建好 `agent_tools` / `agent_skills` / `agent_mcps` 三张绑定表
- 但**没有** `agents` 表、没有 `/api/agents` 路由、没有前端 UI；运行时 `agentId` 恒为 `'default'`，仅用于工具安全覆盖

本需求起源于"嵌入外部 agent"的探索。经调研与澄清，确认这是**两条正交的轴**：

- **轴 1（引擎）**：谁跑 agent loop——自有 runner（现状）vs 外部引擎
- **轴 2（定义）**：agent 由谁配置——固定 vs 用户 DIY

**本期只做轴 2（DIY agent），轴 1 留待后续"引擎抽象层"RFC。** 理由：DIY 层不依赖引擎选择，先用现有 runner 交付用户价值并验证假设；将来引入外部引擎时，"agent 定义"与"引擎执行"天然分离，DIY 层无需推翻。

### 外部引擎调研摘要（供轴 1 未来参考）

| 候选 | 许可 | 嵌入形态 | 备注 |
|---|---|---|---|
| pi（`@earendil-works/pi-agent-core`） | MIT | 进程内 SDK（Agent 类）+ RPC（JSON over stdio） | 最适配：TS 原生、专为嵌入设计；仓库已迁至 `earendil-works/pi` |
| opencode（`@opencode-ai/sdk`） | MIT | HTTP 服务（`opencode serve` + REST） | 隔离性好；多一个部署组件 |
| Claude Agent SDK | Anthropic 商业条款 | 库 API 包装原生二进制子进程 | 受专有条款约束 |
| Cursor SDK（`@cursor/sdk`） | 专有（Anysphere） | TS 库，内部 bridge 子进程 | 必须 Cursor API key + 按 token 付费；与自部署场景不匹配 |
| ACP（`@zed-industries/agent-client-protocol`） | Apache-2.0 | 协议标准（JSON-RPC over stdio） | 战略选项：一次实现可挂任何 ACP agent；Cursor CLI 已支持、pi 讨论中 |

⚠️ 已知陷阱：npm 上无 scope 的 `openai-agents` 指向第三方仓库，OpenAI 官方 JS 包是 `@openai/agents`；pi 的官方新包名是 `@earendil-works/pi-*`（`@mariozechner/pi-*` 为旧名）。

## 目标

1. 用户可创建、编辑、删除、启停 agent：`name` / `description` / `systemPrompt` / `modelId` / `parameters` + 工具、技能、MCP 三类白名单绑定
2. **会话级绑定**：创建会话时选择 agent（可不选 = 默认助手），作用于该会话后续所有轮次
3. **纯白名单语义（方案 A）**：绑定 = 精确可见集；未绑定的一律不可见
4. 完全向后兼容：现有会话（`agent_id IS NULL`）行为不变，SSE 协议、runner 循环逻辑、安全审批流零改动

## 非目标

- 不接入外部 agent 引擎（pi / Cursor SDK / ACP）——另行 RFC（见"未来演进"）
- 不做多 agent 编排 / 子 agent（对齐 `docs/rfc/future-work.md` 遗留项）
- 不修改 SSE 协议（`sse-protocol.ts` 的 11 种事件）
- 不改动安全审批模型：白名单只影响工具可见集，**不降低**任何安全级别
- 不做 agent 市场、导入导出、图标/头像
- `parameters` 不做 schema 化 UI，v1 以 JSON 透传给 adapter

## 决策记录（用户已确认）

| 决策点 | 结论 | 备选与理由 |
|---|---|---|
| 产品方向 | 先做 DIY agent，不先嵌外部引擎 | 外部引擎嵌入是方向变更（现有 RFC Non-Goals 明确排除 code-agent 能力），DIY 与现有规划连续 |
| 使用场景 | 自己 + 小团队自部署 | 安全模型按可信用户设计，无需对抗恶意用户 |
| 绑定粒度 | 会话级 | 消息级切换导致历史语义混乱；启动预设丢失"改配置全局生效"能力 |
| 绑定语义 | 方案 A：纯白名单 | B（全局+覆盖）DIY 价值弱；C（白名单+继承）复杂度翻倍，YAGNI |

## 绑定语义细则

- **工具**：有效集 = `agent 绑定 ∩ 全局启用`。全局开关是总闸（运维边界），白名单是角色过滤（用户边界），两层各司其职。`agent_tools.safety_level` 沿用现有语义：`'inherit'`（默认）= 继承全局，否则收紧（只紧不松，现有约束不变）
- **技能**：仅注入绑定的 skills（注入方式沿用 `prompt/assembler.ts` 现有逻辑）
- **MCP**：仅绑定 server 的已同步工具进入有效集
- **systemPrompt**：非空则**替换**默认系统提示（不是拼接）
- **模型优先级**：`agent.modelId` > `session.modelId`；agent 指定的模型已不存在时回退会话模型并 warn
- **新建 agent 默认全选**当前启用的工具/技能/MCP，用户按需删——避免"空绑定全禁"误伤
- **enabled**：仅控制新建会话时选择器可见性；已绑定会话继续可用，避免禁用操作打断进行中的对话

## 数据模型

### 新表 `agents`

```sql
CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  system_prompt TEXT NOT NULL DEFAULT '',
  model_id TEXT,                          -- NULL = 跟随会话模型
  parameters TEXT NOT NULL DEFAULT '{}',  -- JSON，透传给 adapter
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### `sessions` 加列

```sql
ALTER TABLE sessions ADD COLUMN agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL;
```

agent 被删除后会话自动退回默认行为（NULL），不阻塞历史会话。

### 绑定表复用（语义从"覆盖"升级为"绑定即白名单"）

- `agent_tools(agent_id, tool_id, safety_level)`：行存在 = 绑定；`safety_level = 'inherit'`（默认）= 继承全局，其余值 = 收紧（只紧不松，沿用 0003 迁移后的现有语义；"只紧不松"由 `repo/agent.ts` 应用层保证）
- `agent_skills` / `agent_mcps`：行存在 = 绑定（表已存在，从未被使用）
- 绑定行随 agent 或被绑定对象删除级联清理（依赖 0004 迁移补齐的外键，见下）

### 迁移

新增 `0004_diy_agents.sql`，包含：

1. 建 `agents` 表（结构见上）
2. `ALTER TABLE sessions ADD COLUMN agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL`
3. **重建三张绑定表以补外键**（SQLite 不支持 `ADD CONSTRAINT`，沿用 0003 的"建新表 → 拷贝 → 删旧表 → 改名"先例）：
   - `agent_tools`：现状仅有 `tool_id → tools(id) ON DELETE CASCADE`（0003 引入），**没有** `agent_id` 外键（agents 表此前不存在）——补 `agent_id → agents(id) ON DELETE CASCADE`；`safety_level` 保持 `NOT NULL DEFAULT 'inherit'` 不变（已核实：以 `'inherit'` 哨兵值表示继承，无需放宽为可空）
   - `agent_skills` / `agent_mcps`：现状为无外键的裸连接表（0001 引入）——补齐两个方向的 `ON DELETE CASCADE`

### Shared 类型

- `Agent`（`packages/shared/src/agent.ts`）：字段与新表一一对应，**零类型改动**
- `Session`（`packages/shared/src/session.ts`）：增加可选 `agentId?: string | null`（非破坏性）

## 后端行为

| 位置 | 改动 |
|---|---|
| `apps/server/src/repo/agent.ts` | 从"仅安全覆盖查询"扩展为完整 CRUD + 三类绑定读写（PUT 时全量替换绑定） |
| `apps/server/src/routes/agents.ts`（新） | REST CRUD + 绑定随 agent 读写；挂载到 `index.ts` |
| `repo/session.ts` + sessions 路由 | 创建会话接受可选 `agentId`；`PATCH /api/sessions/:id` 支持改绑 |
| `agent-loop/runner.ts` | 从 session 解析 agent（替代硬编码 `'default'`），`agentId` 贯穿到 executor |
| `prompt/assembler.ts` | agent 有 `systemPrompt` → 替换默认系统提示；仅注入绑定的 skills |
| `tools/executor.ts` | 有效工具集按 `绑定 ∩ 全局启用` 过滤；MCP 工具按绑定 server 过滤 |
| 模型解析 | `agent.modelId` 覆盖会话模型；模型不存在 → 回退 + warn |

**关键约束：不改 SSE 协议、不改 runner 循环逻辑、不动 `ToolApproval` 审批流。** 本期只是把"配置从哪来"从硬编码换成 agent 实体。

## 前端设计

| 组件 | 内容 |
|---|---|
| `api/real.ts` + `api/mock.ts` | agents CRUD 端点 + session 改绑；**Mock 模式对齐**（项目约定 Mock/Real 双模式运行时切换） |
| `store/agentStore.ts`（新） | Zustand store，对齐 sessionStore/configStore 模式：缓存 agents 列表 + CRUD actions |
| `components/AgentManager/`（新） | 列表 + 创建/编辑弹窗：name / description / systemPrompt（textarea）/ modelId（下拉，含"跟随会话"空选项）/ enabled 开关 + 三个绑定多选器（工具/技能/MCP，新建默认全选）。入口：设置面板，与 Tools/Skills/MCP 管理并列 |
| 会话创建流程 | agent 选择器（默认"默认助手"） |
| `ChatShell` 头部 | agent 徽标展示 + 切换（**只作用于后续轮次**，历史消息不动） |
| 模型选择器 | agent 指定模型时显示"由 agent 指定"提示，防止用户误以为 session 模型被无视 |

## 错误处理

| 场景 | 行为 |
|---|---|
| 绑定的模型被删 | 回退会话模型 + 运行时 warn，不中断对话 |
| agent 被删 | `ON DELETE SET NULL`，会话退回默认行为 |
| agent 被禁用 | 已绑定会话继续可用（enabled 只管新建选择器） |
| 绑定的工具/技能/MCP 被删 | 绑定行级联清理，有效集自动收缩；全部过滤光也不报错（纯聊天场景合法） |
| `parameters` 非法 JSON | 路由层校验返回 400 |
| 会话中途切换 agent | 仅影响后续轮次；不在历史中注入说明消息（v1 决策，UI 提示即可） |

## 测试策略

**server（Vitest / node 环境）**
- `repo/agent.ts`：CRUD + 绑定全量替换语义
- `executor`：有效集过滤（绑定 ∩ 全局启用）、safety 只紧不松、MCP server 过滤
- `runner`：agent 解析（systemPrompt 替换、技能过滤、模型优先级与回退）
- 迁移：`0004_diy_agents.sql` 应用测试（重点：三张绑定表重建后外键/级联生效、`safety_level` 保持 `NOT NULL DEFAULT 'inherit'` 语义不变）
- session 路由：`agentId` 持久化与改绑

**web（Vitest / jsdom 环境）**
- `agentStore`：CRUD actions
- `AgentManager`：表单校验、三类绑定多选器行为
- mock API 与 real API 端点对齐

**手动验收**
- 创建仅绑 `websearch` + `http` 的 agent → 绑定会话 → 全链路验证工具边界（其他工具不可见/不可调用）

## 迁移与兼容

- 新会话默认 `agent_id IS NULL` = 默认助手，现有数据零迁移成本
- `Agent` shared 类型已存在，无破坏性变更；`Session` 增加可选字段向后兼容
- 老前端（若有缓存）忽略未知字段即可

## 开放问题

1. **`parameters` 的 UI 形态**：v1 建议 temperature 滑杆 + 折叠的原始 JSON 编辑器，还是纯 JSON？→ 建议 v1 从简（纯 JSON 或仅透传），有真实需求再暴露字段
2. **会话中途切换 agent 的 UX**：是否需要在 UI 上做二次确认（影响后续轮次的 system prompt/工具集）？→ 建议 v1 仅轻提示

## 未来演进（轴 1：引擎抽象层，另行 RFC）

DIY 层稳定后，可在 **loop 缝隙**（`streaming/lifecycle.ts` 中 `runAgentLoop` 调用点 + 新 job handler 注册）引入引擎抽象：`Engine.run(session, agent, history, tools, signal, onEvent) → result`。候选按调研结论排序：pi（MIT、进程内 SDK）> opencode（MIT、HTTP serve）> ACP 客户端（标准路线）。已知耦合成本：runner 内嵌持久化需外移或复用、SSE 词汇表需扩展（RFC B6 允许扩展不允许重定义）、外部引擎权限模型与 `ToolApproval` 的关系需产品决策。

## 参考文献

- `docs/rfc/plugin-extension-points.md`（提案阶段的插件系统设计，与本设计互补）
- `docs/rfc/_architecture-decisions.md`（A1-A5、B6、B7）
- `docs/rfc/future-work.md`（多 agent 编排遗留项）
- `.sisyphus/plans/agent-evolution-and-plugin-system.md`（原 Non-Goals，本设计是对轴 2 的部分兑现）
