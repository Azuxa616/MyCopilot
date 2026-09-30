# 输入框命令与引用（/ 与 @）实施计划

> **执行记录:** 未开始（本计划尚未执行；执行时在此追加偏差记录与终审结论）。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 `Sender` 输入框补齐 `/` 命令（v1 仅 skill 手动激活，`enforcedSkillIds` 走 always 注入通道）与 `@` 引用（v1 仅 `@file` + `@会话`，两层会话引用 = 摘要自动注入 + 模型自主 `read_session`），输入框采用 textarea + overlay chips 形态。

**Architecture:** 服务端三处单点改造：`prompt/skill-injections.ts` 的 `buildSkillInjections(enforcedSkillIds?)` 把点名 skill 标记为 `always: true`（复用 `buildSkillsSection` 的 full 通道）；`prompt/referenced-sessions.ts`（新）按设计固定格式构建 `@会话` 摘要注入块（fail-soft 降级）；`tools/builtins/read-session.ts`（新）提供 safe 级内置工具，registry 增加 `advertised: false` 注册开关实现"仅当本轮携带 `referencedSessionIds` 时进工具目录"（追加动作在 `agent-loop/runner.ts` 单点完成）。`streaming/lifecycle.ts` 与 `jobs/worker.ts` 两条链路只负责穿透参数（P0 教训：双链路都有测试锁定）。前端在 `Sender/` 下新增纯函数 chip 模型（`chips/model.ts`：token 整行承载 + 序列化剔除 chip 行）与触发状态机（`chips/triggers.ts`：单浮层互斥），overlay 层 + 命令面板 / 引用选择器为展示组件，`useChipInput` hook 负责接线。

**Tech Stack:** Hono 4 + better-sqlite3（server）、React 19 + @testing-library/react（web）、Vitest（双环境）、`@my-copilot/shared` 类型。**无新依赖。**

**规格来源:** `docs/2026-09-30-input-commands-design.md`（已获用户批准，全部范围）

**关键设计决策（已锁定，源自设计文档决策记录）:**
- `/` v1 仅 skill 手动激活（命令注册表 `CommandEntry.kind` 预留 `'ui' | 'config' | 'plugin'` 扩展位）；skill 只走 `/` 不进 `@`（单入口心智）
- `@` v1 仅 `@file` + `@会话`；不做 `@tool` / `@MCP` / `@skill`；不做 `@file` 全库语义搜索（v1 仅文件名/标题匹配）
- `enforcedSkillIds` 按 **always 语义全文注入**（用户点名 = 确定性意图，绕过渐进披露）；有效集语义 = `buildSkillInjections` 同源集合（现状全局启用；diy-agent 白名单落地后单点升级 `listEffectiveSkillMetas`），未启用/不存在的名字静默忽略
- **双链路约束（skill P0 教训）**：`streaming/lifecycle.ts`（sync SSE 路径 + async 入队 payload）与 `jobs/worker.ts`（执行期解析）都必须传递 `enforcedSkillIds` / `referencedSessionIds`，两条链路各有测试断言
- `@会话` 两层：第一层服务端查 `getLatestSummary(sessionId)` 注入固定格式摘要块（无摘要时降级为"标题 + 消息数 + 首尾消息片段"简易拼接，fail-soft）；第二层内置工具 `read_session`（safe 级，只读），**仅当本轮携带 `referencedSessionIds` 时动态进入工具目录**（避免目录常驻膨胀），输出 v1 全量 + 64k 安全阀 + 既有工具输出降级链第三级兜底（开放问题 1 采纳建议方案）
- 输入框 = textarea + overlay chips，不引入富文本编辑器；chip 只允许出现在**段落边界**（行首至行尾无其他字符的整行，token 整行承载）；发送时 chip 行从 content 投影中剔除
- 单浮层互斥：`/` 与 `@` 面板同层状态机，后触发者替换
- `Backspace` 在 chip 右侧（caret 恰在 token 行尾）按一次删除整个 chip

**与附件资产计划（plan A）的执行顺序协调（重要）:**
- `docs/2026-09-30-attachment-assets-multimodal-plan.md`（与本文档并行撰写）拥有：`assets` 表与资产 API、附件 parser 资产化、`MessagePart`、`AttachmentMeta.assetId`、**发送 API 的 multipart→JSON 切换**（`POST /api/sessions/:id/messages` 改 JSON body）、`useAttachments` 切换 AssetRef、能力三态门控。
- 本计划**默认在 plan A 之后执行**：Task 8 的路由解析与 Task 12 的 `sendMessage` 序列化直接落在 JSON 形态上；`@file` chip 序列化为 `assetIds`（服务端由 plan A 管道解析为 parts / `AttachmentText` 注入）。
- **若本计划先于 plan A 单独执行**：Task 8 降级为在既有 multipart 路由上追加 `enforcedSkillIds` / `referencedSessionIds` 两个 form 字段（值为 `JSON.stringify` 的数组，代码见该任务降级块）；Task 12 降级为 FormData append 同名字段；Task 11 的 `@file` 候选源（资产列表 API）缺失时，`ReferencePicker` 先只挂会话候选（`@会话` 可独立交付），资产候选待 plan A 落地后接回。
- Task 11 引用选择器的资产候选依赖 plan A 的**资产列表端点**。其设计文档只列了 `POST /api/assets` / `GET /:id/meta` / `GET /:id/raw`，未列列表接口——若 plan A 终稿未提供 `GET /api/assets`（名称过滤列表），执行 Task 11 前先与 plan A 对齐补一个最小列表端点（属资产 API 边界，应在 plan A 文档补记，本计划不擅自实现资产存储）。

**新依赖说明（项目规则要求）:** 无新依赖——全部复用现有栈。

**命令约定（均在仓库根 `F:\MyProjects\MyCopilot` 执行）:**
- 定向测试：`pnpm --filter server exec vitest run <路径>` / `pnpm --filter web exec vitest run <路径>`
- 全量验证：`pnpm typecheck && pnpm --filter server test && pnpm --filter web test && pnpm lint`
- 每个 Task 完成且定向测试通过后提交一次（conventional commit）；若所在会话约定不自动提交，跳过 commit 步骤

---

### Task 1: Shared 类型扩展（SendMessageParams）

**Files:**
- Modify: `packages/shared/src/session.ts:75-77`

**说明:** 只加本设计的两个字段。`assetIds` / `parts` 归 plan A（届时在同一 interface 上追加），本任务不预占。

- [ ] **Step 1.1: 扩展 SendMessageParams**

`packages/shared/src/session.ts` 末尾的 `SendMessageParams` 替换为：

```ts
export interface SendMessageParams {
  content: string;
  /** / 命令携带的手动激活 skill 名（服务端按有效集语义合并为 always 注入，未启用者忽略）。 */
  enforcedSkillIds?: string[];
  /** @会话 引用携带的目标会话 id（服务端注入摘要块并按需注册 read_session 工具）。 */
  referencedSessionIds?: string[];
}
```

- [ ] **Step 1.2: 类型检查**

Run: `pnpm typecheck`
Expected: PASS（新增字段全部可选，既有消费方零破坏）

- [ ] **Step 1.3: Commit**

```bash
git add packages/shared/src/session.ts
git commit -m "feat(shared): add enforcedSkillIds/referencedSessionIds to SendMessageParams"
```

---

### Task 2: buildSkillInjections 的 enforced 合并 + 有效集单点抽取

**Files:**
- Modify: `apps/server/src/prompt/skill-injections.ts`（全量替换，36 行小文件）
- Test: `apps/server/src/prompt/__tests__/skill-injections.test.ts`（追加用例 + 顶部解构导入补 `listEffectiveSkillMetas`）

- [ ] **Step 2.1: 写失败测试**

`apps/server/src/prompt/__tests__/skill-injections.test.ts` 修改与追加：

1. 第 16 行解构导入改为：

```ts
const { buildSkillInjections, listEffectiveSkillMetas } = await import('../skill-injections.js');
```

2. 在 `describe('buildSkillInjections', ...)` 内追加（沿用既有 `installTable` / `makeDetail` helper）：

```ts
  it('enforcedSkillIds 命中启用 skill → 该条 always: true（手动激活走 always 全文通道）', () => {
    installTable([
      { id: 'skill-1', name: 'alpha', body: 'body of alpha', enabled: true, createdAt: 2 },
      { id: 'skill-2', name: 'beta', body: 'body of beta', enabled: true, createdAt: 1 },
    ]);

    const result = buildSkillInjections(['beta']);

    expect(result).toEqual([
      expect.objectContaining({ name: 'alpha', always: false }),
      expect.objectContaining({ name: 'beta', always: true }),
    ]);
  });

  it('enforcedSkillIds 命中已 always 的 skill → 保持单条且 always: true（不重复注入）', () => {
    mockListSkills.mockReturnValue([
      { id: 'skill-1', name: 'always-skill', enabled: true, createdAt: 1, description: 'd' },
    ] as SkillMeta[]);
    mockGetSkill.mockReturnValue(
      makeDetail(
        { id: 'skill-1', name: 'always-skill', body: 'b', enabled: true, createdAt: 1 },
        { always: true },
      ),
    );

    const result = buildSkillInjections(['always-skill']);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ name: 'always-skill', always: true });
  });

  it('enforcedSkillIds 命中未启用/不存在的 skill → 静默忽略（有效集语义：enforced ∩ enabled）', () => {
    installTable([
      { id: 'skill-1', name: 'alpha', body: 'b', enabled: true, createdAt: 1 },
      { id: 'skill-2', name: 'gamma', body: 'b', enabled: false, createdAt: 2 },
    ]);

    const result = buildSkillInjections(['gamma', 'nope']);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ name: 'alpha', always: false });
  });

  it('listEffectiveSkillMetas 返回启用集（/ 面板与注入同源）', () => {
    installTable([
      { id: 'skill-1', name: 'alpha', body: 'b', enabled: true, createdAt: 1 },
      { id: 'skill-2', name: 'gamma', body: 'b', enabled: false, createdAt: 2 },
    ]);

    expect(listEffectiveSkillMetas().map((m) => m.name)).toEqual(['alpha']);
  });
```

- [ ] **Step 2.2: 运行确认失败**

Run: `pnpm --filter server exec vitest run src/prompt/__tests__/skill-injections.test.ts`
Expected: 新用例 FAIL（`buildSkillInjections` 不接受参数 / `listEffectiveSkillMetas` 未导出），既有用例 PASS

- [ ] **Step 2.3: 实现**

`apps/server/src/prompt/skill-injections.ts` 全量替换为：

```ts
import type { SkillMeta } from '@my-copilot/shared';
import { getSkill, listSkills } from '../repo/skill.js';
import type { SkillInjection } from './assembler.js';

/**
 * / 命令面板与 read_skill 共用的有效 skill 元数据集合。
 *
 * 有效集语义（diy-agent 白名单落地前的现状）：全局启用集合
 * `listSkills({ enabled: true })`。diy-agent 计划接入 agent_skills 白名单后，
 * 本函数是唯一需要升级为「绑定 ∩ 全局启用」的入口——命令面板 /
 * read_skill / buildSkillInjections 三方自动跟随，不另造集合。
 */
export function listEffectiveSkillMetas(): SkillMeta[] {
  return listSkills({ enabled: true });
}

/**
 * 从 DB 构建注入对话 prompt 的 skills 列表。
 *
 * 修复 skills 注入死路径：skills 同步进 DB 后，生产路径（lifecycle 同步
 * SSE 流 / jobs worker 异步 agent-loop job）此前从未把 skills 传给
 * runAgentLoop，SkillInjection 注入链在 assembler 之前断裂。本函数补上
 * 缺失的解析环节，是两条生产入口共用的唯一 skills 来源。
 *
 * - 经 `listSkills({ enabled: true })` 取启用集合：目录同步（directory）、
 *   上传（upload）与未来的插件来源（plugin）走同一条 enabled 过滤路径，
 *   不按 source 区分。
 * - listSkills 只返回元数据（SkillMeta 无正文），正文需逐条 getSkill 取回
 *   （SkillDetail.content 即 body 列）。同步执行无并发窗口，开销为廉价的
 *   prepared-statement 主键查询。
 * - 顺序保持 listSkills 的 created_at DESC，满足 assembler
 *   "skills 由调用方按 createdAt 预排序" 的约定。
 *
 * @param enforcedSkillIds / 命令携带的手动激活 skill 名（可选）。命中 name
 *   的条目按 always 语义全文注入（用户点名 = 确定性意图，绕过渐进披露）。
 *   仅在有效集内生效：未启用/不存在的名字静默忽略（enforced ∩ enabled，
 *   与 read_skill 可见集一致——不另造集合）。
 */
export function buildSkillInjections(enforcedSkillIds?: string[]): SkillInjection[] {
  const enforced = new Set(enforcedSkillIds ?? []);
  return listEffectiveSkillMetas().flatMap((meta) => {
    const detail = getSkill(meta.id);
    return detail
      ? [
          {
            name: detail.name,
            description: detail.description,
            triggers: detail.triggers,
            body: detail.content,
            always: detail.always || enforced.has(detail.name),
          },
        ]
      : [];
  });
}
```

- [ ] **Step 2.4: 运行确认通过**

Run: `pnpm --filter server exec vitest run src/prompt/__tests__/skill-injections.test.ts`
Expected: 全部 PASS（既有 + 新增 4 个用例）

- [ ] **Step 2.5: Commit**

```bash
git add apps/server/src/prompt/skill-injections.ts apps/server/src/prompt/__tests__/skill-injections.test.ts
git commit -m "feat(server): buildSkillInjections merges enforcedSkillIds as always-injections"
```

---

### Task 3: 有效集端点 GET /api/skills/effective + web API

**Files:**
- Modify: `apps/server/src/routes/skills.ts`（新增 GET /effective）
- Modify: `apps/web/src/api/real.ts`（Skills API 区块追加 fetchEffectiveSkills）
- Test: `apps/server/src/routes/__tests__/skills.test.ts`（追加用例）

- [ ] **Step 3.1: 写失败测试**

在 `apps/server/src/routes/__tests__/skills.test.ts` 追加（`listSkills` 已在 mock 区；本用例覆写其实现以复现 enabled 过滤契约）：

```ts
  it('GET /effective returns the enabled skill set for the command palette', async () => {
    const ENABLED = { ...mockSkillMeta, id: 'se1', enabled: true };
    const DISABLED = { ...mockSkillMeta, id: 'sd1', enabled: false };
    vi.mocked(listSkills).mockImplementation(
      (filter?: { enabled?: boolean }) =>
        filter?.enabled === true ? [ENABLED] : [ENABLED, DISABLED],
    );

    const app = createTestApp();
    const res = await app.request('/effective');
    expect(res.status).toBe(200);
    const body = (await res.json()) as ApiResponse;
    expect(body.data).toEqual([ENABLED]);
    expect(vi.mocked(listSkills)).toHaveBeenCalledWith({ enabled: true });
  });
```

（`mockSkillMeta` / `createTestApp` / `ApiResponse` 均为该文件既有 fixture；若命名不同按既有变量对齐。）

- [ ] **Step 3.2: 运行确认失败**

Run: `pnpm --filter server exec vitest run src/routes/__tests__/skills.test.ts`
Expected: 新用例 FAIL（404，路由不存在）

- [ ] **Step 3.3: 实现路由**

`apps/server/src/routes/skills.ts`：

1. import 区加：

```ts
import { listEffectiveSkillMetas } from '../prompt/skill-injections.js';
```

2. 在 GET `/` 之后、GET `/:id` **之前**插入（顺序关键：`/:id` 会把 `effective` 当作 id 吞掉）：

