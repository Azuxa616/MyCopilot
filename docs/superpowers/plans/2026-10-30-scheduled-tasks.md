# 定时任务功能实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 MyCopilot 增加支持完整 Agent、双会话目标、手动创建及自然语言确认创建的持久化定时任务功能。

**Architecture:** 独立 Scheduler 到点生成现有 `agent-loop` Job，`jobs` 保持执行状态唯一事实源。手动表单与自然语言草稿确认共用正式创建入口；Agent 只能创建草稿，不能绕过用户确认。

**Tech Stack:** TypeScript、React 19、Hono、better-sqlite3、Zustand、TailwindCSS 4、Vitest、Croner。

**Spec:** `docs/superpowers/specs/2026-10-30-scheduled-tasks-design.md`

## Global Constraints

- 使用现有 `jobs + worker + agent-loop`，不得让 Scheduler 直接执行 Agent。
- 支持 `once`、`cron`、IANA 时区；使用 Croner，不手写 Cron 日期推算。
- 支持 `new_session` 和 `existing_session`。
- 周期任务停机后只补跑最近一次；同一任务重叠运行时调度触发记为 `skipped`。
- 自然语言创建必须先产生 `ScheduledTaskDraft`，确认前不得创建正式任务、目标 Session、任务消息或 Job。
- 不增加无人值守自动批准高风险工具的能力。
- Server 保持 flat functional modules；SQL 仅位于 `repo/` 和 `db/`。
- Shared 新领域放在独立文件并从 `index.ts` 导出。
- React 组件使用 PascalCase 目录，hooks 放在所属组件目录。
- 不引入标准 Vite 或 Prettier。
- 文档及界面文案使用中文，代码标识符使用英文。

## Review Focus

- 同一 occurrence 被重复扫描：Task 4 以唯一约束和乐观占用测试保证只入队一次。
- 跨夏令时的每日任务：Task 2 固定 2026 年 DST 切换测试。
- 重复确认或双击确认卡片：Task 6、8 验证只创建一个任务。
- 目标 Session 或模型在确认后失效：Task 4、5 验证失败可见且任务暂停。
- 上一运行尚未结束时再次触发：Task 4、5 分别覆盖自动跳过与手动 `409`。

## Task 1: Shared 领域契约与调度表迁移

**Files:**
- Create: `packages/shared/src/scheduled-task.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/__tests__/scheduled-task.test.ts`
- Create: `apps/server/src/migration/sql/0010_scheduled_tasks.sql`
- Test: `apps/server/src/migration/__tests__/0010-scheduled-tasks.test.ts`

**Interfaces:** Produces `ScheduledTaskInput`、`ScheduledTask`、`ScheduledTaskRun`、`ScheduledTaskRunView`、`ScheduledTaskDraft` 及相关联合类型。

```ts
interface ScheduledTaskInput {
  name: string;
  prompt: string;
  scheduleType: 'once' | 'cron';
  runAt: number | null;
  cronExpression: string | null;
  timezone: string;
  targetType: 'new_session' | 'existing_session';
  targetSessionId: string | null;
  modelId: string;
  enforcedSkillIds: string[];
}
```

`ScheduledTaskRunView.status` 使用 `JobStatus | 'skipped' | 'dispatch_failed'`；`ScheduledTaskDraft.status` 使用 `pending | confirmed | cancelled`。

- [ ] **Step 1: 编写失败测试**：验证 Shared 类型覆盖两种调度、两种 Session 目标和草稿状态；迁移测试验证两表、索引及 `(task_id, scheduled_for)` 部分唯一索引。
- [ ] **Step 2: 运行测试并确认失败**：`pnpm --filter @my-copilot/shared exec vitest run src/__tests__/scheduled-task.test.ts` 与 `pnpm --filter @my-copilot/server exec vitest run src/migration/__tests__/0010-scheduled-tasks.test.ts`，预期因模块和迁移不存在而 FAIL。
- [ ] **Step 3: 实现类型和迁移**：迁移只含正式任务与运行记录；运行记录不复制 Job 状态。
- [ ] **Step 4: 重跑 Step 2 命令**：Expected PASS。
- [ ] **Step 5: Commit**：`feat: add scheduled task domain schema`，只暂存本任务文件。

