# MyCopilot 定时任务功能设计

**日期：** 2026-10-30
**状态：** 已确认
**方案：** 独立调度层，到点生成现有 Agent Job

## 1. 背景与目标

为 MyCopilot 增加持久化定时任务能力，到点后运行完整 Agent，包括现有 Agent Loop、工具、MCP 和 Skills。

功能目标：

- 支持单次任务与周期任务。
- 支持手动页面创建与自然语言对话创建两种方式。
- 自然语言创建必须由 Agent 输出可编辑确认卡片，用户点击确认后才正式创建。
- 支持两种会话目标：
  - `new_session`：每次运行创建新对话。
  - `existing_session`：每次运行向指定对话追加消息并继承历史上下文。
- 手动创建页面通过下拉框选择依附 Session。
- 支持暂停、恢复、立即运行、编辑、删除和执行历史。
- 服务重启后任务不丢失，避免重复触发与集中补跑。
- 浏览器关闭不影响执行，但 MyCopilot Server 必须保持运行。

## 2. 方案选择

### 方案 A：独立调度层，到点生成现有 Agent Job（已选择）

Scheduler 只负责判断到期、原子占用和计算下次执行时间，到点后复用现有消息与 `agent-loop` Job 链路。

优点：

- 完整复用 Agent Loop、工具、MCP、Skills、SSE 和运行状态。
- 调度与执行解耦，暂停、重试、补跑和运行历史清晰。
- 两种会话目标只是不同的任务目标策略。
- 对现有同步聊天链路侵入最小。

### 方案 B：调度器直接调用 Agent Runner（不采用）

链路较短，但调度状态与 Agent 状态耦合，并会绕开或重复实现 Worker 的排队、租约、取消和失败处理。

### 方案 C：通用自动化工作流平台（不采用）

长期扩展性最强，但超出当前需求，第一版不建设通用触发器与工作流引擎。

## 3. 非目标与边界

第一版不包含：

- Gmail、Slack、GitHub 等事件触发器。
- 多步骤工作流、条件分支和通用自动化平台。
- 多用户、团队共享和细粒度权限。
- 分布式调度器及跨节点 Exactly-once 执行。
- 邮件、Webhook、系统推送等外部通知。
- 自动批准所有高风险工具调用。
- 通过自然语言修改、暂停或删除已有任务。

边界说明：

1. 到点只保证生成一次运行，不保证外部工具副作用 Exactly-once；进程崩溃后现有 Job 恢复机制仍可能重试 Agent。
2. 当前 Worker 并发为 1，到点不等于立即开始，界面需要区分计划时间、入队时间与实际运行状态。

## 4. 核心模型

### 4.1 ScheduledTask

主要字段：

| 字段 | 含义 |
|---|---|
| `id`、`name`、`prompt` | 任务身份与每次执行的持久化指令 |
| `scheduleType` | `once` 或 `cron` |
| `runAt` | 单次任务执行时间 |
| `cronExpression` | 五字段 Cron 表达式 |
| `timezone` | IANA 时区，如 `Asia/Hong_Kong` |
| `targetType` | `new_session` 或 `existing_session` |
| `targetSessionId` | 原对话目标；新对话模式为空 |
| `modelId` | 固定执行模型，不随全局默认模型漂移 |
| `enforcedSkillIds` | 可选的显式 Skill 集合 |
| `status` | `active`、`paused`、`completed` |
| `nextRunAt` | 下次计划触发时间，持久化 UTC 时间戳 |
| `deletedAt` | 软删除标记，保留历史运行记录 |

单次任务到点并成功入队后标记为 `completed`，表示调度完成，不表示 Agent 执行成功。

### 4.2 ScheduledTaskRun

保存一次计划或手动触发：

- `taskId`
- `scheduledFor`：对应的计划时间；手动运行为空。
- `triggerType`：`schedule`、`catch_up`、`manual`
- `jobId`
- `sessionId`
- `userMessageId`
- `assistantMessageId`
- `dispatchStatus`：`dispatched`、`skipped`、`failed`
- `skippedReason` / `dispatchError`
- `readAt`
- `createdAt`

Job 是执行状态的唯一事实源。API 组合 `job.status` 返回展示状态，避免双写状态不一致。

通过 `(taskId, scheduledFor)` 唯一约束防止同一 occurrence 重复入队；手动运行不受该约束限制。

### 4.3 ScheduledTaskDraft

自然语言创建的持久化草稿：

| 字段 | 含义 |
|---|---|
| `id` | 草稿 ID |
| `sourceSessionId` | 发起创建的对话 |
| `sourceJobId` | 可选，关联生成草稿的 Agent Job |
| `proposedPayload` | Agent 提议的完整 `ScheduledTaskInput` |
| `status` | `pending`、`confirmed`、`cancelled` |
| `confirmedTaskId` | 确认后生成的正式任务 ID |
| `createdAt`、`updatedAt` | 创建与更新时间 |