```ts
  // GET /effective — / 命令面板的有效 skill 集（与 buildSkillInjections /
  // read_skill 同一集合来源；diy-agent 白名单落地后随 listEffectiveSkillMetas
  // 单点升级为「绑定 ∩ 全局启用」）。必须注册在 GET /:id 之前。
  app.get('/effective', (c) => {
    return successResponse(c, listEffectiveSkillMetas());
  });
```

- [ ] **Step 3.4: 运行确认通过**

Run: `pnpm --filter server exec vitest run src/routes/__tests__/skills.test.ts`
Expected: 全部 PASS

- [ ] **Step 3.5: web API 函数**

`apps/web/src/api/real.ts` Skills API 区块（`fetchSkills` 之后，约 380 行附近）追加：

```ts
/**
 * Fetch the effective skill set for the / command palette
 * GET /api/skills/effective
 */
export async function fetchEffectiveSkills(): Promise<SkillMeta[]> {
    const response = await enhancedFetch<{ data: SkillMeta[] }>('/api/skills/effective', {
        method: 'GET',
        timeout: 30000,
        retry: true,
        maxRetries: 2,
    });
    return response.data;
}
```

（`api/index.ts` barrel 是 `export const api = real`，新函数自动可用，无需改 barrel。）

- [ ] **Step 3.6: 类型检查 + Commit**

Run: `pnpm --filter web exec tsc --noEmit`
Expected: PASS

```bash
git add apps/server/src/routes/skills.ts apps/server/src/routes/__tests__/skills.test.ts apps/web/src/api/real.ts
git commit -m "feat: GET /api/skills/effective exposes the effective skill set for the / palette"
```

---

### Task 4: `@会话` 第一层 — referenced-sessions 注入块构建

**Files:**
- Create: `apps/server/src/prompt/referenced-sessions.ts`
- Create: `apps/server/src/prompt/__tests__/referenced-sessions.test.ts`

- [ ] **Step 4.1: 写失败测试**

创建 `apps/server/src/prompt/__tests__/referenced-sessions.test.ts`：

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Message } from '@my-copilot/shared';

// ---------------------------------------------------------------------------
// Mock repo layer BEFORE importing the module under test
// ---------------------------------------------------------------------------

const mockGetSession = vi.fn();
const mockListMessagesBySession = vi.fn();
const mockGetLatestSummary = vi.fn();

vi.mock('../../repo/session.js', () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
}));
vi.mock('../../repo/message.js', () => ({
  listMessagesBySession: (...args: unknown[]) => mockListMessagesBySession(...args),
}));
vi.mock('../../repo/summary.js', () => ({
  getLatestSummary: (...args: unknown[]) => mockGetLatestSummary(...args),
}));

const { buildReferencedSessionsText } = await import('../referenced-sessions.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function msg(id: string, role: Message['role'], content: string): Message {
  return {
    id,
    sessionId: 's1',
    role,
    content,
    attachments: [],
    status: 'sent',
    createdAt: 1,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildReferencedSessionsText', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('有摘要：按设计固定格式输出并提示 read_session', () => {
    mockGetSession.mockReturnValue({
      id: 's1', title: '旧会话', modelId: null, createdAt: 1, updatedAt: 1,
    });
    mockGetLatestSummary.mockReturnValue({
      id: 'sum-1', sessionId: 's1', summary: '讨论了 A 与 B',
      summarizedUpToMessageId: 'm5', tokenCount: 100, createdAt: 1,
    });

    expect(buildReferencedSessionsText(['s1'])).toBe(
      '[用户引用了会话《旧会话》的摘要]\n' +
        '讨论了 A 与 B\n' +
        '如需完整记录，可调用 read_session 工具（传入 sessionId "s1"）查阅。',
    );
  });

  it('无摘要：fail-soft 降级为消息数 + 首尾片段拼接（首条优先取 user）', () => {
    mockGetSession.mockReturnValue({
      id: 's1', title: '调研记录', modelId: null, createdAt: 1, updatedAt: 1,
    });
    mockGetLatestSummary.mockReturnValue(undefined);
    mockListMessagesBySession.mockReturnValue([
      msg('m1', 'user', '第一条用户消息'),
      msg('m2', 'assistant', '中间回复'),
      msg('m3', 'assistant', '最后一条回复'),
    ]);

    const text = buildReferencedSessionsText(['s1']);
    expect(text).toContain('[用户引用了会话《调研记录》的摘要]');
    expect(text).toContain('共 3 条消息');
    expect(text).toContain('首条（用户）：第一条用户消息');
    expect(text).toContain('末条（助手）：最后一条回复');
    expect(text).toContain('如需完整记录，可调用 read_session 工具（传入 sessionId "s1"）查阅。');
  });

  it('无摘要且无消息：降级为"暂无消息记录"（不抛错）', () => {
    mockGetSession.mockReturnValue({
      id: 's1', title: '空会话', modelId: null, createdAt: 1, updatedAt: 1,
    });
    mockGetLatestSummary.mockReturnValue(undefined);
    mockListMessagesBySession.mockReturnValue([]);

    const text = buildReferencedSessionsText(['s1']);
    expect(text).toContain('《空会话》');
    expect(text).toContain('暂无消息记录');
  });

  it('会话不存在：占位块，不抛错', () => {
    mockGetSession.mockReturnValue(undefined);

    const text = buildReferencedSessionsText(['gone']);
    expect(text).toBe('[用户引用了会话《未知会话》（id: gone），但该会话已不存在]');
  });

  it('id 去重（保序）与空入参返回空串', () => {
    expect(buildReferencedSessionsText([])).toBe('');
    expect(buildReferencedSessionsText(['', 's1', 's1'])).toBe(
      buildReferencedSessionsText(['s1']),
    );
  });

  it('多个引用块之间以空行分隔', () => {
    mockGetSession.mockImplementation((id: string) => ({
      id, title: `会话${id}`, modelId: null, createdAt: 1, updatedAt: 1,
    }));
    mockGetLatestSummary.mockReturnValue(undefined);
    mockListMessagesBySession.mockReturnValue([]);

    const text = buildReferencedSessionsText(['a', 'b']);
    expect(text.split('\n\n')).toHaveLength(2);
  });

  it('超长首/尾消息片段截断到 200 字符', () => {
    mockGetSession.mockReturnValue({
      id: 's1', title: '长会话', modelId: null, createdAt: 1, updatedAt: 1,
    });
    mockGetLatestSummary.mockReturnValue(undefined);
    mockListMessagesBySession.mockReturnValue([
      msg('m1', 'user', 'x'.repeat(500)),
    ]);

    const text = buildReferencedSessionsText(['s1']);
    expect(text).toContain(`${'x'.repeat(200)}…`);
  });
});
```

- [ ] **Step 4.2: 运行确认失败**

Run: `pnpm --filter server exec vitest run src/prompt/__tests__/referenced-sessions.test.ts`
Expected: FAIL（module not found）

- [ ] **Step 4.3: 实现**

创建 `apps/server/src/prompt/referenced-sessions.ts`：

```ts
import { getSession } from '../repo/session.js';
import { listMessagesBySession } from '../repo/message.js';
import { getLatestSummary } from '../repo/summary.js';

/**
 * `@会话` 引用的第一层注入（input-commands 设计）：把用户点名的会话按固定
 * 格式构建为摘要注入块，由 runner 在本轮装配时拼入最终 user 消息前缀。
 *
 * 两层引用的第一层是"自动注入摘要"；第二层（模型自主调 read_session 查阅
 * 完整记录）的提示语写在本块尾部。fail-soft：单会话查询失败降级、不抛错。
 */

/** 降级拼接时首/尾消息片段的字符上限。 */
const SNIPPET_MAX_CHARS = 200;

function snippet(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > SNIPPET_MAX_CHARS
    ? `${trimmed.slice(0, SNIPPET_MAX_CHARS)}…`
    : trimmed;
}

/** 无摘要时的降级块：标题已在外层《》行，此处拼消息数 + 首尾片段。 */
function buildFallbackText(sessionId: string): string {
  const messages = listMessagesBySession(sessionId);
  if (messages.length === 0) {
    return '（该会话暂无摘要，也无消息记录。）';
  }
  const first = messages.find((m) => m.role === 'user') ?? messages[0]!;
  const last = messages[messages.length - 1]!;
  return [
    '（该会话暂无摘要，以下为简易拼接）',
    `共 ${messages.length} 条消息`,
    `首条（${first.role}）：${snippet(first.content)}`,
    `末条（${last.role}）：${snippet(last.content)}`,
  ].join('\n');
}

/**
 * 构建 `@会话` 注入文本。id 去重（保序）；不存在的会话输出占位块。
 * 空入参返回 ''（调用方据此跳过注入）。
 */
export function buildReferencedSessionsText(sessionIds: string[]): string {
  const seen = new Set<string>();
  const blocks: string[] = [];

  for (const id of sessionIds) {
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const session = getSession(id);
    if (!session) {
      blocks.push(`[用户引用了会话《未知会话》（id: ${id}），但该会话已不存在]`);
      continue;
    }

    const summary = getLatestSummary(id);
    const body =
      summary && summary.summary.trim().length > 0
        ? summary.summary
        : buildFallbackText(id);

    blocks.push(
      `[用户引用了会话《${session.title}》的摘要]\n` +
        `${body}\n` +
        `如需完整记录，可调用 read_session 工具（传入 sessionId "${id}"）查阅。`,
    );
  }

  return blocks.join('\n\n');
}
```

- [ ] **Step 4.4: 运行确认通过**

Run: `pnpm --filter server exec vitest run src/prompt/__tests__/referenced-sessions.test.ts`
Expected: 全部 PASS（7 个用例）

- [ ] **Step 4.5: Commit**

```bash
git add apps/server/src/prompt/referenced-sessions.ts apps/server/src/prompt/__tests__/referenced-sessions.test.ts
git commit -m "feat(server): buildReferencedSessionsText for @session summary injection (fail-soft)"
```

---

### Task 5: read_session 内置工具 + registry 条件广告开关

**Files:**
- Modify: `apps/server/src/tools/registry.ts`（`advertised` 注册开关）
- Create: `apps/server/src/tools/builtins/read-session.ts`
- Modify: `apps/server/src/tools/builtins/index.ts`（注册表追加 + 导出）
- Modify: `apps/server/src/index.ts:103-112`（boot 注册透传 advertised）
- Create: `apps/server/src/tools/builtins/__tests__/read-session.test.ts`
- Create: `apps/server/src/tools/__tests__/registry.test.ts`
- Test: `apps/server/src/tools/builtins/__tests__/builtin-registry.test.ts`（数量 12→13）

- [ ] **Step 5.1: 写失败测试（registry 开关）**

创建 `apps/server/src/tools/__tests__/registry.test.ts`：

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import type { Tool } from '@my-copilot/shared';
import {
  registerTool,
  getToolExecutor,
  listRegisteredTools,
  clearRegisteredTools,
  type ToolExecutor,
} from '../registry.js';

function makeExecutor(name: string): ToolExecutor {
  return {
    execute: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
    describe: (): Tool => ({
      id: `builtin-${name}`,
      name,
      description: `test tool ${name}`,
      inputSchema: { fields: [] },
      type: 'built-in',
      safetyLevel: 'safe',
      sourceMcpId: null,
      policyVersion: `builtin:${name}:v1`,
      enabled: true,
      createdAt: 0,
      updatedAt: 0,
    }),
  };
}

describe('tool registry advertised 开关', () => {
  beforeEach(() => {
    clearRegisteredTools();
  });

  it('默认注册的工具进入 listRegisteredTools 广告列表', () => {
    const executor = makeExecutor('t1');
    registerTool('t1', executor);
    expect(listRegisteredTools().map((t) => t.name)).toEqual(['t1']);
    expect(getToolExecutor('t1')).toBe(executor);
  });

  it('advertised:false 的工具可执行但不进常驻广告列表（read_session 条件注册机制）', () => {
    const executor = makeExecutor('t2');
    registerTool('t2', executor, { advertised: false });
    expect(listRegisteredTools()).toEqual([]);
    expect(getToolExecutor('t2')).toBe(executor);
  });

  it('重名注册仍然抛错（既有行为不回归）', () => {
    registerTool('t1', makeExecutor('t1'));
    expect(() => registerTool('t1', makeExecutor('t1'))).toThrow(/already registered/);
  });
});
```

- [ ] **Step 5.2: 运行确认失败**

Run: `pnpm --filter server exec vitest run src/tools/__tests__/registry.test.ts`
Expected: FAIL（registerTool 不接受第三参）

- [ ] **Step 5.3: 扩展 registry.ts**

`apps/server/src/tools/registry.ts` 中 `executors` Map 及三个访问函数改为（其余不动）：

```ts
const executors = new Map<string, { executor: ToolExecutor; advertised: boolean }>();

/**
 * Register a built-in tool executor under `name`.
 *
 * @throws Error if `name` is already registered.
 * @param options.advertised false = 注册后可执行（getToolExecutor 可达），
 *   但不进入 listRegisteredTools 常驻广告列表——供按轮条件广告的工具
 *   （read_session）使用；缺省 true。
 */
export function registerTool(
  name: string,
  executor: ToolExecutor,
  options?: { advertised?: boolean },
): void {
  if (executors.has(name)) {
    throw new Error(`Tool "${name}" is already registered`);
  }
  executors.set(name, { executor, advertised: options?.advertised ?? true });
}

/** Look up the executor registered under `name`, if any. */
export function getToolExecutor(name: string): ToolExecutor | undefined {
  return executors.get(name)?.executor;
}

/** Return the static `Tool` descriptors for every advertised registered built-in. */
export function listRegisteredTools(): Tool[] {
  return Array.from(executors.values())
    .filter((entry) => entry.advertised)
    .map((entry) => entry.executor.describe());
}
```

（文件顶部 `import type { Tool, ToolApproval } from '@my-copilot/shared';` 已存在，无需改。）

- [ ] **Step 5.4: 运行确认通过**

Run: `pnpm --filter server exec vitest run src/tools/__tests__/registry.test.ts`
Expected: 全部 PASS（3 个用例）

- [ ] **Step 5.5: 写失败测试（read-session 执行器）**

创建 `apps/server/src/tools/builtins/__tests__/read-session.test.ts`：

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Message, Tool } from '@my-copilot/shared';

const mockGetSession = vi.fn();
const mockListMessagesBySession = vi.fn();

vi.mock('../../../repo/session.js', () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
}));
vi.mock('../../../repo/message.js', () => ({
  listMessagesBySession: (...args: unknown[]) => mockListMessagesBySession(...args),
}));

const { readSessionExecutor, appendReadSessionTool } = await import('../read-session.js');

function msg(id: string, role: Message['role'], content: string): Message {
  return {
    id, sessionId: 's1', role, content, attachments: [], status: 'sent', createdAt: 1000,
  };
}