## Task 2: 调度计算、输入校验与任务 Repository

**Files:**
- Create: `apps/server/src/scheduler/calculate-next-run.ts`
- Create: `apps/server/src/scheduler/tasks.ts`
- Create: `apps/server/src/repo/scheduled-task.ts`
- Test: `apps/server/src/scheduler/__tests__/calculate-next-run.test.ts`
- Test: `apps/server/src/scheduler/__tests__/tasks.test.ts`
- Test: `apps/server/src/repo/__tests__/scheduled-task.test.ts`
- Modify: `apps/server/package.json`、`pnpm-lock.yaml`

**Interfaces:**

```ts
getNextRunAt(input: ScheduledTaskInput, after: number): number | null
createScheduledTask(input: ScheduledTaskInput): ScheduledTask
updateScheduledTask(id: string, input: ScheduledTaskInput): ScheduledTask | undefined
getScheduledTask(id: string): ScheduledTask | undefined
listScheduledTasks(): ScheduledTask[]
setScheduledTaskStatus(id: string, status: 'active' | 'paused'): ScheduledTask | undefined
softDeleteScheduledTask(id: string): boolean
```

- [ ] **Step 1: 编写失败测试**：单次、Cron、无效表达式、过去时间、缺失目标、无效模型/Session，以及 `America/New_York` 在 2026-03-08 和 2026-11-01 的每日 09:00。
- [ ] **Step 2: 运行上述三个测试文件并确认 FAIL**。
- [ ] **Step 3: 安装 Croner 并实现**：Repository 持久化，`scheduler/tasks.ts` 跨领域校验；恢复只算未来，编辑不追溯。
- [ ] **Step 4: 重跑上述测试**：Expected PASS。
- [ ] **Step 5: Commit**：`feat: add scheduled task validation and recurrence`，只暂存本任务文件。

## Task 3: 提取可复用的 Agent Job 入队入口

**Files:**
- Create: `apps/server/src/jobs/enqueue-agent-loop.ts`
- Test: `apps/server/src/jobs/__tests__/enqueue-agent-loop.test.ts`
- Modify: `apps/server/src/streaming/lifecycle.ts`

**Interfaces:**

```ts
enqueueAgentLoop(params: StreamMessageParams): {
  job: Job;
  userMessage: Message;
  assistantMessage: Message;
}
```

- [ ] **Step 1: 编写失败测试**：保存用户消息、Assistant 占位、生成 Job，保留 Skills、引用、多模态和模型配置。
- [ ] **Step 2: 运行新测试并确认 FAIL**。
- [ ] **Step 3: 提取异步入队逻辑**：`StreamMessageParams` 移到新模块，HTTP 异步分支复用，同步行为不变。
- [ ] **Step 4: 运行 `src/jobs/__tests__` 和 `src/streaming/__tests__`**：Expected PASS。
- [ ] **Step 5: Commit**：`refactor: extract agent loop enqueue pipeline`，只暂存本任务文件。

## Task 4: 持久化 Scheduler 与原子 Occurrence 分发

**Files:**
- Create: `apps/server/src/scheduler/dispatch.ts`
- Create: `apps/server/src/scheduler/worker.ts`
- Create: `apps/server/src/scheduler/index.ts`
- Test: `apps/server/src/scheduler/__tests__/dispatch.test.ts`
- Test: `apps/server/src/scheduler/__tests__/worker.test.ts`
- Test: `apps/server/src/scheduler/__tests__/integration.test.ts`
- Modify: `apps/server/src/repo/base.ts`、`apps/server/src/repo/scheduled-task.ts`、`apps/server/src/index.ts`