草稿持久化，刷新后仍可确认或取消。确认必须幂等，重复请求返回同一个 `confirmedTaskId`。

## 5. 两种创建方式

### 5.1 手动创建

在定时任务页面填写表单并点击创建。手动表单提交本身就是用户的创建确认。

“依附 Session”使用下拉框：

```text
每次运行创建新对话
当前对话
其他对话 A
其他对话 B
……
```

- 新对话：`targetType = new_session`，`targetSessionId = null`。
- 已有对话：`targetType = existing_session`，`targetSessionId` 为选中项。
- 手动页面默认新对话；从对话进入时可默认当前对话。
- 下拉框展示会话标题与更新时间，不允许直接填写 Session ID。

### 5.2 自然语言创建

```text
用户描述定时任务
→ Agent 调用 propose_scheduled_task
→ 只创建 ScheduledTaskDraft
→ 对话中输出可编辑确认卡片
→ 用户修改并确认 / 取消
→ 确认后服务端重新校验并创建 ScheduledTask
```

硬约束：

- Agent 侧只注册 `propose_scheduled_task`，不注册 `create_scheduled_task`。
- 工具只能写草稿，不能调用正式创建函数。
- 正式创建只能来自手动创建请求或草稿确认请求。
- 确认前不得创建正式任务、目标 Session、任务消息或 Agent Job。

该约束由服务端结构保证，不能只依赖 Prompt。

### 5.3 共用创建语义

两种方式共用：

- `ScheduledTaskInput` 数据结构。
- `ScheduledTaskEditor` 表单组件。
- 服务端校验和 `createScheduledTask` 创建入口。
- 会话目标、模型、调度规则和 Skill 语义。

## 6. 确认卡片

卡片复用手动页面的 `ScheduledTaskEditor`，允许修改：

- 任务名称与执行 Prompt。
- 单次或周期调度。
- 执行时间、Cron 与时区。
- 依附 Session 下拉框。
- 模型与显式 Skills。

卡片显示服务端计算的下次执行时间，例如“每周一 09:00（Asia/Hong_Kong）”。操作包括“确认创建”和“取消”。从当前对话生成时默认当前对话，用户可切换。

新增 `scheduled_task_draft` 领域事件：

- 同步 SSE 直接发送给前端。
- 异步 Job 将事件保存在结果中，前端根据 `draftId` 获取草稿。
- 草稿生成后当前 Agent Run 正常结束，不长期占用单并发 Worker。

该流程不复用布尔型 `ToolApproval`，因为任务卡片需要结构化编辑与幂等确认。

## 7. 执行链路

```text
Scheduler 轮询到期任务
→ 检查状态、目标会话、模型及重叠运行
→ new_session 创建 Session / existing_session 读取历史
→ 创建用户消息与 Assistant 占位消息
→ 同事务创建 ScheduledTaskRun 和 agent-loop Job
→ 推进 nextRunAt / 完成单次调度
→ 现有 Job Worker 执行 Agent Loop
```

将当前消息接口中的“创建消息并生成 `agent-loop` Job”提取为共享入口，HTTP 聊天和 Scheduler 共同调用。Scheduler 不直接运行 Agent。

## 8. 调度语义

### 8.1 时间与周期

- 数据库存储 UTC 时间戳，界面按任务时区展示。
- 前端提供常用预设，底层统一保存 Cron。
- 使用支持 IANA 时区和夏令时的成熟 Cron 解析库。
- 修改规则后从修改时间计算下一次，不追溯生成历史任务。

### 8.2 停机与漏跑

采用折叠补跑：

- 单次任务：恢复后补跑一次。
- 周期任务：只补跑最近一次遗漏 occurrence。
- 补跑记录为 `triggerType = catch_up`。
- 暂停期间不补跑；恢复时从当前时间之后计算。

### 8.3 重叠运行

第一版统一 `skip`：

- 同一任务已有 `pending`、`running` 或 `waiting_confirmation` Job 时，新 occurrence 记为 `skipped`。
- 手动立即运行遇到重叠返回 `409`。
- 单次失败不阻塞后续 occurrence。

### 8.4 操作语义

- 暂停和删除只影响未来，不取消已开始的 Job。
- 立即运行不改变原有 `nextRunAt`。
- 删除采用软删除，历史保留。
- Job 重试沿用现有策略，Scheduler 不额外重试。

## 9. 会话、模型与工具

### 新对话模式

每次创建独立 Session，标题默认“任务名 + 执行时间”，历史为空，结果独立展示。

### 原对话模式

每次向同一 Session 追加用户消息，使用当前消息之前的最新历史。运行记录关联消息 ID 用于标识定时任务来源。

### 模型与能力