describe('readSessionExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('describe：safe 级、单参数 sessionId 的 built-in 形态', () => {
    const tool = readSessionExecutor.describe();
    expect(tool).toMatchObject({
      name: 'read_session',
      type: 'built-in',
      safetyLevel: 'safe',
      enabled: true,
      sourceMcpId: null,
    });
    expect(tool.inputSchema.fields).toEqual([
      { name: 'sessionId', type: 'string', description: expect.any(String), required: true },
    ]);
  });

  it('会话不存在 → isError 且中文错误信息', async () => {
    mockGetSession.mockReturnValue(undefined);
    const result = await readSessionExecutor.execute(
      { sessionId: 'ctx' },
      { sessionId: 'ctx' },
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('不存在');
  });

  it('缺失/非字符串 sessionId → isError（参数校验）', async () => {
    const result = await readSessionExecutor.execute({}, { sessionId: 'ctx' });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('sessionId');
  });

  it('正常输出：标题 + 总数 + 每条消息的角色标记', async () => {
    mockGetSession.mockReturnValue({
      id: 's1', title: '旧会话', modelId: null, createdAt: 1, updatedAt: 1,
    });
    mockListMessagesBySession.mockReturnValue([
      msg('m1', 'user', '问个问题'),
      msg('m2', 'assistant', '这是回答'),
    ]);

    const result = await readSessionExecutor.execute(
      { sessionId: 's1' },
      { sessionId: 'other' },
    );
    expect(result.isError).toBeUndefined();
    const text = result.content[0]!.text;
    expect(text).toContain('《旧会话》');
    expect(text).toContain('共 2 条');
    expect(text).toContain('[用户]');
    expect(text).toContain('问个问题');
    expect(text).toContain('[助手]');
    expect(text).toContain('这是回答');
  });

  it('超长输出截断并追加 truncated 标记（64k 安全阀）', async () => {
    mockGetSession.mockReturnValue({
      id: 's1', title: '长会话', modelId: null, createdAt: 1, updatedAt: 1,
    });
    mockListMessagesBySession.mockReturnValue([
      msg('m1', 'user', 'x'.repeat(80_000)),
    ]);

    const result = await readSessionExecutor.execute(
      { sessionId: 's1' },
      { sessionId: 'other' },
    );
    const text = result.content[0]!.text;
    expect(text.length).toBeLessThanOrEqual(64_000 + '\n…[truncated]'.length);
    expect(text.endsWith('…[truncated]')).toBe(true);
  });
});

describe('appendReadSessionTool', () => {
  it('未携带 referencedSessionIds：原样返回（同一引用）', () => {
    const tools: Tool[] = [];
    expect(appendReadSessionTool(tools)).toBe(tools);
    expect(appendReadSessionTool(tools, [])).toBe(tools);
    expect(appendReadSessionTool(tools, undefined)).toBe(tools);
  });

  it('携带 referencedSessionIds：追加 read_session 描述符', () => {
    const appended = appendReadSessionTool([], ['s1', 's2']);
    expect(appended).toHaveLength(1);
    expect(appended[0]!.name).toBe('read_session');
    expect(appended[0]!.safetyLevel).toBe('safe');
  });
});
```

- [ ] **Step 5.6: 运行确认失败**

Run: `pnpm --filter server exec vitest run src/tools/builtins/__tests__/read-session.test.ts`
Expected: FAIL（module not found）

- [ ] **Step 5.7: 实现 read-session.ts**

创建 `apps/server/src/tools/builtins/read-session.ts`：

```ts
import type { Tool } from '@my-copilot/shared';
import type { ToolExecutor } from '../registry.js';
import {
  builtinTool,
  executeLocalTool,
  textResult,
  errorResult,
  requiredString,
} from './helpers.js';
import { getSession } from '../../repo/session.js';
import { listMessagesBySession } from '../../repo/message.js';

/**
 * read_session — `@会话` 引用的第二层（模型自主查阅完整记录）。
 *
 * 注册形态：boot 时以 `advertised: false` 注册（可执行、不进常驻广告列表）；
 * 仅当某轮携带 referencedSessionIds 时由 runner 经 {@link appendReadSessionTool}
 * 追加进该轮工具目录（设计：动态注册，避免目录常驻膨胀）。
 *
 * 输出：全量格式化消息日志（v1 无分页，设计开放问题 1 采纳"降级链兜底"）。
 * 64k 安全阀截断；进入 history 后再由 context-management-v2 降级链第三级
 * （单条 tool 输出 ≤ 2000 字符）按预算继续降级——两级配合。
 */

/** 单次工具输出字符上限（安全阀，对齐 read_skill 的 64k 约定）。 */
const READ_SESSION_MAX_CHARS = 64_000;

const ROLE_LABELS: Record<string, string> = {
  user: '用户',
  assistant: '助手',
  system: '系统',
  tool: '工具结果',
};

export const readSessionExecutor: ToolExecutor = {
  describe: () =>
    builtinTool({
      id: 'read-session',
      name: 'read_session',
      description:
        'Read the full message log of a session the user referenced with @. ' +
        'Use it when the injected summary is not enough to answer; ' +
        'pass the sessionId given in the reference block.',
      fields: [
        {
          name: 'sessionId',
          type: 'string',
          description: "Session id from the injected '[用户引用了会话…]' block",
          required: true,
        },
      ],
    }),
  async execute(args, context) {
    return executeLocalTool(context, () => {
      const sessionId = requiredString(args, 'sessionId', 200);
      const session = getSession(sessionId);
      if (!session) {
        return errorResult(`会话 ${sessionId} 不存在或已被删除。`);
      }

      const messages = listMessagesBySession(sessionId);
      if (messages.length === 0) {
        return textResult(`会话《${session.title}》暂无消息记录。`);
      }

      let text = `# 会话《${session.title}》完整记录（共 ${messages.length} 条）\n\n`;
      for (const m of messages) {
        const label = ROLE_LABELS[m.role] ?? m.role;
        const time = new Date(m.createdAt).toISOString();
        text += `## [${label}] ${time}\n${m.content}\n\n`;
      }

      if (text.length > READ_SESSION_MAX_CHARS) {
        text = text.slice(0, READ_SESSION_MAX_CHARS) + '\n…[truncated]';
      }
      return textResult(text);
    });
  },
};

/**
 * 仅当本轮携带 `@会话` 引用时，把 read_session 的描述符追加进工具列表。
 * 无引用时原样返回同一数组引用（零分配、零行为变化）。
 */
export function appendReadSessionTool(
  tools: Tool[],
  referencedSessionIds?: string[],
): Tool[] {
  if (!referencedSessionIds || referencedSessionIds.length === 0) return tools;
  return [...tools, readSessionExecutor.describe()];
}
```

- [ ] **Step 5.8: 运行确认通过**

Run: `pnpm --filter server exec vitest run src/tools/builtins/__tests__/read-session.test.ts`
Expected: 全部 PASS（7 个用例）

- [ ] **Step 5.9: 接入 builtinExecutors + boot 注册**

1. `apps/server/src/tools/builtins/index.ts`：

   import 区加：

```ts
import { readSessionExecutor, appendReadSessionTool } from './read-session.js';
```

   `BuiltinExecutorRegistration` 扩展为：

```ts
export interface BuiltinExecutorRegistration {
  name: string;
  executor: ToolExecutor;
  /** false = 注册可执行但不进常驻广告列表（按轮条件广告，如 read_session）。 */
  advertised?: boolean;
}
```

   `builtinExecutors` 数组在 `install_skill` 条目后追加：

```ts
  { name: 'read_session', executor: readSessionExecutor, advertised: false },
```

   文件末尾导出区追加：

```ts
export { readSessionExecutor, appendReadSessionTool } from './read-session.js';
```

   （顶部 import 与末尾 re-export 并存是既有模式——`web-search.js` 等正是如此，不冲突。）

2. `apps/server/src/index.ts` 的 `registerBuiltInTools` 循环改为：

```ts
function registerBuiltInTools() {
  for (const { name, executor, advertised } of builtinExecutors) {
    try {
      registerTool(name, executor, { advertised: advertised ?? true });
    } catch (err) {
      // Already registered (e.g. hot reload) — safe to ignore.
      console.warn(`[tools] ${name} already registered:`, err instanceof Error ? err.message : err);
    }
  }
}
```

3. `apps/server/src/tools/builtins/__tests__/builtin-registry.test.ts` 第一个用例的数量断言 12 → 13：

```ts
    expect(names).toHaveLength(13);
```

- [ ] **Step 5.10: 回归确认**

Run: `pnpm --filter server exec vitest run src/tools`
Expected: 全部 PASS（read_session 不在 RESTRICTED 集合，safe 断言天然满足）

- [ ] **Step 5.11: Commit**

```bash
git add apps/server/src/tools/registry.ts apps/server/src/tools/builtins/read-session.ts apps/server/src/tools/builtins/index.ts apps/server/src/index.ts apps/server/src/tools/__tests__/registry.test.ts apps/server/src/tools/builtins/__tests__/read-session.test.ts apps/server/src/tools/builtins/__tests__/builtin-registry.test.ts
git commit -m "feat(server): read_session builtin tool with conditional advertising (registry advertised flag)"
```

---

### Task 6: assembler v2 注入 + runner 单点接线

**Files:**
- Modify: `apps/server/src/prompt/assembler.ts:209-232`（AssembleV2Params）、`:316-322`（前缀计算）、`:337-345`（计量）、`:467-470`（最终 user 消息）
- Modify: `apps/server/src/agent-loop/runner.ts:99-129`（RunAgentLoopParams）、`:371-388`（工具列表）、`:463-472`（装配调用）、`:811-823`（AgentLoopJobContext）
- Test: `apps/server/src/prompt/__tests__/assembler-v2.test.ts`（追加用例）
- Test: `apps/server/src/agent-loop/__tests__/runner.test.ts`（追加文件级 mock + 用例）

**说明:** v1 `assembleMessages` 已无生产调用方（仅自身测试引用），不改——`@会话` 注入只走 v2 管线。

- [ ] **Step 6.1: 写失败测试（assembler）**

在 `apps/server/src/prompt/__tests__/assembler-v2.test.ts` 追加（文件已 import `assembleMessagesV2`）：

```ts
  it('referencedSessions 注入最终 user 消息前缀（@会话 第一层）', async () => {
    const result = await assembleMessagesV2({
      history: [],
      userContent: '总结一下',
      referencedSessions: '[用户引用了会话《旧会话》的摘要]\n摘要正文',
    });

    const last = result.messages[result.messages.length - 1]!;
    expect(last.role).toBe('user');
    expect(last.content).toBe(
      '[用户引用了会话《旧会话》的摘要]\n摘要正文\n\n总结一下',
    );
  });

  it('referencedSessions 缺省/空白时 user 消息零变化（字节级兼容）', async () => {
    const a = await assembleMessagesV2({ history: [], userContent: 'x' });
    const b = await assembleMessagesV2({
      history: [],
      userContent: 'x',
      referencedSessions: '   ',
    });
    expect(b.messages[b.messages.length - 1]!.content).toBe('x');
    expect(b.messages).toEqual(a.messages);
  });
```

- [ ] **Step 6.2: 运行确认失败**

Run: `pnpm --filter server exec vitest run src/prompt/__tests__/assembler-v2.test.ts`
Expected: 新用例 FAIL（referencedSessions 参数不存在）

- [ ] **Step 6.3: 扩展 assembler.ts**

`apps/server/src/prompt/assembler.ts` 四处修改：

1. `AssembleV2Params`（`summary?: SummaryInjection;` 之后）加：

```ts
  /**
   * `@会话` 引用注入块（调用方预构建文本，见 prompt/referenced-sessions.ts）。
   * 拼入最终 user 消息前缀（附件块之后、用户正文之前），并计入 working 桶计量。
   */
  referencedSessions?: string;
```

2. 附件前缀计算之后（`attachmentPrefix` 的 for 循环结束后）加：

```ts
  // @会话 引用前缀：与最终 user 消息中的引用块逐字一致，用于 working 桶计量。
  const referencedSessionsPrefix =
    params.referencedSessions && params.referencedSessions.trim().length > 0
      ? `${params.referencedSessions}\n\n`
      : '';
```

3. `estimateUsage` 内 `attachmentsText: attachmentPrefix,` 改为：

```ts
      attachmentsText: attachmentPrefix + referencedSessionsPrefix,
```

4. 最终 user 消息 `content: attachmentPrefix + params.userContent,` 改为：

```ts
    content: attachmentPrefix + referencedSessionsPrefix + params.userContent,
```

- [ ] **Step 6.4: 运行确认通过**

Run: `pnpm --filter server exec vitest run src/prompt/__tests__/assembler-v2.test.ts`
Expected: 全部 PASS

- [ ] **Step 6.5: 写失败测试（runner 接线）**

`apps/server/src/agent-loop/__tests__/runner.test.ts` 修改与追加：

1. 文件级 mock 区（`vi.mock('../../repo/memory.js', ...)` 之后）追加两个 mock（lambda 包装避免 TDZ，沿用该文件既有模式）：

```ts
// @会话 引用（input-commands 设计）：runner 单点接线的两个依赖。
const mockBuildReferencedSessionsText = vi.fn(
  (sessionIds: string[]) => (sessionIds.length > 0 ? 'REF_BLOCK_SENTINEL' : ''),
);

vi.mock('../../prompt/referenced-sessions.js', () => ({
  buildReferencedSessionsText: (...args: [string[]]) =>
    mockBuildReferencedSessionsText(...args),
}));

const READ_SESSION_TOOL = makeTool('read_session');
const mockAppendReadSessionTool = vi.fn(
  (tools: Tool[], referencedSessionIds?: string[]) =>
    referencedSessionIds && referencedSessionIds.length > 0
      ? [...tools, READ_SESSION_TOOL]
      : tools,
);

vi.mock('../../tools/builtins/read-session.js', () => ({
  appendReadSessionTool: (...args: [Tool[], string[] | undefined]) =>
    mockAppendReadSessionTool(...args),
}));
```

   ⚠️ `makeTool` 定义在这些 mock 之后（第 81 行起）——vi.mock 工厂延迟执行不触发 TDZ，但 `const READ_SESSION_TOOL = makeTool(...)` 是立即求值，必须放在 `makeTool` 定义之后。实际放置位置：与既有 mock 同区，但把 `READ_SESSION_TOOL` 的初始化改为内联对象（不依赖 `makeTool`）：

```ts
const READ_SESSION_TOOL: Tool = {
  id: 'tool-read_session',
  name: 'read_session',
  description: 'sentinel',
  inputSchema: { fields: [] },
  type: 'built-in',
  safetyLevel: 'safe',
  sourceMcpId: null,
  policyVersion: 'test:read_session:v1',
  enabled: true,
  createdAt: 0,
  updatedAt: 0,
};
```

2. `describe('runAgentLoop', ...)` 内追加用例（沿用 `makeParams` / `makeAdapter` / `generatorFrom` / `events` helper）：

```ts
  it('referencedSessionIds 携带时：注入文本进 assembler、read_session 进广告工具列表', async () => {
    const capturedOptions: Array<{ tools?: Array<{ function: { name: string }> }> | undefined> = [];
    const adapter = {
      type: 'openai',
      chatCompletionStream: (
        _messages: ChatMessage[],
        _config: AdapterConfig,
        options?: { tools?: Array<{ function: { name: string }> } },
      ) => {
        capturedOptions.push(options ? { tools: options.tools } : undefined);
        return generatorFrom([events.finish('stop')]);
      },
    } as unknown as ProviderAdapter;

    await runAgentLoop(
      makeParams({
        adapter,
        referencedSessionIds: ['sess-ref'],
      }),
    );

    expect(mockBuildReferencedSessionsText).toHaveBeenCalledWith(['sess-ref']);
    expect(mockAppendReadSessionTool).toHaveBeenCalledWith(
      expect.any(Array),
      ['sess-ref'],
    );
    expect(mockAssembleMessagesV2).toHaveBeenCalledWith(
      expect.objectContaining({ referencedSessions: 'REF_BLOCK_SENTINEL' }),
    );
    // read_session 出现在发给 LLM 的工具目录里
    const toolNames = capturedOptions[0]?.tools?.map((t) => t.function.name) ?? [];
    expect(toolNames).toContain('read_session');
  });

  it('未携带 referencedSessionIds 时：不注入、不追加（零行为变化）', async () => {
    await runAgentLoop(makeParams({}));

    expect(mockBuildReferencedSessionsText).not.toHaveBeenCalled();
    expect(mockAppendReadSessionTool).toHaveBeenCalledWith(expect.any(Array), undefined);
    expect(mockAssembleMessagesV2).not.toHaveBeenCalledWith(
      expect.objectContaining({ referencedSessions: expect.any(String) }),
    );
  });
```

   （`ChatMessage` / `AdapterConfig` / `ProviderAdapter` / `Tool` 已在该文件 import 区。）

- [ ] **Step 6.6: 运行确认失败**

Run: `pnpm --filter server exec vitest run src/agent-loop/__tests__/runner.test.ts`
Expected: 新用例 FAIL（RunAgentLoopParams 无 referencedSessionIds / mock 未被调用）

- [ ] **Step 6.7: 实现 runner 接线**

`apps/server/src/agent-loop/runner.ts` 修改：

1. import 区（`import { assembleMessagesV2 } from '../prompt/assembler.js';` 之后）加：

```ts
import { buildReferencedSessionsText } from '../prompt/referenced-sessions.js';
import { appendReadSessionTool } from '../tools/builtins/read-session.js';
```

2. `RunAgentLoopParams`（`skills?: SkillInjection[];` 之后）加：

```ts
  /** `@会话` 引用的目标会话 id（按轮参数；仅本轮注入摘要并追加 read_session 工具）。 */
  referencedSessionIds?: string[];
```

3. `runAgentLoop` 解构之后、`RunStateMachine` 构造之前加：

```ts
  // @会话 引用（input-commands 设计）：本轮携带时构建一次摘要注入文本，并把
  // read_session 追加进广告工具列表。单点接线——lifecycle / jobs worker 双链路
  // 只需传递 referencedSessionIds，此处自动生效（skill P0 教训的参数穿透归口）。
  const referencedSessionsText =
    params.referencedSessionIds && params.referencedSessionIds.length > 0
      ? buildReferencedSessionsText(params.referencedSessionIds)
      : '';
  const advertisedTools = appendReadSessionTool(tools, params.referencedSessionIds);
```

4. `const toolsByName = new Map(tools.map((tool) => [tool.name, tool]));` 改用 `advertisedTools`：

```ts
  const toolsByName = new Map(advertisedTools.map((tool) => [tool.name, tool]));
```

5. `const jsonTools: JsonSchemaTool[] = tools.map(...)` 改用 `advertisedTools`：

```ts
  const jsonTools: JsonSchemaTool[] = advertisedTools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: toolInputSchemaToJsonSchema(t.inputSchema),
    },
  }));