**Interfaces:**

```ts
dispatchDueScheduledTasks(now?: number): { dispatched: number; skipped: number; failed: number }
runScheduledTaskNow(id: string): ScheduledTaskRunView
startScheduler(): void
stopScheduler(): void
```

- [ ] **Step 1: 编写失败测试**：新/原对话、重复扫描、重叠跳过、单次完成、折叠补跑、立即运行、失效目标、启动关闭。
- [ ] **Step 2: 运行 `src/scheduler/__tests__` 并确认 FAIL**。
- [ ] **Step 3: 实现**：通过 `repo/base.ts` 事务包装，原子完成占用、运行记录、Session/Message/Job 和下次时间；Scheduler 后于 Job Worker 启动、先于其关闭。
- [ ] **Step 4: 运行 Scheduler 和 Jobs 测试**：Expected PASS。
- [ ] **Step 5: Commit**：`feat: add durable scheduled task dispatcher`，只暂存本任务文件。

## Task 5: 定时任务与运行记录 API

**Files:**
- Create: `apps/server/src/routes/scheduled-tasks.ts`
- Test: `apps/server/src/routes/__tests__/scheduled-tasks.test.ts`
- Modify: `apps/server/src/index.ts`

**Interfaces:** 已确认 API 及 `GET /api/scheduled-runs/unread-count`、`POST /api/scheduled-runs/:id/read`。

- [ ] **Step 1: 编写失败路由测试**：CRUD、暂停恢复、立即运行、历史、未读、已读、`400/404/409`。
- [ ] **Step 2: 运行新路由测试并确认 FAIL**。
- [ ] **Step 3: 实现并挂载**：路由保持薄层，静态路由先于 `/:id`。
- [ ] **Step 4: 重跑路由测试**：Expected PASS。
- [ ] **Step 5: Commit**：`feat: expose scheduled task management api`，只暂存本任务文件。

## Task 6: 自然语言草稿工具与确认创建 API

**Files:**
- Create: `apps/server/src/migration/sql/0011_scheduled_task_drafts.sql`
- Create: `apps/server/src/repo/scheduled-task-draft.ts`
- Create: `apps/server/src/scheduler/drafts.ts`
- Create: `apps/server/src/tools/builtins/propose-scheduled-task.ts`
- Create: `apps/server/src/routes/scheduled-task-drafts.ts`
- Modify: `apps/server/src/tools/builtins/index.ts`、`apps/server/src/tools/registry.ts`、`apps/server/src/agent-loop/runner.ts`、`apps/server/src/streaming/lifecycle.ts`、`apps/server/src/streaming/sse-protocol.ts`、`apps/server/src/index.ts`
- Test: `apps/server/src/scheduler/__tests__/drafts.test.ts`
- Test: `apps/server/src/tools/builtins/__tests__/propose-scheduled-task.test.ts`
- Test: `apps/server/src/routes/__tests__/scheduled-task-drafts.test.ts`

**Interfaces:**

```ts
proposeScheduledTask(input: ScheduledTaskInput, context: ToolExecutionContext): ScheduledTaskDraft
confirmScheduledTaskDraft(id: string, input: ScheduledTaskInput): { draft: ScheduledTaskDraft; task: ScheduledTask }
cancelScheduledTaskDraft(id: string): ScheduledTaskDraft | undefined
```

`ToolExecutionContext` 增加 `onScheduledTaskDraft?: (draft: ScheduledTaskDraft) => void | Promise<void>`；Runner 增加同名领域事件，SSE 事件名为 `scheduled_task_draft`。

- [ ] **Step 1: 编写失败测试**：工具只生成草稿、正式任务为零、编辑确认、取消、重复确认幂等、同步异步事件含 `draftId`。
- [ ] **Step 2: 运行三个新测试文件并确认 FAIL**。
- [ ] **Step 3: 实现**：只注册 `propose_scheduled_task`，草稿后 Run 正常结束，确认复用 `createScheduledTask` 且幂等。
- [ ] **Step 4: 运行 Scheduler、Tools、Streaming 和新路由测试**：Expected PASS。
- [ ] **Step 5: Commit**：`feat: add confirmed scheduled task drafts`，只暂存本任务文件。