- 创建任务必须能解析到有效模型；从原对话创建默认继承该对话模型。
- 每次运行使用任务保存的 `modelId`，不静默切换模型。
- Provider 配置和凭据在入队时解析，任务定义不复制 API Key。
- 工具、MCP 和自动 Skills 在执行时按当前启用状态解析。
- 模型或目标 Session 失效时产生明确失败记录并暂停，避免周期重复失败。

### 工具审批与安全

- 默认复用现有工具确认流程。
- 需要确认时 Job 可进入 `waiting_confirmation`，在任务中心和会话中显示。
- 现有超时、取消和过期规则继续生效。
- 自动预批准待后续具备工具级允许列表、参数约束或沙箱后单独设计。
- API 复用 Token Auth，响应和日志不得输出 Provider 密钥或完整敏感 Job Payload。

## 10. API 与界面

### 正式任务与运行

```text
GET    /api/scheduled-tasks
POST   /api/scheduled-tasks
GET    /api/scheduled-tasks/:id
PATCH  /api/scheduled-tasks/:id
DELETE /api/scheduled-tasks/:id
POST   /api/scheduled-tasks/:id/pause
POST   /api/scheduled-tasks/:id/resume
POST   /api/scheduled-tasks/:id/run
GET    /api/scheduled-tasks/:id/runs
GET    /api/scheduled-runs/unread-count
POST   /api/scheduled-runs/:id/read
```

### 草稿

```text
GET  /api/scheduled-task-drafts/:id
GET  /api/scheduled-task-drafts?session_id=:sessionId
POST /api/scheduled-task-drafts/:id/confirm
POST /api/scheduled-task-drafts/:id/cancel
```

`confirm` 接收修改后的完整输入并重新校验；失败时不创建任何正式数据，卡片保留用户输入。

### 界面

增加顶层“定时任务”入口和 `/scheduled` 页面：

- 列表：状态、目标会话、下次运行、最近结果、未读。
- 创建/编辑：名称、Prompt、时间、时区、模型、Session、Skills。
- 详情：upcoming runs、历史、失败原因、关联 Session 和 Job。
- 操作：立即运行、暂停、恢复、编辑、删除、取消当前运行。
- 原对话提供创建入口，自动带入 `existing_session`。
- 第一版只做应用内未读与状态提醒。

## 11. 启动、关闭与事务

启动顺序：数据库迁移 → 工具/MCP/Skills 初始化 → 注册 Agent Job Handler → 启动 Job Worker → 启动 Scheduler。

关闭顺序相反，先停止 Scheduler 新触发，再停止 Worker。

调度入队使用 SQLite 事务和乐观条件更新，保证 occurrence 占用、运行记录、Session/Message/Job 创建及下次时间推进不会出现半完成状态。

## 12. 验收条件

1. 单次任务只生成一个新对话和一个 Agent Job。
2. 周期任务持续向原对话追加消息，并使用最新历史。
3. 同一 occurrence 多次扫描只能入队一次。
4. 服务恢复后不重复执行或产生补跑风暴。
5. 暂停期间不执行，恢复后不补跑暂停期间任务。
6. 上一运行未结束时，本次记为 `skipped`。
7. 手动运行不改变下一次计划时间。
8. 删除或暂停不取消已运行 Job。
9. 工具审批能在任务中心显示并继续处理。
10. 跨夏令时、月末和时区变化时计算正确。
11. Agent 生成草稿后正式任务数为零。
12. 确认前不创建目标 Session、任务消息或 Agent Job。
13. 修改后的草稿以最终输入为准，取消不创建。
14. 重复确认只生成一个任务。
15. 同步与异步链路都展示确认卡片，刷新后草稿仍存在。
16. Agent 没有可绕过确认的正式创建工具。

## 13. 成熟产品对比结论

ChatGPT Scheduled Tasks 同时支持独立任务新聊天和回到原聊天；Claude Cowork 每次运行独立 Session，并在创建时要求用户显式确认；Gemini 强调 Scheduled 页面与未读通知；Zapier Agents 区分触发器、Agent 和 Activity。OpenAI Agents API Automations 区分 Automation 与 Invocation，支持 `once`、`periodic`、Cron 时区以及新/既有 Session。

本方案采用任务定义与运行实例分离、双会话目标、任务中心未读、显式确认和完整 Agent 能力复用。针对 MyCopilot 本地单节点特点，额外保留折叠补跑、单 Worker 排队和现有工具审批边界。

参考资料（2026-10-30 核对）：

- https://learn.chatgpt.com/docs/automations
- https://developers.openai.com/api/reference/resources/beta/subresources/agents/subresources/automations
- https://support.claude.com/en/articles/13854387-schedule-recurring-tasks-in-claude-cowork
- https://support.google.com/gemini/answer/16316416
- https://help.zapier.com/hc/en-us/articles/45394909914381-Set-up-your-agent-s-trigger