```

6. `assembleMessagesV2` 调用（循环内）加一行参数：

```ts
      const runContext = await assembleMessagesV2({
        history,
        userContent,
        attachments,
        skills,
        sessionId,
        adapter,
        adapterConfig,
        strategy: 'sliding_window',
        referencedSessions: referencedSessionsText || undefined,
      });
```

7. `AgentLoopJobContext`（`skills?: SkillInjection[];` 之后）加：

```ts
  /** `@会话` 引用的目标会话 id（worker 从 payload 透传；runner 单点消费）。 */
  referencedSessionIds?: string[];
```

（`runAgentLoopAsJob` 以 `...context` 展开进 `runAgentLoop`，无需其它改动。）

- [ ] **Step 6.8: 运行确认通过**

Run: `pnpm --filter server exec vitest run src/agent-loop/__tests__/runner.test.ts src/prompt/__tests__/assembler-v2.test.ts`
Expected: 全部 PASS

- [ ] **Step 6.9: Commit**

```bash
git add apps/server/src/prompt/assembler.ts apps/server/src/prompt/__tests__/assembler-v2.test.ts apps/server/src/agent-loop/runner.ts apps/server/src/agent-loop/__tests__/runner.test.ts
git commit -m "feat(server): wire @session injection + conditional read_session advertising into the agent loop"
```

---

### Task 7: 双链路传参（lifecycle sync/async + worker payload）——P0 教训测试

**Files:**
- Modify: `apps/server/src/streaming/lifecycle.ts:18-25`（StreamMessageParams）、`:36`（解构）、`:84-100`（async payload）、`:138-150`（runAgentLoop 调用）
- Modify: `apps/server/src/jobs/worker.ts:17-25`（AgentLoopJobPayload）、`:275-291`（handler context）
- Test: `apps/server/src/streaming/__tests__/lifecycle.test.ts`（追加文件级 mock + 3 个用例）
- Create: `apps/server/src/jobs/__tests__/agent-loop-handler.test.ts`

- [ ] **Step 7.1: 写失败测试（lifecycle 链路）**

`apps/server/src/streaming/__tests__/lifecycle.test.ts` 修改与追加：

1. 文件级 mock 区追加（既有 mock 均未覆盖 repo/job —— async 分支需要）：

```ts
const mockCreateJob = vi.fn();

vi.mock('../../repo/job.js', () => ({
  createJob: (...args: unknown[]) => mockCreateJob(...args),
}));
```

2. `describe` 内追加 3 个用例（沿用 `setupNormalCompletion` / `makeParams` / `makeContext` / `flushMicrotasks`）：

```ts
  // ── / 命令与 @ 引用参数穿透（skill P0 教训：双链路之 sync）──

  it('sync 链路：enforcedSkillIds 传入 buildSkillInjections，referencedSessionIds 传入 runAgentLoop', async () => {
    setupNormalCompletion();

    streamMessageHandler(makeContext(), makeParams({
      enforcedSkillIds: ['beta'],
      referencedSessionIds: ['sess-9'],
    }));
    await flushMicrotasks();

    expect(mockBuildSkillInjections).toHaveBeenCalledWith(['beta']);
    expect(mockRunAgentLoop).toHaveBeenCalledWith(
      expect.objectContaining({ referencedSessionIds: ['sess-9'] }),
    );
  });

  it('未携带时按 undefined 传递（零行为变化）', async () => {
    setupNormalCompletion();

    streamMessageHandler(makeContext(), makeParams());
    await flushMicrotasks();

    expect(mockBuildSkillInjections).toHaveBeenCalledWith(undefined);
    expect(mockRunAgentLoop).toHaveBeenCalledWith(
      expect.objectContaining({ referencedSessionIds: undefined }),
    );
  });

  it('async 链路（入队侧）：enforcedSkillIds / referencedSessionIds 写入 job payload', async () => {
    setupNormalCompletion();
    mockCreateJob.mockReturnValue({ id: 'job-1' });
    process.env.AGENT_ASYNC_MODE = 'true';

    try {
      const asyncContext = {
        json: (data: unknown, status: number) =>
          new Response(JSON.stringify(data), { status }),
      } as unknown as Context;

      streamMessageHandler(asyncContext, makeParams({
        enforcedSkillIds: ['beta'],
        referencedSessionIds: ['sess-9'],
      }));
      await flushMicrotasks();

      expect(mockCreateJob).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'agent-loop',
          payload: expect.objectContaining({
            enforcedSkillIds: ['beta'],
            referencedSessionIds: ['sess-9'],
          }),
        }),
      );
      // async 模式不走 runAgentLoop（由 worker 执行）
      expect(mockRunAgentLoop).not.toHaveBeenCalled();
    } finally {
      delete process.env.AGENT_ASYNC_MODE;
    }
  });
```

- [ ] **Step 7.2: 写失败测试（worker 链路）**

创建 `apps/server/src/jobs/__tests__/agent-loop-handler.test.ts`：

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Job } from '@my-copilot/shared';

// ---------------------------------------------------------------------------
// Mocks — 动态 import 的模块同样走 vi.mock 拦截（同一模块图）。
// Lambda 包装（而非直接传 mock）避免 vi.mock 工厂提升触发的 TDZ。
// ---------------------------------------------------------------------------

const mockRunAgentLoopAsJob = vi.fn();
const mockGetAdapter = vi.fn(() => ({ type: 'openai' }));
const mockListEnabledTools = vi.fn(() => []);
const mockListRegisteredTools = vi.fn(() => []);
const mockFilterDemoTools = vi.fn((tools: unknown[]) => tools);
const mockBuildSkillInjections = vi.fn(() => []);
const mockClaimJob = vi.fn();
const mockCompleteJob = vi.fn();
const mockFailJob = vi.fn();
const mockReclaimStaleJobs = vi.fn(() => 0);
const mockRenewJobLease = vi.fn(() => true);
const mockFailWaitingJobsOnStartup = vi.fn(() => 0);

vi.mock('../../agent-loop/runner.js', () => ({
  runAgentLoopAsJob: (...args: unknown[]) => mockRunAgentLoopAsJob(...args),
}));
vi.mock('../../llm/index.js', () => ({
  getAdapter: (...args: unknown[]) => mockGetAdapter(...args),
}));
vi.mock('../../repo/tool.js', () => ({
  listEnabledTools: (...args: unknown[]) => mockListEnabledTools(...args),
}));
vi.mock('../../tools/registry.js', () => ({
  listRegisteredTools: (...args: unknown[]) => mockListRegisteredTools(...args),
}));
vi.mock('../../demo/tools.js', () => ({
  filterDemoTools: (...args: unknown[]) => mockFilterDemoTools(...args),
}));
vi.mock('../../prompt/skill-injections.js', () => ({
  buildSkillInjections: (...args: unknown[]) => mockBuildSkillInjections(...args),
}));
vi.mock('../../repo/job.js', () => ({
  claimJob: (...args: unknown[]) => mockClaimJob(...args),
  completeJob: (...args: unknown[]) => mockCompleteJob(...args),
  failJob: (...args: unknown[]) => mockFailJob(...args),
  reclaimStaleJobs: (...args: unknown[]) => mockReclaimStaleJobs(...args),
  renewJobLease: (...args: unknown[]) => mockRenewJobLease(...args),
  failWaitingJobsOnStartup: (...args: unknown[]) => mockFailWaitingJobsOnStartup(...args),
  resumeJobAfterConfirmation: vi.fn(),
  setJobWaitingForConfirmation: vi.fn(),
}));
vi.mock('../../repo/tool-approval.js', () => ({
  expirePendingToolApprovals: vi.fn(),
}));

import { processJob, registerAgentLoopHandler, clearJobHandlers, stop } from '../worker.js';

function makeJob(payload: Record<string, unknown>): Job {
  return {
    id: 'job-1',
    type: 'agent-loop',
    payload,
    status: 'running',
    priority: 0,
    attempts: 1,
    maxAttempts: 1,
    leasedAt: Date.now(),
    leaseOwner: 'worker-1',
    error: null,
    result: null,
    sessionId: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function basePayload(): Record<string, unknown> {
  return {
    sessionId: 'sess-1',
    userMessageId: 'm1',
    userContent: 'hi',
    history: [],
    adapterType: 'openai',
    adapterConfig: { baseUrl: 'http://x', model: 'gpt' },
  };
}

describe('registerAgentLoopHandler（/ 与 @ 参数穿透：双链路之 async 执行侧）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunAgentLoopAsJob.mockResolvedValue({ status: 'completed' });
    mockBuildSkillInjections.mockReturnValue([]);
    clearJobHandlers();
    registerAgentLoopHandler();
  });

  afterEach(async () => {
    await stop(100);
    clearJobHandlers();
  });

  it('payload 携带 enforcedSkillIds → buildSkillInjections 收到该数组；referencedSessionIds → job context', async () => {
    mockBuildSkillInjections.mockReturnValue([{ name: 'S', body: 'B' }]);

    await processJob(
      makeJob({
        ...basePayload(),
        enforcedSkillIds: ['beta'],
        referencedSessionIds: ['sess-9'],
      }),
    );

    expect(mockBuildSkillInjections).toHaveBeenCalledWith(['beta']);
    expect(mockRunAgentLoopAsJob).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        skills: [{ name: 'S', body: 'B' }],
        referencedSessionIds: ['sess-9'],
      }),
      expect.any(AbortSignal),
    );
    expect(mockCompleteJob).toHaveBeenCalled();
  });

  it('payload 未携带时按 undefined 传递（零行为变化，不抛错）', async () => {
    await processJob(makeJob(basePayload()));

    expect(mockBuildSkillInjections).toHaveBeenCalledWith(undefined);
    expect(mockRunAgentLoopAsJob).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ referencedSessionIds: undefined }),
      expect.any(AbortSignal),
    );
  });
});
```

- [ ] **Step 7.3: 运行确认失败**

Run: `pnpm --filter server exec vitest run src/streaming/__tests__/lifecycle.test.ts src/jobs/__tests__/agent-loop-handler.test.ts`
Expected: 新用例 FAIL（参数未穿透；`buildSkillInjections` 被以 `undefined` 调用而非 `['beta']`）

- [ ] **Step 7.4: 实现 lifecycle.ts 穿透**

`apps/server/src/streaming/lifecycle.ts` 修改：

1. `StreamMessageParams`（`history: Message[];` 之后）加：

```ts
  /** / 命令携带的手动激活 skill 名（经 buildSkillInjections 合并为 always 注入）。 */
  enforcedSkillIds?: string[];
  /** `@会话` 引用的目标会话 id（透传 runAgentLoop：注入摘要 + 追加 read_session）。 */
  referencedSessionIds?: string[];
```

2. 解构行改为：

```ts
  const { sessionId, userMessage, provider, model, attachments, history, enforcedSkillIds, referencedSessionIds } = params;
```

3. async 模式 `createJob` 的 payload（`adapterConfig,` 之后、`enabledTools,` 之前）加：

```ts
        // / 与 @ 的按轮参数：worker 执行期消费（skills 集合本身仍是执行期解析，
        // 只有用户意图随 payload 快照——与 tools 的重解析语义一致）。
        enforcedSkillIds: enforcedSkillIds ?? [],
        referencedSessionIds: referencedSessionIds ?? [],
```

4. sync 路径 `runAgentLoop` 调用中 `skills: buildSkillInjections(),` 改为并追加：

```ts
        // Skills 注入（修复死路径）：enabled skills 在执行期从 DB 解析进 prompt；
        // / 命令的 enforcedSkillIds 在此合并（always 语义）。
        skills: buildSkillInjections(enforcedSkillIds),
        referencedSessionIds,
```

- [ ] **Step 7.5: 实现 worker.ts 穿透**

`apps/server/src/jobs/worker.ts` 修改：

1. `AgentLoopJobPayload`（`adapterConfig` 字段后）加：

```ts
  /** / 命令携带的手动激活 skill 名（执行期与 enabled 集合并注入）。 */
  enforcedSkillIds?: string[];
  /** `@会话` 引用的目标会话 id（runner 注入摘要 + 追加 read_session 工具）。 */
  referencedSessionIds?: string[];
```

2. `registerAgentLoopHandler` 的 context 构造中 `skills: buildSkillInjections(),` 改为并追加：

```ts
        // Skills 注入（修复死路径）：执行期解析而非 payload 快照；
        // enforcedSkillIds 是本轮用户意图，必须经 payload 穿透（P0 教训：
        // 两条链路都要传，agent-loop-handler.test.ts 锁定本行为）。
        skills: buildSkillInjections(payload.enforcedSkillIds),
        referencedSessionIds: payload.referencedSessionIds,
```

- [ ] **Step 7.6: 运行确认通过**

Run: `pnpm --filter server exec vitest run src/streaming/__tests__/lifecycle.test.ts src/jobs/__tests__/agent-loop-handler.test.ts src/jobs/__tests__/worker.test.ts`
Expected: 全部 PASS（含既有 worker 套件零回归）

- [ ] **Step 7.7: Commit**

```bash
git add apps/server/src/streaming/lifecycle.ts apps/server/src/streaming/__tests__/lifecycle.test.ts apps/server/src/jobs/worker.ts apps/server/src/jobs/__tests__/agent-loop-handler.test.ts
git commit -m "feat(server): thread enforcedSkillIds/referencedSessionIds through sync and async agent-loop chains"
```

---

### Task 8: server 路由解析（POST /api/sessions/:sessionId/messages）

**Files:**
- Modify: `apps/server/src/routes/messages.ts:15-103`
- Test: `apps/server/src/routes/__tests__/messages.test.ts`（追加用例）

**前置（plan A 协调）:** 本任务按 **plan A 已执行**（路由为 JSON body）撰写。若 plan A 未执行，见步骤 8.3 的降级形态。