## Task 7: 手动定时任务中心与共享编辑器

**Files:**
- Create: `apps/web/src/components/ScheduledTask/ScheduledTaskEditor.tsx`
- Create: `apps/web/src/components/ScheduledTask/ScheduledTaskList.tsx`
- Create: `apps/web/src/components/ScheduledTask/ScheduledTaskRunList.tsx`
- Create: `apps/web/src/components/ScheduledTask/useScheduledTasks.ts`
- Create: `apps/web/src/components/ScheduledTask/index.ts`
- Create: `apps/web/src/views/scheduled/ScheduledTasksPage.tsx`
- Create: `apps/web/src/views/scheduled/ScheduledTaskEditorPage.tsx`
- Create: `apps/web/src/views/scheduled/ScheduledTaskDetailPage.tsx`
- Modify: `apps/web/src/api/real.ts`、`apps/web/src/router.tsx`、`apps/web/src/components/Asider/index.tsx`
- Test: `apps/web/src/components/ScheduledTask/ScheduledTaskEditor.test.tsx`
- Test: `apps/web/src/views/scheduled/ScheduledTasksPage.test.tsx`

**Interfaces:** 复用 Shared 类型和 Task 5 API，Produces 可给 Task 8 复用的 `ScheduledTaskEditor`。

- [ ] **Step 1: 编写失败组件测试**：Session 下拉首项新对话、其余已有对话；已有选择生成正确目标；创建编辑、暂停恢复、立即运行、历史。
- [ ] **Step 2: 运行两个新测试并确认 FAIL**。
- [ ] **Step 3: 实现**：`/scheduled`、`/scheduled/new`、`/scheduled/:id`、`/scheduled/:id/edit`；侧栏入口与未读；编辑器支持全部字段。
- [ ] **Step 4: 运行 ScheduledTask 组件和 scheduled views 测试**：Expected PASS。
- [ ] **Step 5: Commit**：`feat: add scheduled task management ui`，只暂存本任务文件，不包含既有 ChatShell 改动。

## Task 8: 对话确认卡片与全量验证

**Files:**
- Create: `apps/web/src/components/ScheduledTask/ScheduledTaskDraftCard.tsx`
- Create: `apps/web/src/components/ScheduledTask/useScheduledTaskDrafts.ts`
- Create: `apps/web/src/components/ScheduledTask/ScheduledTaskDraftCard.test.tsx`
- Modify: `apps/web/src/utils/streamUtils.ts`、`apps/web/src/store/sessionStore.ts`、`apps/web/src/components/ChatShell/hooks/useJobStream.ts`、`apps/web/src/components/ChatShell/index.tsx`、`apps/web/src/api/real.ts`

**Interfaces:** 消费 `scheduled_task_draft`、草稿 API 和共享编辑器；同步异步均可编辑、取消、幂等确认。

- [ ] **Step 1: 编写失败测试**：同步解析、异步恢复、刷新加载、修改确认、取消、确认前无正式创建调用、双击仅一次。
- [ ] **Step 2: 运行新卡片、streamUtils 和 useJobStream 测试并确认 FAIL**。
- [ ] **Step 3: 实现**：Session Store 按 Session 保存草稿，ChatShell 渲染，默认来源对话，确认后展示任务链接。
- [ ] **Step 4: 全量验证**：`pnpm test`、`pnpm typecheck`、`pnpm lint`、`pnpm build`、`git diff --check`，Expected 全部通过且最后一项无输出。
- [ ] **Step 5: Commit**：`feat: add conversational scheduled task confirmation`，只暂存本任务明确文件，不包含既有 MessageList/Virtualizer 改动。