- [ ] **Step 8.1: 写失败测试**

在 `apps/server/src/routes/__tests__/messages.test.ts` 追加（沿用该文件既有 mock 与 fixture 形态）：

```ts
  it('POST / 解析 enforcedSkillIds / referencedSessionIds 并透传 lifecycle（plan A JSON 形态）', async () => {
    const mockSession = { id: 's1', title: 'Test', modelId: 'm1', createdAt: 1, updatedAt: 1 };
    const mockModel = { id: 'm1', providerId: 'p1', name: 'gpt-4', enabled: true, createdAt: 1, updatedAt: 1 };
    const mockProvider = { id: 'p1', name: 'OpenAI', type: 'openai' as const, baseUrl: 'https://api.openai.com', apiKey: 'sk-test', enabled: true, createdAt: 1, updatedAt: 1 };

    vi.mocked(getSession).mockReturnValue(mockSession);
    vi.mocked(getModel).mockReturnValue(mockModel);
    vi.mocked(getProvider).mockReturnValue(mockProvider);
    vi.mocked(listMessagesBySession).mockReturnValue([]);
    vi.mocked(parseAllAttachments).mockResolvedValue({ results: [], warnings: [] });
    vi.mocked(streamMessageHandler).mockReturnValue(
      new Response('sse-stream', { headers: { 'content-type': 'text/event-stream' } }),
    );

    const app = createTestApp();
    const res = await app.request('/sessions/s1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: 'hello',
        enforcedSkillIds: ['beta', 'gamma'],
        referencedSessionIds: ['sess-9'],
      }),
    });

    expect(res.status).toBe(200);
    expect(streamMessageHandler).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        sessionId: 's1',
        enforcedSkillIds: ['beta', 'gamma'],
        referencedSessionIds: ['sess-9'],
      }),
    );
  });

  it('POST / 对非法 id 列表字段静默修正（非数组忽略；非字符串/空白元素过滤；超限截断）', async () => {
    const mockSession = { id: 's1', title: 'Test', modelId: 'm1', createdAt: 1, updatedAt: 1 };
    const mockModel = { id: 'm1', providerId: 'p1', name: 'gpt-4', enabled: true, createdAt: 1, updatedAt: 1 };
    const mockProvider = { id: 'p1', name: 'OpenAI', type: 'openai' as const, baseUrl: 'https://api.openai.com', apiKey: 'sk-test', enabled: true, createdAt: 1, updatedAt: 1 };

    vi.mocked(getSession).mockReturnValue(mockSession);
    vi.mocked(getModel).mockReturnValue(mockModel);
    vi.mocked(getProvider).mockReturnValue(mockProvider);
    vi.mocked(listMessagesBySession).mockReturnValue([]);
    vi.mocked(parseAllAttachments).mockResolvedValue({ results: [], warnings: [] });
    vi.mocked(streamMessageHandler).mockReturnValue(
      new Response('sse-stream', { headers: { 'content-type': 'text/event-stream' } }),
    );

    const app = createTestApp();
    const res = await app.request('/sessions/s1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: 'hi',
        enforcedSkillIds: 'not-an-array',
        referencedSessionIds: ['', 42, 'sess-9'],
      }),
    });

    expect(res.status).toBe(200);
    expect(streamMessageHandler).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ referencedSessionIds: ['sess-9'] }),
    );
    // 非法字段被修正为 undefined（不进 objectContaining 的键值断言口径）
    const call = vi.mocked(streamMessageHandler).mock.calls[0]!;
    expect(call[1]?.enforcedSkillIds).toBeUndefined();
  });
```

- [ ] **Step 8.2: 运行确认失败**

Run: `pnpm --filter server exec vitest run src/routes/__tests__/messages.test.ts`
Expected: 新用例 FAIL（路由仍解析 multipart form，`c.req.json` 字段缺失 → 透传为 undefined）

- [ ] **Step 8.3: 实现路由解析**

`apps/server/src/routes/messages.ts` 修改：

1. 文件顶部（`messagesApp` 定义之前）加解析 helper：

```ts
/**
 * 发送参数中的 id 列表解析：非数组返回 undefined；元素过滤非字符串与空白；
 * 超过 maxCount 截断（防御性上限，不报错——非法输入静默修正）。
 */
function parseIdList(value: unknown, maxCount: number): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const ids = value
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map((v) => v.trim())
    .slice(0, maxCount);
  return ids.length > 0 ? ids : undefined;
}
```

2. POST `/` 的请求体解析（plan A JSON 形态；`const form = await c.req.formData();` 起的 content/files 解析由 plan A 改造，此处只新增两个字段——在 plan A 改造后的 JSON body 解构处追加）：

```ts
  const body = await c.req.json<{
    content?: string;
    enforcedSkillIds?: unknown;
    referencedSessionIds?: unknown;
  }>();
  const content = typeof body.content === 'string' ? body.content : '';
  const enforcedSkillIds = parseIdList(body.enforcedSkillIds, 20);
  const referencedSessionIds = parseIdList(body.referencedSessionIds, 10);
```

   （`content` 长度校验沿用既有 100000 上限；`assetIds` 解析归 plan A。）

3. `streamMessageHandler` 调用参数追加：

```ts
    enforcedSkillIds,
    referencedSessionIds,
```

**降级形态（本计划先于 plan A 执行时）：** 保持既有 multipart 解析，在 `const content = ...` 之后追加：

```ts
  const enforcedSkillIds = parseIdList(safeJsonParse(form.get('enforcedSkillIds')), 20);
  const referencedSessionIds = parseIdList(safeJsonParse(form.get('referencedSessionIds')), 10);
```

其中 `safeJsonParse` 为局部 helper（`null` → `undefined`，解析失败 → `undefined`）：

```ts
function safeJsonParse(value: FormDataEntryValue | null): unknown {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}
```

对应测试的请求体改为 `form.append('enforcedSkillIds', JSON.stringify(['beta']))` 形态。

- [ ] **Step 8.4: 运行确认通过**

Run: `pnpm --filter server exec vitest run src/routes/__tests__/messages.test.ts`
Expected: 全部 PASS（既有用例若因 plan A JSON 切换而形态变化，属 plan A 范围，此处只保证新用例与既有用例全绿）

- [ ] **Step 8.5: Commit**

```bash
git add apps/server/src/routes/messages.ts apps/server/src/routes/__tests__/messages.test.ts
git commit -m "feat(server): parse enforcedSkillIds/referencedSessionIds in the send-message route"
```

---

### Task 9: Web chip 纯模型（token 整行承载 + 序列化）

**Files:**
- Create: `apps/web/src/components/Sender/chips/model.ts`
- Create: `apps/web/src/components/Sender/chips/model.test.ts`

**模型要点（写码前必读）:**
- chip 在 textarea 中的承载 = **token 整行**（行内容恰好等于 token，如 `/translate`、`@报告.pdf`）；段落边界约束由 `insertChipToken` 的切行规则保证
- chip 状态（含 assetId/sessionId 解析结果）是数组；**有效性 = 其 token 行仍逐字存在于 textarea**（用户手动改写 token 行 → chip 悬空，序列化时剔除）
- token 唯一：插入时若同名 token 已存在则拒绝（由 hook 层调用 `hasChipToken` 判定）
- chip 展示文本 v1 = token 原文（保证 overlay 底层文本被完整覆盖，见 Task 11）

- [ ] **Step 9.1: 写失败测试**

创建 `apps/web/src/components/Sender/chips/model.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import {
  annotateLines,
  createChip,
  deleteChipAtCaret,
  hasChipToken,
  insertChipToken,
  serializeDraft,
} from './model';

const skillChip = createChip({ kind: 'skill', token: '/translate', skillName: 'translate' });
const fileChip = createChip({ kind: 'file', token: '@报告.pdf', assetId: 'a1' });
const sessionChip = createChip({ kind: 'session', token: '@调研记录', sessionId: 's9' });

describe('insertChipToken', () => {
  it.each([
    {
      name: '空输入：token 独占唯一一行',
      value: '/tra', start: 0, end: 4, token: '/translate',
      expected: '/translate', caret: 10,
    },
    {
      name: '行中触发：前文切上一行、后文切下一行',
      value: 'hello /tra world', start: 6, end: 11, token: '/translate',
      expected: 'hello\n/translate\nworld', caret: 16,
    },
    {
      name: '行首触发 + 同行后文：仅补尾部换行',
      value: '/tra world', start: 0, end: 5, token: '/translate',
      expected: '/translate\nworld', caret: 10,
    },
    {
      name: '前文已独立成行：不补头部换行',
      value: 'hello\n/tra', start: 6, end: 10, token: '/translate',
      expected: 'hello\n/translate', caret: 16,
    },
  ])('$name', ({ value, start, end, token, expected, caret }) => {
    expect(insertChipToken(value, start, end, token)).toEqual({ value: expected, caret });
  });
});

describe('deleteChipAtCaret（Backspace 整删 chip）', () => {
  it('caret 恰在 token 行尾：删除整行（含尾部换行）', () => {
    const result = deleteChipAtCaret('/translate\nnext', [skillChip], 10);
    expect(result).toEqual({ value: 'next', caret: 0, removedChipId: skillChip.id });
  });

  it('token 行是最后一行：删除整行（含前导换行）', () => {
    const result = deleteChipAtCaret('hello\n/translate', [skillChip], 16);
    expect(result).toEqual({ value: 'hello', caret: 5, removedChipId: skillChip.id });
  });

  it('唯一一行：清空', () => {
    const result = deleteChipAtCaret('/translate', [skillChip], 10);
    expect(result).toEqual({ value: '', caret: 0, removedChipId: skillChip.id });
  });

  it.each([
    { name: 'caret 在 token 中间', value: '/translate', caret: 5 },
    { name: 'caret 不在 chip 行', value: 'next line', caret: 4 },
    { name: '行内容与 token 不完全相等（悬空 chip）', value: '/translatex', caret: 11 },
  ])('$name：返回 null 走默认 Backspace', ({ value, caret }) => {
    expect(deleteChipAtCaret(value, [skillChip], caret)).toBeNull();
  });
});

describe('serializeDraft（发送序列化）', () => {
  it('chip 行剔除出 content；三类载荷归集', () => {
    const value = `${skillChip.token}\n帮我翻译这段\n${sessionChip.token}`;
    const draft = serializeDraft(value, [skillChip, sessionChip]);
    expect(draft).toEqual({
      content: '帮我翻译这段',
      enforcedSkillIds: ['translate'],
      referencedSessionIds: ['s9'],
      assetIds: [],
    });
  });

  it('悬空 chip（token 行被手动改写）不参与发送', () => {
    const draft = serializeDraft('正文', [skillChip]);
    expect(draft.content).toBe('正文');
    expect(draft.enforcedSkillIds).toEqual([]);
  });

  it('重复载荷去重；chip-only 输入 content 为空（发送按钮应禁用）', () => {
    const dup = createChip({ kind: 'skill', token: '/translate', skillName: 'translate' });
    const draft = serializeDraft('/translate', [skillChip, dup]);
    expect(draft.enforcedSkillIds).toEqual(['translate']);
    expect(draft.content).toBe('');
  });

  it('@file chip 进 assetIds（plan A 管道消费）', () => {
    const draft = serializeDraft('@报告.pdf\n看看这个', [fileChip]);
    expect(draft.assetIds).toEqual(['a1']);
    expect(draft.content).toBe('看看这个');
  });
});

describe('annotateLines（overlay 渲染源）', () => {
  it('chip 行标记为 chip，其余原样；空行保高', () => {
    const lines = annotateLines('/translate\n\n正文', [skillChip]);
    expect(lines).toEqual([
      { type: 'chip', chip: skillChip },
      { type: 'text', text: '' },
      { type: 'text', text: '正文' },
    ]);
  });

  it('同名 token 只消费一次（与 serialize 口径一致）', () => {
    const lines = annotateLines('/translate\n/translate', [skillChip]);
    expect(lines.filter((l) => l.type === 'chip')).toHaveLength(1);
  });
});

describe('hasChipToken', () => {
  it('按 token 查重（插入去重依据）', () => {
    expect(hasChipToken([skillChip], '/translate')).toBe(true);
    expect(hasChipToken([skillChip], '/review')).toBe(false);
  });
});
```

- [ ] **Step 9.2: 运行确认失败**

Run: `pnpm --filter web exec vitest run src/components/Sender/chips/model.test.ts`
Expected: FAIL（module not found）

- [ ] **Step 9.3: 实现 model.ts**

创建 `apps/web/src/components/Sender/chips/model.ts`：

```ts
/**
 * 输入框 chip 模型（纯函数，无 React 依赖）。
 *
 * chip 在 textarea 中的承载是 token 整行：某行内容恰好等于 chip.token 时该行
 * 渲染为 chip（overlay），发送时剔除出 content 投影。段落边界约束（chip 独占
 * 一行）由 insertChipToken 的切行规则单向保证；用户手动改写 token 行会使
 * chip 悬空，序列化时自动剔除（fail-soft）。
 */

export type ChipKind = 'skill' | 'file' | 'session';

export interface InputChip {
  id: string;
  kind: ChipKind;
  /** textarea 中的整行承载文本（chip 行 = 内容恰好等于 token 的一行）。 */
  token: string;
  /** chip 展示文本。v1 = token 原文（保证 overlay 完整覆盖底层文本）。 */
  label: string;
  /** kind='skill'：skill 名（enforcedSkillIds 载荷）。 */
  skillName?: string;
  /** kind='file'：资产 id（assetIds 载荷，plan A 管道消费）。 */
  assetId?: string;
  /** kind='session'：目标会话 id（referencedSessionIds 载荷）。 */
  sessionId?: string;
}

/** 发送序列化结果（content 为剔除 chip 行后的纯文本投影）。 */
export interface SerializedDraft {
  content: string;
  enforcedSkillIds: string[];
  referencedSessionIds: string[];
  assetIds: string[];
}

/** / 命令面板条目（v1 仅 skill；kind 预留 'ui' | 'config' | 'plugin' 扩展位）。 */
export interface CommandEntry {
  id: string;
  label: string;
  description?: string;
  triggers?: string[];
  kind: 'skill';
}

/** @ 引用候选（@file 与 @会话 共用；token = '@' + 显示名）。 */
export interface ReferenceCandidate {
  id: string;
  kind: 'file' | 'session';
  title: string;
  subtitle?: string;
  token: string;
  assetId?: string;
  sessionId?: string;
}

/** 浮层面板条目（命令面板与引用选择器共用的渲染契约）。 */
export interface PaletteItem {
  key: string;
  /** 过滤匹配文本（skill 名 / 文件名 / 会话标题）。 */
  filterText: string;
  /** 主标题。 */
  title: string;
  /** 次要信息（description · triggers / 大小 / 消息数）。 */
  subtitle?: string;
  /** 类型徽标（'skill' | 'file' | 'session'）。 */
  badge: 'skill' | 'file' | 'session';
  /** 确认时插入的 chip。 */
  chip: InputChip;
}

let chipSeq = 0;

/** 构造 chip（id 仅作 React key 与删除定位，无业务语义）。 */
export function createChip(init: Omit<InputChip, 'id' | 'label'>): InputChip {
  chipSeq += 1;
  return { ...init, id: `chip-${Date.now()}-${chipSeq}`, label: init.token };
}

/** token 查重（插入去重依据：同名 token 只允许一个 chip）。 */
export function hasChipToken(chips: InputChip[], token: string): boolean {
  return chips.some((c) => c.token === token);
}

/**
 * 确认候选后插入 chip：把 [start, end) 的触发文本替换为独占一行的 token。
 *
 * 切行规则（段落边界约束）：
 * - 前文去掉行尾空白后若还有内容且不在行首，补 `\n` 切开；
 * - 后文去掉行首空白后若还有内容且不在下一行行首，补 `\n` 切开。
 * 返回新 value 与建议 caret（token 行尾）。
 */
export function insertChipToken(
  value: string,
  start: number,
  end: number,
  token: string,
): { value: string; caret: number } {
  const trimmedBefore = value.slice(0, start).replace(/[ \t]+$/, '');
  const trimmedAfter = value.slice(end).replace(/^[ \t]+/, '');
  const leadingNewline =
    trimmedBefore.length > 0 && !trimmedBefore.endsWith('\n') ? '\n' : '';
  const trailingNewline =
    trimmedAfter.length > 0 && !trimmedAfter.startsWith('\n') ? '\n' : '';
  const nextValue = `${trimmedBefore}${leadingNewline}${token}${trailingNewline}${trimmedAfter}`;
  const caret = (trimmedBefore + leadingNewline + token).length;
  return { value: nextValue, caret };
}

/**
 * Backspace 整删 chip：caret 恰在某个 chip token 行尾（该行内容完全等于
 * token）时，一次删除整行（优先连带尾部换行，否则连带前导换行）。
 * 不满足条件返回 null（走浏览器默认 Backspace）。
 */
export function deleteChipAtCaret(
  value: string,
  chips: InputChip[],
  caret: number,
): { value: string; caret: number; removedChipId: string } | null {
  if (caret <= 0) return null;
  const lineStart = value.lastIndexOf('\n', caret - 1) + 1;
  const line = value.slice(lineStart, caret);
  const chip = chips.find((c) => c.token === line);
  if (!chip) return null;

  const lineEnd = value.indexOf('\n', caret);
  const realLineEnd = lineEnd === -1 ? value.length : lineEnd;
  // 行内容必须完全等于 token（段落边界未被破坏）
  if (value.slice(lineStart, realLineEnd) !== line) return null;

  let nextValue: string;
  if (lineEnd !== -1) {
    nextValue = value.slice(0, lineStart) + value.slice(lineEnd + 1);
  } else if (lineStart > 0) {
    nextValue = value.slice(0, lineStart - 1);
  } else {
    nextValue = '';
  }
  const nextCaret = lineStart > 0 ? lineStart - 1 : 0;
  return { value: nextValue, caret: nextCaret, removedChipId: chip.id };
}

export type AnnotatedLine =
  | { type: 'chip'; chip: InputChip }
  | { type: 'text'; text: string };

/**
 * 把 textarea 值按行标注：内容恰好等于某 chip token 的行标记为 chip
 * （同名 token 只消费一次），其余为文本行。overlay 渲染与序列化共用本口径。
 */
export function annotateLines(value: string, chips: InputChip[]): AnnotatedLine[] {
  const used = new Set<string>();
  return value.split('\n').map((line) => {
    const chip = chips.find((c) => c.token === line && !used.has(c.token));
    if (chip) {
      used.add(chip.token);
      return { type: 'chip' as const, chip };
    }
    return { type: 'text' as const, text: line };
  });
}

/** 发送序列化：chip 行剔除出 content 投影；有效 chip 按类别归集（去重）。 */
export function serializeDraft(value: string, chips: InputChip[]): SerializedDraft {
  const kept = annotateLines(value, chips)
    .filter((line): line is { type: 'text'; text: string } => line.type === 'text')
    .map((line) => line.text);

  const enforcedSkillIds = new Set<string>();
  const referencedSessionIds = new Set<string>();
  const assetIds = new Set<string>();
  for (const chip of chips) {
    // 悬空 chip（token 行不存在或已被改写）不参与发送
    if (!value.split('\n').includes(chip.token)) continue;
    if (chip.kind === 'skill' && chip.skillName) enforcedSkillIds.add(chip.skillName);
    if (chip.kind === 'session' && chip.sessionId) referencedSessionIds.add(chip.sessionId);
    if (chip.kind === 'file' && chip.assetId) assetIds.add(chip.assetId);
  }

  return {
    content: kept.join('\n').trim(),
    enforcedSkillIds: [...enforcedSkillIds],
    referencedSessionIds: [...referencedSessionIds],
    assetIds: [...assetIds],
  };
}
```

- [ ] **Step 9.4: 运行确认通过**

Run: `pnpm --filter web exec vitest run src/components/Sender/chips/model.test.ts`
Expected: 全部 PASS（14 个断言组）

- [ ] **Step 9.5: Commit**

```bash
git add apps/web/src/components/Sender/chips/model.ts apps/web/src/components/Sender/chips/model.test.ts
git commit -m "feat(web): pure chip model for input commands (token-line carriage + send serialization)"
```

---

### Task 10: 触发状态机（/ 与 @，单浮层互斥）

**Files:**
- Create: `apps/web/src/components/Sender/chips/triggers.ts`
- Create: `apps/web/src/components/Sender/chips/triggers.test.ts`

- [ ] **Step 10.1: 写失败测试**

创建 `apps/web/src/components/Sender/chips/triggers.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import {
  CLOSED,
  filterCandidates,
  handleTriggerKeyDown,
  moveSelection,
  updateTriggerOnInput,
} from './triggers';

describe('updateTriggerOnInput（触发与互斥，表驱动）', () => {
  it.each([
    {
      name: '行首 /（value 开头）触发命令面板',
      value: '/', caret: 1,
      expected: { open: true, kind: 'command' as const, query: '' },
    },
    {
      name: '空格后 / 触发',
      value: 'a /', caret: 3,
      expected: { open: true, kind: 'command' as const, query: '' },
    },
    {
      name: '换行后 @ 触发引用浮层',
      value: 'hi\n@', caret: 4,
      expected: { open: true, kind: 'reference' as const, query: '' },
    },
    {
      name: '继续输入作为过滤词',
      value: '/tra', caret: 4,
      expected: { open: true, kind: 'command' as const, query: 'tra' },
    },
    {
      name: '非边界的 / 不触发（前字符为字母）',
      value: 'a/b', caret: 3,
      expected: { open: false },
    },
    {
      name: '过滤词中出现空格 → 关闭',
      value: '/a b', caret: 4,
      expected: { open: false },
    },
    {
      name: '过滤词中出现换行 → 关闭',
      value: '/a\nb', caret: 4,
      expected: { open: false },
    },
    {
      name: '单浮层互斥：先 / 后 @（空格分隔），@ 替换 /',
      value: '/a @b', caret: 5,
      expected: { open: true, kind: 'reference' as const, query: 'b' },
    },
    {
      name: 'chip token 行内的触发符不再触发（确认后面板关闭）',
      value: '/translate', caret: 10, chipTokens: ['/translate'],
      expected: { open: false },
    },
    {
      name: '普通文本不触发',
      value: 'hello world', caret: 11,
      expected: { open: false },
    },
  ])('$name', ({ value, caret, chipTokens, expected }) => {
    const state = updateTriggerOnInput(CLOSED, value, caret, chipTokens ?? []);
    if (expected.open) {
      expect(state).toMatchObject(expected);
      if (state.open) expect(typeof state.triggerStart).toBe('number');
    } else {
      expect(state).toEqual({ open: false });
    }
  });

  it('triggerStart 指向触发符位置', () => {
    const state = updateTriggerOnInput(CLOSED, 'a /tra', 6, []);
    expect(state).toMatchObject({ open: true, triggerStart: 2, query: 'tra' });
  });
});

describe('handleTriggerKeyDown（键盘路由，表驱动）', () => {
  it.each([
    { key: 'ArrowUp', open: true, expected: { type: 'move', delta: -1 } },
    { key: 'ArrowDown', open: true, expected: { type: 'move', delta: 1 } },
    { key: 'Enter', open: true, expected: { type: 'commit' } },
    { key: 'Tab', open: true, expected: { type: 'commit' } },
    { key: 'Escape', open: true, expected: { type: 'close' } },
    { key: 'a', open: true, expected: { type: 'ignore' } },
    { key: 'Enter', open: false, expected: { type: 'ignore' } },
    { key: 'Backspace', open: false, expected: { type: 'ignore' } },
  ])('$key (open=$open) → $expected.type', ({ key, open, expected }) => {
    const state = open
      ? { open: true as const, kind: 'command' as const, triggerStart: 0, query: '', selectedIndex: 0 }
      : CLOSED;
    expect(handleTriggerKeyDown(state, key)).toEqual(expected);
  });
});

describe('moveSelection', () => {
  const open = { open: true as const, kind: 'command' as const, triggerStart: 0, query: '', selectedIndex: 0 };

  it('下移与上移', () => {
    expect(moveSelection({ ...open, selectedIndex: 0 }, 1, 3).selectedIndex).toBe(1);
    expect(moveSelection({ ...open, selectedIndex: 1 }, -1, 3).selectedIndex).toBe(0);
  });

  it('越界回绕（循环导航）', () => {
    expect(moveSelection({ ...open, selectedIndex: 2 }, 1, 3).selectedIndex).toBe(0);
    expect(moveSelection({ ...open, selectedIndex: 0 }, -1, 3).selectedIndex).toBe(2);
  });

  it('空候选列表恒为 0；关闭态原样返回', () => {
    expect(moveSelection({ ...open }, 1, 0).selectedIndex).toBe(0);
    expect(moveSelection(CLOSED, 1, 3)).toBe(CLOSED);
  });
});

describe('filterCandidates', () => {
  const items = [
    { filterText: 'translate' },
    { filterText: 'code-review' },
    { filterText: '调研记录' },
  ];

  it('大小写不敏感子串匹配', () => {
    expect(filterCandidates(items, 'TRANS')).toEqual([items[0]]);
    expect(filterCandidates(items, 'review')).toEqual([items[1]]);
  });

  it('空查询返回全量；中文匹配', () => {
    expect(filterCandidates(items, '')).toEqual(items);
    expect(filterCandidates(items, '调研')).toEqual([items[2]]);
  });
});
```

- [ ] **Step 10.2: 运行确认失败**

Run: `pnpm --filter web exec vitest run src/components/Sender/chips/triggers.test.ts`
Expected: FAIL（module not found）

- [ ] **Step 10.3: 实现 triggers.ts**

创建 `apps/web/src/components/Sender/chips/triggers.ts`：

```ts
/**
 * `/` 与 `@` 的触发状态机（纯函数，无 React 依赖）。
 *
 * 单浮层互斥：状态只有一个 open 槽位，后触发者替换先触发者
 * （设计开放问题 2 的采纳结论）。键盘语义：↑↓ 移动、Enter/Tab 确认、
 * Esc 关闭；面板关闭时所有按键 ignore（走 textarea 默认行为）。
 */

export type TriggerKind = 'command' | 'reference';

export type TriggerState =
  | { open: false }
  | {
      open: true;
      kind: TriggerKind;
      /** 触发符（'/' 或 '@'）在 textarea 值中的位置。 */
      triggerStart: number;
      /** 触发符之后至 caret 的过滤词（不含触发符）。 */
      query: string;
      /** 当前选中候选下标（候选列表由组件层按 query 过滤后传入）。 */
      selectedIndex: number;
    };

export const CLOSED: TriggerState = { open: false };

/**
 * 输入后重算触发状态。规则：
 * - 从 caret 向左扫描：遇到 `/` 或 `@` 判定边界（位于 value 开头 / 行首 /
 *   前一字符为空格）→ 打开面板，query = 触发符到 caret 的连续文本；
 * - 遇到空白（空格/换行）终止扫描 → 关闭（过滤词被空格打断）；
 * - 遇到非边界触发符 → 关闭（如 `a/b`）；
 * - chip token 行内的触发符不触发（确认 chip 后面板应关闭，且用户点进
 *   chip 行编辑时不应弹出面板）——由 chipTokens 参数排除。
 */
export function updateTriggerOnInput(
  _state: TriggerState,
  value: string,
  caret: number,
  chipTokens: readonly string[] = [],
): TriggerState {
  let i = caret - 1;
  while (i >= 0) {
    const ch = value[i]!;
    if (ch === '/' || ch === '@') {
      const prev = i > 0 ? value[i - 1]! : '';
      const atBoundary = prev === '' || prev === '\n' || prev === ' ';
      if (!atBoundary) return CLOSED;

      // chip token 行整体是已确认的 chip：不再触发
      const lineEnd = value.indexOf('\n', i);
      const lineText = value.slice(i, lineEnd === -1 ? value.length : lineEnd);
      if (chipTokens.includes(lineText)) return CLOSED;

      const kind: TriggerKind = ch === '/' ? 'command' : 'reference';
      return {
        open: true,
        kind,
        triggerStart: i,
        query: value.slice(i + 1, caret),
        selectedIndex: 0,
      };
    }
    if (/\s/.test(ch)) return CLOSED;
    i -= 1;
  }
  return CLOSED;
}

export type TriggerKeyAction =
  | { type: 'ignore' }
  | { type: 'move'; delta: -1 | 1 }
  | { type: 'commit' }
  | { type: 'close' };

/** 面板打开时的键盘路由；面板关闭时一律 ignore。 */
export function handleTriggerKeyDown(state: TriggerState, key: string): TriggerKeyAction {
  if (!state.open) return { type: 'ignore' };
  switch (key) {
    case 'ArrowUp':
      return { type: 'move', delta: -1 };
    case 'ArrowDown':
      return { type: 'move', delta: 1 };
    case 'Enter':
    case 'Tab':
      return { type: 'commit' };
    case 'Escape':
      return { type: 'close' };
    default:
      return { type: 'ignore' };
  }
}

/** 移动选中项（越界回绕）；空候选恒为 0；关闭态原样返回。 */
export function moveSelection(
  state: TriggerState,
  delta: -1 | 1,
  itemCount: number,
): TriggerState {
  if (!state.open) return state;
  const next = state.selectedIndex + delta;
  const clamped = itemCount <= 0 ? 0 : (next + itemCount) % itemCount;
  return { ...state, selectedIndex: clamped };
}

/** 候选过滤：大小写不敏感子串匹配（空查询返回全量）。 */
export function filterCandidates<T extends { filterText: string }>(
  items: T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((item) => item.filterText.toLowerCase().includes(q));
}
```

- [ ] **Step 10.4: 运行确认通过**

Run: `pnpm --filter web exec vitest run src/components/Sender/chips/triggers.test.ts`
Expected: 全部 PASS

- [ ] **Step 10.5: Commit**

```bash
git add apps/web/src/components/Sender/chips/triggers.ts apps/web/src/components/Sender/chips/triggers.test.ts
git commit -m "feat(web): trigger state machine for / and @ (single-layer mutual exclusion)"
```

---

### Task 11: Overlay + 命令面板 / 引用选择器 + Sender 集成

**Files:**
- Create: `apps/web/src/components/Sender/ChipsOverlay.tsx`
- Create: `apps/web/src/components/Sender/CommandPalette.tsx`
- Create: `apps/web/src/components/Sender/ReferencePicker.tsx`
- Create: `apps/web/src/components/Sender/hooks/useChipInput.ts`
- Modify: `apps/web/src/components/Sender/Sender.tsx`
- Create: `apps/web/src/components/Sender/CommandPalette.test.tsx`

**plan A 协调（资产候选）:** 本任务的 `@file` 候选经 `api.listAssets()` 获取（plan A 的资产列表端点）。若执行时该端点/函数不存在（plan A 未落地或未提供列表接口），按头部协调块处理：删除 assets 相关行，`ReferencePicker` 只保留会话候选，并在执行记录中注明。

- [ ] **Step 11.1: 实现 ChipsOverlay**

创建 `apps/web/src/components/Sender/ChipsOverlay.tsx`：

```tsx
// ChipsOverlay - chip 覆盖层
// 与 textarea 同字体/同内边距/同行高的镜像层：chip token 行渲染为 chip 胶囊
// （不透明，完整覆盖底层 token 文本），其余行渲染透明文本以保持行位对齐。
// chip 展示文本 = token 原文（Task 9 模型约束：保证覆盖宽度不小于底层文本）。

import { annotateLines, type InputChip } from './chips/model'

export default function ChipsOverlay({ value, chips }: { value: string; chips: InputChip[] }) {
    if (chips.length === 0) return null

    return (
        <div
            aria-hidden
            className="pointer-events-none absolute inset-0 p-2 text-base leading-6 whitespace-pre-wrap break-words text-transparent"
        >
            {annotateLines(value, chips).map((line, i) => (
                <div key={i} className="min-h-6">
                    {line.type === 'chip' ? (
                        <span className="inline-flex h-5 max-w-full items-center truncate rounded-md border border-primary-200 bg-primary-50 px-1.5 align-baseline text-xs leading-5 text-primary-700">
                            {line.chip.label}
                        </span>
                    ) : (
                        <span>{line.text.length > 0 ? line.text : '\u00A0'}</span>
                    )}
                </div>
            ))}
        </div>
    )
}
```

- [ ] **Step 11.2: 实现 CommandPalette**

创建 `apps/web/src/components/Sender/CommandPalette.tsx`：

```tsx
// CommandPalette - / 命令面板（skill 目录：name / description / triggers）
// 纯展示组件：候选过滤与键盘状态由 useChipInput 持有，本组件只渲染 + 上报。

import type { PaletteItem } from './chips/model'

interface CommandPaletteProps {
    items: PaletteItem[]
    selectedIndex: number
    query: string
    onSelect: (index: number) => void
    onHover: (index: number) => void
}

export default function CommandPalette({ items, selectedIndex, query, onSelect, onHover }: CommandPaletteProps) {
    return (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-lg border border-border-base bg-bg-elevated shadow-lg">
            <div className="border-b border-border-base px-3 py-1.5 text-xs text-text-tertiary">
                命令 <span className="font-mono">/{query}</span>
            </div>
            {items.length === 0 ? (
                <div className="px-3 py-3 text-sm text-text-tertiary">无匹配的 skill</div>
            ) : (
                <ul>
                    {items.map((item, index) => (
                        <li key={item.key}>
                            <button
                                type="button"
                                onClick={() => onSelect(index)}
                                onMouseEnter={() => onHover(index)}
                                className={`flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left transition-colors ${
                                    index === selectedIndex ? 'bg-primary-50' : 'hover:bg-bg-hover'
                                }`}
                            >
                                <span className="font-mono text-sm text-text-primary">{item.title}</span>
                                {item.subtitle && (
                                    <span className="line-clamp-2 text-xs text-text-secondary">{item.subtitle}</span>
                                )}
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    )
}
```

- [ ] **Step 11.3: 实现 ReferencePicker**

创建 `apps/web/src/components/Sender/ReferencePicker.tsx`：

```tsx
// ReferencePicker - @ 引用浮层（@file 资产 + @会话 两类对象合并列表）
// 纯展示组件；badge 区分对象类型（file / session）。

import type { PaletteItem } from './chips/model'

interface ReferencePickerProps {
    items: PaletteItem[]
    selectedIndex: number
    query: string
    onSelect: (index: number) => void
    onHover: (index: number) => void
}

const BADGE_LABEL: Record<string, string> = {
    file: '文件',
    session: '会话',
}

export default function ReferencePicker({ items, selectedIndex, query, onSelect, onHover }: ReferencePickerProps) {
    return (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-lg border border-border-base bg-bg-elevated shadow-lg">
            <div className="border-b border-border-base px-3 py-1.5 text-xs text-text-tertiary">
                引用 <span className="font-mono">@{query}</span>
            </div>
            {items.length === 0 ? (
                <div className="px-3 py-3 text-sm text-text-tertiary">无匹配的文件或会话</div>
            ) : (
                <ul>
                    {items.map((item, index) => (
                        <li key={item.key}>
                            <button
                                type="button"
                                onClick={() => onSelect(index)}
                                onMouseEnter={() => onHover(index)}
                                className={`flex w-full items-center gap-2 px-3 py-2 text-left transition-colors ${
                                    index === selectedIndex ? 'bg-primary-50' : 'hover:bg-bg-hover'
                                }`}
                            >
                                <span className="shrink-0 rounded bg-bg-secondary px-1.5 py-0.5 text-xs text-text-secondary">
                                    {BADGE_LABEL[item.badge] ?? item.badge}
                                </span>
                                <span className="min-w-0 flex-1">
                                    <span className="block truncate text-sm text-text-primary">{item.title}</span>
                                    {item.subtitle && (
                                        <span className="block truncate text-xs text-text-tertiary">{item.subtitle}</span>
                                    )}
                                </span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    )
}
```

- [ ] **Step 11.4: 实现 useChipInput hook**

创建 `apps/web/src/components/Sender/hooks/useChipInput.ts`：

```ts
// useChipInput - / 与 @ 的输入接线 hook
// 持有 textarea 文本、chip 数组与触发面板状态；键盘语义：
// 面板打开时 ↑↓/Enter/Tab/Esc 归面板，Backspace 优先整删 chip，
// 面板关闭时 Enter（无 Shift）提交发送。纯逻辑全部委托 chips/model 与
// chips/triggers（两处均有表驱动测试），本 hook 只做状态编排。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  type CommandEntry,
  type InputChip,
  type PaletteItem,
  type ReferenceCandidate,
  type SerializedDraft,
  createChip,
  deleteChipAtCaret,
  hasChipToken,
  insertChipToken,
  serializeDraft,
} from '../chips/model'
import {
  CLOSED,
  type TriggerState,
  filterCandidates,
  handleTriggerKeyDown,
  moveSelection,
  updateTriggerOnInput,
} from '../chips/triggers'

export interface UseChipInputOptions {
    /** / 命令候选（skill 有效集，调用方经 api.fetchEffectiveSkills 获取）。 */
    skills: CommandEntry[]
    /** @ 引用候选（资产 + 会话，调用方组装）。 */
    references: ReferenceCandidate[]
    /**
     * 提交发送。返回 false 表示前置校验未过（不清空输入）；
     * 返回 true 后 hook 清空文本与 chips（乐观清空，异步错误由调用方 toast）。
     */
    onSend: (draft: SerializedDraft) => boolean
}

export function useChipInput({ skills, references, onSend }: UseChipInputOptions) {
    const [content, setContent] = useState('')
    const [chips, setChips] = useState<InputChip[]>([])
    const [trigger, setTrigger] = useState<TriggerState>(CLOSED)
    const textareaRef = useRef<HTMLTextAreaElement | null>(null)
    const pendingCaretRef = useRef<number | null>(null)

    // 程序化改值后的 caret 恢复（chip 插入 / 整删之后）
    useEffect(() => {
        if (pendingCaretRef.current === null) return
        const caret = pendingCaretRef.current
        pendingCaretRef.current = null
        const ta = textareaRef.current
        if (ta) {
            requestAnimationFrame(() => ta.setSelectionRange(caret, caret))
        }
    }, [content])

    /** 候选 → 面板条目（command 与 reference 两类）。 */
    const items = useMemo<PaletteItem[]>(() => {
        if (trigger.open && trigger.kind === 'command') {
            return skills.map((s) => ({
                key: `skill-${s.id}`,
                filterText: s.label,
                title: s.label,
                subtitle:
                    [s.description, s.triggers && s.triggers.length > 0 ? `triggers: ${s.triggers.join(', ')}` : undefined]
                        .filter(Boolean)
                        .join(' · ') || undefined,
                badge: 'skill' as const,
                chip: createChip({ kind: 'skill', token: `/${s.label}`, skillName: s.label }),
            }))
        }
        if (trigger.open && trigger.kind === 'reference') {
            return references.map((r) => ({
                key: `${r.kind}-${r.id}`,
                filterText: r.title,
                title: r.title,
                subtitle: r.subtitle,
                badge: r.kind,
                chip: createChip({ kind: r.kind, token: r.token, assetId: r.assetId, sessionId: r.sessionId }),
            }))
        }
        return []
        // trigger.query 变化即重建（createChip 每次生成新 id，仅在确认时入 state，无稳定性问题）
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [trigger.open, trigger.kind, skills, references])

    const candidates = useMemo(
        () => (trigger.open ? filterCandidates(items, trigger.query) : []),
        [items, trigger],
    )

    const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const value = e.target.value
        const caret = e.target.selectionStart ?? value.length
        setContent(value)
        setTrigger((prev) => updateTriggerOnInput(prev, value, caret, chips.map((c) => c.token)))
    }, [chips])

    const insertItem = useCallback((item: PaletteItem) => {
        const token = item.chip.token
        // token 唯一约束：同名 chip 已存在则仅关面板
        if (hasChipToken(chips, token)) {
            setTrigger(CLOSED)
            return
        }
        const ta = textareaRef.current
        const caret = ta ? (ta.selectionStart ?? content.length) : content.length
        const start = trigger.open ? trigger.triggerStart : caret
        const next = insertChipToken(content, start, caret, token)
        setContent(next.value)
        setChips((prev) => [...prev, item.chip])
        setTrigger(CLOSED)
        pendingCaretRef.current = next.caret
    }, [chips, content, trigger])

    const submit = useCallback(() => {
        const draft = serializeDraft(content, chips)
        if (!draft.content) return
        if (onSend(draft)) {
            setContent('')
            setChips([])
            setTrigger(CLOSED)
        }
    }, [chips, content, onSend])

    const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        const ta = e.currentTarget
        const caret = ta.selectionStart ?? 0

        // Backspace 优先整删 chip（caret 无选区时）
        if (e.key === 'Backspace' && ta.selectionStart === ta.selectionEnd) {
            const deletion = deleteChipAtCaret(content, chips, caret)
            if (deletion) {
                e.preventDefault()
                setContent(deletion.value)
                setChips((prev) => prev.filter((c) => c.id !== deletion.removedChipId))
                setTrigger(CLOSED)
                pendingCaretRef.current = deletion.caret
                return
            }
        }

        const action = handleTriggerKeyDown(trigger, e.key)
        if (action.type === 'move') {
            e.preventDefault()
            setTrigger((prev) => moveSelection(prev, action.delta, candidates.length))
        } else if (action.type === 'commit') {
            e.preventDefault()
            const item = candidates[trigger.open ? trigger.selectedIndex : 0]
            if (item) insertItem(item)
            else setTrigger(CLOSED)
        } else if (action.type === 'close') {
            e.preventDefault()
            setTrigger(CLOSED)
        } else if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            submit()
        }
    }, [candidates, chips, content, insertItem, submit, trigger])

    const selectItem = useCallback((index: number) => {
        const item = candidates[index]
        if (item) insertItem(item)
    }, [candidates, insertItem])

    const hoverItem = useCallback((index: number) => {
        setTrigger((prev) => (prev.open ? { ...prev, selectedIndex: index } : prev))
    }, [])

    const reset = useCallback(() => {
        setContent('')
        setChips([])
        setTrigger(CLOSED)
    }, [])

    const setTextareaRef = useCallback((el: HTMLTextAreaElement | null) => {
        textareaRef.current = el
    }, [])

    const draft = useMemo(() => serializeDraft(content, chips), [content, chips])

    return {
        content,
        chips,
        trigger,
        candidates,
        draft,
        handleInput,
        handleKeyDown,
        selectItem,
        hoverItem,
        reset,
        setTextareaRef,
    }
}
```

- [ ] **Step 11.5: 写 CommandPalette 组件测试**

创建 `apps/web/src/components/Sender/CommandPalette.test.tsx`：

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import CommandPalette from './CommandPalette'
import type { PaletteItem } from './chips/model'

const items: PaletteItem[] = [
    { key: 's1', filterText: 'translate', title: 'translate', subtitle: '翻译文本 · triggers: 翻译', badge: 'skill', chip: {} as never },
    { key: 's2', filterText: 'code-review', title: 'code-review', subtitle: '代码评审', badge: 'skill', chip: {} as never },
]

describe('CommandPalette', () => {
    it('renders items with title/subtitle and highlights selectedIndex', () => {
        render(
            <CommandPalette items={items} selectedIndex={1} query="re" onSelect={vi.fn()} onHover={vi.fn()} />,
        )
        expect(screen.getByText('translate')).toBeTruthy()
        expect(screen.getByText('code-review')).toBeTruthy()
        expect(screen.getByText('翻译文本 · triggers: 翻译')).toBeTruthy()
        // 选中项有高亮类
        const selected = screen.getByText('code-review').closest('button')
        expect(selected?.className).toContain('bg-primary-50')
    })

    it('click invokes onSelect with the index', () => {
        const onSelect = vi.fn()
        render(<CommandPalette items={items} selectedIndex={0} query="" onSelect={onSelect} onHover={vi.fn()} />)
        fireEvent.click(screen.getByText('code-review'))
        expect(onSelect).toHaveBeenCalledWith(1)
    })

    it('empty items renders the no-match hint', () => {
        render(<CommandPalette items={[]} selectedIndex={0} query="zzz" onSelect={vi.fn()} onHover={vi.fn()} />)
        expect(screen.getByText('无匹配的 skill')).toBeTruthy()
    })
})
```

Run: `pnpm --filter web exec vitest run src/components/Sender/CommandPalette.test.tsx`
Expected: 全部 PASS（组件为纯展示，随实现一起交付——先写实现 11.2 再跑此步）

- [ ] **Step 11.6: Sender 集成**

`apps/web/src/components/Sender/Sender.tsx` 修改点：

1. import 区追加：

```tsx
import { useEffect, useMemo, useState } from 'react'
import { api } from '../../api'
import CommandPalette from './CommandPalette'
import ReferencePicker from './ReferencePicker'
import ChipsOverlay from './ChipsOverlay'
import { useChipInput } from './hooks/useChipInput'
import type { CommandEntry, ReferenceCandidate, SerializedDraft } from './chips/model'
```

（既有 `import { useState } from 'react'` 行删除，由上面统一导入。）

2. 组件内数据源（`useAttachments` 之后）：

```tsx
    // / 命令候选：skill 有效集（GET /api/skills/effective，与 buildSkillInjections 同源）
    const [skillEntries, setSkillEntries] = useState<CommandEntry[]>([])
    useEffect(() => {
        let active = true
        api.fetchEffectiveSkills()
            .then((metas) => {
                if (active) {
                    setSkillEntries(
                        metas.map((m) => ({
                            id: m.id,
                            label: m.name,
                            description: m.description,
                            triggers: m.triggers,
                            kind: 'skill' as const,
                        })),
                    )
                }
            })
            .catch(() => {
                if (active) setSkillEntries([])
            })
        return () => {
            active = false
        }
    }, [])

    // plan A 协调点：资产列表端点。未就绪时删除本段（引用浮层退化为仅 @会话）。
    interface AssetListItem { id: string; name: string; size: number }
    const [assets, setAssets] = useState<AssetListItem[]>([])
    useEffect(() => {
        let active = true
        api.listAssets()
            .then((list: AssetListItem[]) => {
                if (active) setAssets(list)
            })
            .catch(() => {})
        return () => {
            active = false
        }
    }, [])

    // @ 引用候选：资产（文件名）在前、会话（标题，排除当前会话）在后
    const sessionSummaries = useSessionStore((s) => s.sessionSummaries)
    const references = useMemo<ReferenceCandidate[]>(() => {
        const files: ReferenceCandidate[] = assets.map((a) => ({
            id: a.id,
            kind: 'file' as const,
            title: a.name,
            subtitle: `${Math.max(1, Math.round(a.size / 1024))} KB`,
            token: `@${a.name}`,
            assetId: a.id,
        }))
        const sessions: ReferenceCandidate[] = sessionSummaries
            .filter((s) => s.id !== selectedSessionId)
            .map((s) => ({
                id: s.id,
                kind: 'session' as const,
                title: s.title,
                subtitle: `${s.messageCount} 条消息`,
                token: `@${s.title}`,
                sessionId: s.id,
            }))
        return [...files, ...sessions]
    }, [assets, sessionSummaries, selectedSessionId])
```

3. 发送回调（替换原 `handleSend` 的守卫部分；实际 `sendMessage` 调用与参数序列化在 Task 12 落地，此处先保持既有调用形态）：

```tsx
    const handleChipSubmit = (draft: SerializedDraft): boolean => {
        if (isSending || isJobActive) {
            return false
        }
        if (!selectedSessionId) {
            showMessageAlert.warning('请先创建新对话')
            return false
        }
        if (!hasModel) {
            showMessageAlert.warning('请先选择模型')
            return false
        }

        const messageFiles: File[] = attachments.map((a) => a.file)
        clearAttachments()

        void sendMessage({
            sessionId: selectedSessionId,
            content: draft.content,
            files: messageFiles.length > 0 ? messageFiles : undefined,
        }).catch((error) => {
            console.error('Failed to send message:', error)
            showMessageAlert.error(getErrorMessage(error))
        })
        return true
    }
```

4. chip 输入接线。**顺序关键（TDZ）**：`handleChipSubmit`（第 3 点）必须在 hook 之前定义，而 `useTextareaAutoHeight(content)` 需要 hook 的 `content`——把原第 26 行 `const textareaRef = useTextareaAutoHeight(content);` 移到 hook 调用之后，hook 调用插在 `handleChipSubmit` 定义之后：

```tsx
    const {
        content, chips, trigger, candidates, draft,
        handleInput, handleKeyDown, selectItem, hoverItem, reset, setTextareaRef,
    } = useChipInput({ skills: skillEntries, references, onSend: handleChipSubmit })
    const textareaRef = useTextareaAutoHeight(content)
```

   并删除原有的 `const [content, setContent] = useState('')`、`handleSend`、`handleKeyDown`、`handleInput`（由 hook 提供）；`resetSender` 改为：

```tsx
    const resetSender = () => {
        reset()
        clearAttachments()
    }
```

5. 输入区改造——textarea 包一层 relative 容器，挂 overlay 与浮层，统一 `text-base leading-6` 保证 overlay 行位对齐：

```tsx
                    <div className="relative flex-1 min-w-0">
                        <ChipsOverlay value={content} chips={chips} />
                        <textarea
                            ref={(el) => {
                                textareaRef.current = el
                                setTextareaRef(el)
                            }}
                            value={content}
                            onChange={handleInput}
                            onKeyDown={handleKeyDown}
                            className="block w-full p-2 text-base leading-6 focus:outline-none bg-transparent text-text-primary placeholder:text-text-tertiary resize-none overflow-hidden min-h-[24px] max-h-[200px] transition-all duration-300"
                            placeholder={selectedSessionId ? 'Enter your message（/ 命令 · @ 引用）' : '请先创建新对话'}
                            rows={1}
                            disabled={!selectedSessionId}
                        />
                        {trigger.open && trigger.kind === 'command' && (
                            <CommandPalette
                                items={candidates}
                                selectedIndex={trigger.selectedIndex}
                                query={trigger.query}
                                onSelect={selectItem}
                                onHover={hoverItem}
                            />
                        )}
                        {trigger.open && trigger.kind === 'reference' && (
                            <ReferencePicker
                                items={candidates}
                                selectedIndex={trigger.selectedIndex}
                                query={trigger.query}
                                onSelect={selectItem}
                                onHover={hoverItem}
                            />
                        )}
                    </div>
```

6. 发送按钮禁用条件改用投影（chips 不计入可发送性——纯 chip 无正文不可发送）：

```tsx
                        disabled={!draft.content || !selectedSessionId || isJobActive}
```

- [ ] **Step 11.7: 运行测试 + 类型检查**

Run: `pnpm --filter web exec vitest run src/components/Sender && pnpm --filter web exec tsc --noEmit`
Expected: 全部 PASS；类型检查通过（若 `api.listAssets` 报不存在，按 plan A 协调块处理：删除 assets 段并保留会话候选）

- [ ] **Step 11.8: Commit**

```bash
git add apps/web/src/components/Sender/ChipsOverlay.tsx apps/web/src/components/Sender/CommandPalette.tsx apps/web/src/components/Sender/ReferencePicker.tsx apps/web/src/components/Sender/hooks/useChipInput.ts apps/web/src/components/Sender/Sender.tsx apps/web/src/components/Sender/CommandPalette.test.tsx
git commit -m "feat(web): chip overlay, command palette and reference picker wired into Sender"
```

---

### Task 12: 客户端发送序列化（sendMessage 参数链路）

**Files:**
- Modify: `apps/web/src/api/real.ts:87-124`（sendMessage）
- Modify: `apps/web/src/store/sessionStore.ts:153`（接口）、`:440-473`（实现）
- Modify: `apps/web/src/components/Sender/Sender.tsx`（handleChipSubmit 参数补全）
- Test: `apps/web/src/store/sessionStore.test.ts`（回归，确认零破坏）

- [ ] **Step 12.1: 扩展 real.ts sendMessage（plan A JSON 形态）**

`apps/web/src/api/real.ts` 的 `sendMessage` 替换为（SSE/JSON 双模式判定逻辑保持原样）：

```ts
/**
 * Send a message and receive either an SSE stream or a background job id.
 * POST /api/sessions/:sessionId/messages
 *
 * Body: JSON（plan A 切换后形态）——content + 可选 assetIds / enforcedSkillIds /
 * referencedSessionIds（/ 与 @ 的 chip 载荷）。
 */
export async function sendMessage(params: {
    sessionId: string;
    content: string;
    /** plan A 资产化完成前的兼容参数（届时由 assetIds 取代并移除）；JSON 形态下忽略。 */
    files?: File[];
    assetIds?: string[];
    enforcedSkillIds?: string[];
    referencedSessionIds?: string[];
}): Promise<SendMessageResult> {
    const { sessionId, content, assetIds, enforcedSkillIds, referencedSessionIds } = params;
    void files; // JSON 形态不携带原始文件（兼容期保留参数位，见 JSDoc）

    const response = await fetchWithAuth(`/api/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            content,
            ...(assetIds && assetIds.length > 0 ? { assetIds } : {}),
            ...(enforcedSkillIds && enforcedSkillIds.length > 0 ? { enforcedSkillIds } : {}),
            ...(referencedSessionIds && referencedSessionIds.length > 0 ? { referencedSessionIds } : {}),
        }),
        timeout: 120000,
    });

    // （以下 async/JSON 判定与 SSE 流返回逻辑保持原样，不改）
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
        const parsed = (await response.json()) as { data?: { jobId?: string } };
        const jobId = parsed?.data?.jobId;
        if (jobId) {
            return { mode: 'async', jobId };
        }
        throw new StreamError('Unexpected JSON response without jobId');
    }

    if (!response.body) {
        throw new StreamError('Response body is empty');
    }

    return { mode: 'stream', stream: response.body };
}
```

**降级形态（本计划先于 plan A 执行时）:** 保持 FormData，追加两个数组字段：

```ts
    const formData = new FormData();
    formData.append('content', content);
    if (enforcedSkillIds?.length) formData.append('enforcedSkillIds', JSON.stringify(enforcedSkillIds));
    if (referencedSessionIds?.length) formData.append('referencedSessionIds', JSON.stringify(referencedSessionIds));
```

（与 Task 8 的 multipart 降级形态配对。）

- [ ] **Step 12.2: 扩展 sessionStore.sendMessage**

`apps/web/src/store/sessionStore.ts`：

1. 第 153 行接口替换为：

```ts
    sendMessage: (params: {
        sessionId: string;
        content: string;
        files?: File[];
        assetIds?: string[];
        enforcedSkillIds?: string[];
        referencedSessionIds?: string[];
    }) => Promise<void>;
```

2. 第 440 行实现的解构改为 `async ({ sessionId, content, files, assetIds, enforcedSkillIds, referencedSessionIds }) => {`，`api.sendMessage` 调用（第 472 行）改为（`files` 原样保留透传——兼容期参数位，见 Step 12.1 JSDoc）：

```ts
                const result = await api.sendMessage({
                    sessionId: realSessionId,
                    content,
                    ...(files && files.length > 0 ? { files } : {}),
                    ...(assetIds && assetIds.length > 0 ? { assetIds } : {}),
                    ...(enforcedSkillIds && enforcedSkillIds.length > 0 ? { enforcedSkillIds } : {}),
                    ...(referencedSessionIds && referencedSessionIds.length > 0 ? { referencedSessionIds } : {}),
                });
```

   （本地乐观 `userMessage` 保持纯 content 投影——chip 不进本地消息缓存，与 DB 侧一致。）

- [ ] **Step 12.3: Sender.handleChipSubmit 补全参数**

`apps/web/src/components/Sender/Sender.tsx` 的 `handleChipSubmit` 中 `sendMessage` 调用替换为：

```tsx
        void sendMessage({
            sessionId: selectedSessionId,
            content: draft.content,
            files: messageFiles.length > 0 ? messageFiles : undefined,
            assetIds: draft.assetIds.length > 0 ? draft.assetIds : undefined,
            enforcedSkillIds: draft.enforcedSkillIds.length > 0 ? draft.enforcedSkillIds : undefined,
            referencedSessionIds: draft.referencedSessionIds.length > 0 ? draft.referencedSessionIds : undefined,
        }).catch((error) => {
            console.error('Failed to send message:', error)
            showMessageAlert.error(getErrorMessage(error))
        })
```

   （plan A 已把 `useAttachments` 切到 AssetRef 时，`files` 相关行随其改造移除，其余不变。）

- [ ] **Step 12.4: web 全量回归**

Run: `pnpm --filter web test && pnpm --filter web exec tsc --noEmit`
Expected: 全部 PASS（`sessionStore.test.ts` 既有用例零回归——新增参数全部可选）

- [ ] **Step 12.5: Commit**

```bash
git add apps/web/src/api/real.ts apps/web/src/store/sessionStore.ts apps/web/src/components/Sender/Sender.tsx
git commit -m "feat(web): serialize chips into send params (enforcedSkillIds/referencedSessionIds/assetIds)"
```

---

### Task 13: 全量验证 + 手动验收 + 文档状态

- [ ] **Step 13.1: 全仓类型检查 + 全部测试 + lint**

Run: `pnpm typecheck`
Expected: PASS

Run: `pnpm --filter server test && pnpm --filter web test`
Expected: 全部 PASS（重点关注 `lifecycle.test.ts`、`agent-loop-handler.test.ts`、`messages.test.ts`、`runner.test.ts`、`chips/*.test.ts`）

Run: `pnpm lint`
Expected: PASS

- [ ] **Step 13.2: 手动验收（pnpm dev）**

验收清单：
1. `/` 空输入行首触发 → 面板列出启用 skill（name/description/triggers）；继续输入过滤；↑↓ 循环；Enter/Tab/鼠标确认 → 折叠为 chip；Esc 关闭
2. `@` 触发 → 引用浮层（文件 + 会话两类徽标）；选中会话 → chip `@会话标题`；当前会话不出现在候选
3. chip 独占一行：行中触发确认后前文/后文被切行；`Backspace` 在 chip 右侧一次删除整 chip
4. 单浮层互斥：`/a ` 后接 `@b` → 面板切换为引用
5. 发送：chip 行不出现在发出的消息正文；服务端日志确认（或临时在 `assembleMessagesV2` 打印）——`/skill` 轮次 skill 全文进 "Always apply these skills" 段；`@会话` 轮次 user 消息前缀含 `[用户引用了会话《…》的摘要]` 块、且模型可见 `read_session` 工具（无引用轮次不可见）
6. `AGENT_ASYNC_MODE=true` 重启 server 重复第 5 步（worker 链路同样生效）
7. 无摘要的引用会话 → 注入块为降级拼接（消息数 + 首尾片段）
8. 普通消息（无 chip）行为与现状逐字节一致

- [ ] **Step 13.3: 更新设计文档状态**

`docs/2026-09-30-input-commands-design.md` 头部状态行改为：

```markdown
**状态：** 已实施（实施计划 `docs/2026-09-30-input-commands-plan.md`）
```

```bash
git add docs/2026-09-30-input-commands-design.md docs/2026-09-30-input-commands-plan.md
git commit -m "docs: mark input commands design as implemented"
```

---

## 规格覆盖自查（写给执行者）

| 设计文档条目 | 任务 |
|---|---|
| `/` 触发状态机（行首/空格后触发、过滤、↑↓/Enter/Tab/Esc、鼠标点选） | Task 10 + Task 11 |
| `/` chip 化（不进 content、Backspace 整删） | Task 9（insertChipToken/deleteChipAtCaret）+ Task 11 |
| 命令注册表 `CommandEntry`（kind 预留扩展位；来源 = 有效 skill 集） | Task 9（类型）+ Task 3/Task 11（数据源 `GET /api/skills/effective`） |
| 面板展示 name / description / triggers（可发现性） | Task 11（CommandPalette subtitle） |
| `SendMessageParams` 扩展（enforcedSkillIds / referencedSessionIds） | Task 1 |
| enforcedSkillIds 走 always 全文注入、双链路传递 + P0 教训测试 | Task 2（合并）+ Task 7（双链路 + 测试） |
| `@` 触发状态机与 `/` 相同；两类对象浮层 | Task 10 + Task 11（ReferencePicker） |
| `@file` 候选（资产按文件名）→ assetIds（走 plan A 管道） | Task 9（file chip → assetIds）+ Task 11（候选源）+ Task 12（序列化） |
| `@会话` 候选（按标题、排除当前会话） | Task 11（sessionSummaries 过滤） |
| `@会话` 第一层：getLatestSummary 固定格式注入 + fail-soft 降级拼接 | Task 4 + Task 6 |
| `@会话` 第二层：read_session（safe、sessionId 参数、全量 + 降级链截断） | Task 5 |
| read_session 仅当携带 referencedSessionIds 时动态注册 | Task 5（registry advertised 开关）+ Task 6（runner 单点追加） |
| 输入框 overlay chips（chip 限段落边界整行） | Task 9（token 整行模型）+ Task 11（ChipsOverlay） |
| 发送时 chip 行剔除、chips 分别进参数 | Task 9（serializeDraft）+ Task 12 |
| 粘贴/拖拽图片与 chip 系统互不干扰 | 不改动上传管道（plan A 范围），Task 11/12 保持 `files` 通道并行 |
| 单浮层互斥（后触发者替换） | Task 10（状态机单槽 + 测试） |
| 开放问题 1（read_session 分页）：采纳 v1 全量 + 降级链兜底 | Task 5（64k 安全阀 + 既有 2000 字符降级链） |
| 开放问题 2（键盘冲突）：单浮层互斥 | Task 10 |
| 开放问题 3（`/` 是否展示未绑定 skill）：否，与有效集一致 | Task 3（effective 端点 = listSkills enabled，与注入同源） |

**明确不在本计划内（防执行者顺手实现）:**
- UI 型 / 配置型命令（`/settings`、`/agent xxx`）——`CommandEntry.kind` 仅留扩展位
- `@tool` / `@MCP` 授权引用、`@skill`（用户决策：skill 只走 `/`）
- 富文本编辑器（Lexical / Slate / ProseMirror）
- `@file` 全库语义搜索（v1 仅文件名/标题子串匹配）
- 资产存储 / parser 资产化 / MessagePart / 能力三态门控 / useAttachments 切 AssetRef（全部归 plan A）
- contentRef 悬停预览 / 点击打开（content-panel 设计）
- read_session 分页参数（offset/limit）
- diy-agent 白名单落地（届时在 `listEffectiveSkillMetas` / `buildSkillInjections` 单点升级为「绑定 ∩ 全局启用」）
