# 双栏内容面板（标签页 / 内容注册表 / PanelHost）实施计划

> **执行记录（执行时追加）：** _（本节由执行者填写：与原文的偏差、迁移/编号竞态、终审修复等。）_

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把前端从单栏对话升级为「左对话（控制通道）+ 右内容栏（观察/操作通道）」：双类标签页（全局 rail / 会话标签条）、contentRef + ContentRenderer 注册表、五个内置渲染器（图片/Markdown/代码/纯文本/PDF）、agent trace 全量视图、PanelHost SDK（bilibili 卡片协议的面板化推广）与 manifest `provides.panels` 声明。

**Architecture:** 布局改动收敛在 `MainView` 容器层（新增 `ContentPanel` 组件承载右栏，lg 断点以下退化为全屏覆盖层）；标签页状态进 `contentPanelStore`（globalTabs 经 zustand persist 持久化、sessionTabs 挂 sessionId 内存态、激活策略由 origin 驱动）；内容渲染经 `ContentRef → ContentRenderer 注册表 → 懒加载组件` 解析；插件面板由新组件 `PanelHost` 以扩展后的 postMessage 协议（mount/update/activate/deactivate + resize + theme + 受控导航 + protocolVersion 握手）驱动，现有 `PluginCardHost` 卡片路径行为不变（仅抽出入口缓存为共享模块）；trace 视图消费现有 `attachTimelines` 产物 + 新增 `GET /api/sessions/:id/tool-approvals` 审批记录读取；manifest 在 shared 类型与两份 schema 拷贝件中同步 `provides.panels`。

**Tech Stack:** React 19 + Zustand 5（persist middleware）+ TailwindCSS 4、pdfjs-dist（新增，web）、@testing-library/react（web 组件测试）、Hono + better-sqlite3（审批记录只读路由）、Ajv（manifest 校验）、`@my-copilot/shared` 类型。

**规格来源:** `docs/2026-09-30-content-panel-design.md`（设计定稿，决策记录已经用户确认）

**关键设计决策（已锁定，源自设计文档决策记录）:**
- 内容栏容器形态 = **标签页**；两类分离：全局 = 左侧竖排图标 rail（IDE 活动栏心智），会话 = 内容栏顶部横排 tab 条，不混排
- 激活策略 = 用户动作触发 → 激活并切换；系统 push → 只创建 tab + unread 角标，**不抢焦点**（双栏核心体验契约）
- 插件面板技术形态 = **扩展沙箱 iframe 协议**（PanelHost SDK），不加载任意前端组件进宿主；host API bridge 为协议扩展位，**v1 不实现**
- contentRef 三变体（`asset` / `trace` / `panel`），去重键 = 规范化序列化；postMessage 消息类型一经发布即公共 API（新增可以，改名/改语义禁止）
- 向后兼容硬约束：仅声明 `frontendEntry` 而无 `panels` 的存量插件（bilibili-search）只做消息流卡片渲染，**完全不受影响**
- 会话 tab 栈 v1 内存态（跨刷新不恢复）；tab 上限 12（设计开放问题 4 的建议值），LRU 淘汰 `pinned` 除外
- 协议版本 v1 = 单调整数 `1`（设计开放问题 1 的建议方案）

**与既有代码事实的两处对齐（执行前必读）:**
- 设计文档 manifest 一节标注「`frontendEntry`……类型未定义」**已过时**：`packages/shared/src/plugin.ts` 已有 `FrontendEntry`（含 `PluginProvides.frontendEntry`），两份 schema 拷贝件（`docs/rfc/schemas/plugin.manifest.schema.json` 与 `apps/server/src/plugin/schemas/` 同名文件）也已含 `frontendEntry`。因此本计划 manifest 任务（Task 10）**只新增 `panels`**，不动 `frontendEntry`。
- 设计文档「审批记录（tool_approvals）」在纯前端时间线数据中不存在（审批记录只落服务端 `tool_approvals` 表，SSE 流不回放）。为兑现该展示项且不动 SSE 协议，本计划新增一个只读路由 `GET /api/sessions/:id/tool-approvals`（Task 8）——这是对设计「数据源：现有 attachTimelines 产物」的最小服务端补充。

**与附件资产层计划的执行顺序协调（重要）:**
- `docs/2026-09-30-attachment-assets-multimodal-design.md`（下称 plan A）提供 `GET /api/assets/:id/meta` 与 `/raw` 端点。本计划 Task 5 在 web 侧新增这两个端点的客户端函数，**代码与单测不依赖 plan A 已执行**（单测全部 mock API；取数失败时渲染器降级，不崩溃）；但**资产预览的手动/端到端验收前置：plan A 已执行**。
- 本计划不重定义 plan A 的类型（`MessagePart` / `Asset`）：web 侧仅定义视图投影 `AssetMetaDto`（字段名对齐 plan A 的 assets 表 `name/mime_type/kind` 的 camelCase 形态）；plan A 落地后可原地切换为直接引用 shared `Asset`（字段同名，只改 import 与返回类型标注）。
- 布局 / store / 注册表 / 标签栏 / PanelHost / trace / manifest 任务与 plan A 完全独立，可先行执行。

**新依赖说明（项目规则要求）:** `pdfjs-dist`（web）——Mozilla pdf.js 的官方发行包，自带类型；PDF 渲染的唯一现实选项（浏览器无内嵌 PDF 编程接口，`<embed>` 无法做暗色一致与受控分页）。选 `pdfjs-dist` + 自写薄封装（动态 import 独立 chunk + `?url` worker，永不进主 bundle）而非 `react-pdf`：后者是在 pdf.js 上再包一层 class 组件封装（多余抽象、版本滞后、worker 配置反而更绕）。本计划的封装总量约 120 行，可控。

**命令约定（均在仓库根 `F:\MyProjects\MyCopilot` 执行）:**
- 定向测试：`pnpm --filter web exec vitest run <路径>` / `pnpm --filter server exec vitest run <路径>`
- 全量验证：`pnpm typecheck && pnpm --filter server test && pnpm --filter web test && pnpm lint`
- 每个 Task 完成且定向测试通过后提交一次（conventional commit）；若所在会话约定不自动提交，跳过 commit 步骤

---

### Task 1: contentRef 类型与规范化序列化

**Files:**
- Create: `apps/web/src/types/content.ts`
- Create: `apps/web/src/types/content.test.ts`

**说明:** 纯前端类型（不进 `@my-copilot/shared`——server 不消费）。内建全局标签页（agent 状态 / 未来的文件库）复用 `panel` 变体 + 保留命名空间 `__host__`，**不扩展判别联合**（保持设计文档锁定的三变体）。

- [ ] **Step 1.1: 写失败测试**

创建 `apps/web/src/types/content.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import {
  contentRefKey,
  agentStatusRef,
  HOST_PANEL_PLUGIN_ID,
  HOST_PANEL_AGENT_STATUS,
} from './content';

describe('contentRefKey', () => {
  it('asset 按 assetId 规范化', () => {
    expect(contentRefKey({ type: 'asset', assetId: 'a1' })).toBe('asset:a1');
  });

  it('trace 无 messageId 时折叠为会话级 key；有 messageId 时包含之（两个 key 不相等）', () => {
    expect(contentRefKey({ type: 'trace', sessionId: 's1' })).toBe('trace:s1');
    expect(contentRefKey({ type: 'trace', sessionId: 's1', messageId: 'm1' })).toBe('trace:s1:m1');
  });

  it('panel 按 pluginId + panelId 规范化', () => {
    expect(contentRefKey({ type: 'panel', pluginId: 'p1', panelId: 'lib' })).toBe('panel:p1:lib');
  });

  it('内建 agent 状态引用落在保留命名空间', () => {
    const ref = agentStatusRef();
    expect(ref).toEqual({
      type: 'panel',
      pluginId: HOST_PANEL_PLUGIN_ID,
      panelId: HOST_PANEL_AGENT_STATUS,
    });
    expect(contentRefKey(ref)).toBe('panel:__host__:agent-status');
  });
});
```

- [ ] **Step 1.2: 运行确认失败**

Run: `pnpm --filter web exec vitest run src/types/content.test.ts`
Expected: FAIL（module not found）

- [ ] **Step 1.3: 实现 content.ts**

创建 `apps/web/src/types/content.ts`：

```ts
// content.ts — 内容栏的内容引用协议（content-panel 设计）。
//
// 统一的内容引用：附件资产预览（asset）/ agent 过程视图（trace）/ 插件面板
// （panel）。四个入口（附件点击、timeline 展开、@ 引用预览、插件导航）都
// 产出 ContentRef，经 contentPanelStore.openTab 以规范化序列化去重后进入
// 内容栏。纯前端类型：不进 @my-copilot/shared（server 不消费）。

/** 宿主内建面板的保留 pluginId（agent 状态 / 未来的文件库等非插件全局标签页）。 */
export const HOST_PANEL_PLUGIN_ID = '__host__';

/** 内建全局面板 id：agent 状态。 */
export const HOST_PANEL_AGENT_STATUS = 'agent-status';

/**
 * 内容引用判别联合。去重键 = contentRefKey 的规范化序列化。
 * 预留扩展（设计文档同款预留）：| { type: 'artifact'; artifactId: string }。
 */
export type ContentRef =
  | { type: 'asset'; assetId: string }
  | { type: 'trace'; sessionId: string; messageId?: string }
  | { type: 'panel'; pluginId: string; panelId: string };

/** 规范化序列化：同一内容（不论构造方式）得到同一 key，供标签页去重。 */
export function contentRefKey(ref: ContentRef): string {
  switch (ref.type) {
    case 'asset':
      return `asset:${ref.assetId}`;
    case 'trace':
      return ref.messageId === undefined
        ? `trace:${ref.sessionId}`
        : `trace:${ref.sessionId}:${ref.messageId}`;
    case 'panel':
      return `panel:${ref.pluginId}:${ref.panelId}`;
  }
}

/** 内建「agent 状态」面板引用（全局标签页 push / rail 常驻入口）。 */
export function agentStatusRef(): ContentRef {
  return {
    type: 'panel',
    pluginId: HOST_PANEL_PLUGIN_ID,
    panelId: HOST_PANEL_AGENT_STATUS,
  };
}
```

- [ ] **Step 1.4: 运行确认通过**

Run: `pnpm --filter web exec vitest run src/types/content.test.ts`
Expected: PASS（4 个用例）

- [ ] **Step 1.5: Commit**

```bash
git add apps/web/src/types/content.ts apps/web/src/types/content.test.ts
git commit -m "feat(web): contentRef protocol with canonical dedup key for content panel"
```

---

### Task 2: contentPanelStore（双类标签页 / 激活策略 / LRU / 持久化）

**Files:**
- Create: `apps/web/src/store/contentPanelStore.ts`
- Create: `apps/web/src/store/contentPanelStore.test.ts`
- Modify: `apps/web/src/store/sessionStore.ts`（会话删除时清理其标签栈）

**说明:** 激活策略在 store 内实现为唯一规则：`origin === 'user'` → 激活 + 展开内容栏；`origin === 'system'` → 只建 tab + `unread` 角标、不激活。实施补充（设计状态模型之外的最小扩展，需在执行记录中注明）：`activeScope` 记录最近激活的标签类，内容区据此在全局/会话两条激活轨道中二选一显示。

- [ ] **Step 2.1: 写失败测试**

创建 `apps/web/src/store/contentPanelStore.test.ts`：

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useContentPanelStore, MAX_TABS_PER_SCOPE, tabIdForRef } from './contentPanelStore';
import type { ContentRef } from '../types/content';

const assetRef = (assetId: string): ContentRef => ({ type: 'asset', assetId });

function reset() {
  useContentPanelStore.setState({
    globalTabs: [],
    sessionTabs: {},
    activeGlobalTabId: null,
    activeSessionTabId: {},
    activeScope: 'global',
    panelOpen: false,
  });
}

describe('contentPanelStore', () => {
  beforeEach(() => reset());

  it('用户打开：建 tab + 激活 + 展开内容栏', () => {
    const tabId = useContentPanelStore.getState().openTab({
      ref: assetRef('a1'),
      title: '图片 a1',
      scope: 'global',
      origin: 'user',
    });
    const s = useContentPanelStore.getState();
    expect(s.globalTabs).toHaveLength(1);
    expect(s.globalTabs[0].tabId).toBe(tabId);
    expect(s.activeGlobalTabId).toBe(tabId);
    expect(s.panelOpen).toBe(true);
  });

  it('系统 push：建 tab + unread 角标，不激活、不抢焦点', () => {
    useContentPanelStore.getState().openTab({ ref: assetRef('a1'), title: 'T', scope: 'global', origin: 'user' });
    useContentPanelStore.getState().openTab({ ref: assetRef('a2'), title: 'P', scope: 'global', origin: 'system' });
    const s = useContentPanelStore.getState();
    expect(s.globalTabs).toHaveLength(2);
    expect(s.globalTabs.find((t) => t.ref.type === 'asset' && t.ref.assetId === 'a2')?.unread).toBe(true);
    expect(s.activeGlobalTabId).toBe(tabIdForRef(assetRef('a1'))); // 焦点未变
  });

  it('去重：同 ref 复用 tab；system → user 重复打开升格 origin 并清角标', () => {
    useContentPanelStore.getState().openTab({ ref: assetRef('a1'), title: 'T', scope: 'global', origin: 'system' });
    useContentPanelStore.getState().openTab({ ref: assetRef('a1'), title: 'T', scope: 'global', origin: 'user' });
    const s = useContentPanelStore.getState();
    expect(s.globalTabs).toHaveLength(1);
    expect(s.globalTabs[0].origin).toBe('user');
    expect(s.globalTabs[0].unread).toBe(false);
    expect(s.activeGlobalTabId).toBe(s.globalTabs[0].tabId);
  });

  it('LRU：超过上限淘汰 openedAt 最旧的非 pinned 条目；pinned 豁免', () => {
    const open = useContentPanelStore.getState().openTab;
    for (let i = 0; i < MAX_TABS_PER_SCOPE; i++) {
      open({ ref: assetRef(`a${i}`), title: `t${i}`, scope: 'global', origin: 'user' });
    }
    expect(useContentPanelStore.getState().globalTabs).toHaveLength(MAX_TABS_PER_SCOPE);

    // 钉住最旧的 a0，再开一个新 tab → 淘汰次旧的 a1
    useContentPanelStore.getState().togglePin('global', tabIdForRef(assetRef('a0')));
    useContentPanelStore.getState().openTab({ ref: assetRef('new'), title: 'n', scope: 'global', origin: 'user' });
    const s = useContentPanelStore.getState();
    expect(s.globalTabs).toHaveLength(MAX_TABS_PER_SCOPE);
    expect(s.globalTabs.some((t) => t.ref.type === 'asset' && t.ref.assetId === 'a0')).toBe(true);
    expect(s.globalTabs.some((t) => t.ref.type === 'asset' && t.ref.assetId === 'a1')).toBe(false);
  });

  it('closeTab：关闭激活 tab 时回退到剩余最新（列表首项）', () => {
    const open = useContentPanelStore.getState().openTab;
    const id1 = open({ ref: assetRef('a1'), title: '1', scope: 'global', origin: 'user' });
    open({ ref: assetRef('a2'), title: '2', scope: 'global', origin: 'user' });
    useContentPanelStore.getState().closeTab('global', tabIdForRef(assetRef('a2')));
    const s = useContentPanelStore.getState();
    expect(s.globalTabs).toHaveLength(1);
    expect(s.activeGlobalTabId).toBe(id1);
  });

  it('sessionTabs 按 sessionId 分栈；setActiveTab 清 unread；clearSessionTabs 清栈', () => {
    const open = useContentPanelStore.getState().openTab;
    open({ ref: { type: 'trace', sessionId: 's1', messageId: 'm1' }, title: 'trace', scope: 'session', sessionId: 's1', origin: 'user' });
    open({ ref: { type: 'trace', sessionId: 's2', messageId: 'm2' }, title: 'trace', scope: 'session', sessionId: 's2', origin: 'user' });
    expect(useContentPanelStore.getState().sessionTabs['s1']).toHaveLength(1);
    expect(useContentPanelStore.getState().sessionTabs['s2']).toHaveLength(1);

    const t = useContentPanelStore.getState().openTab({ ref: assetRef('x'), title: 'x', scope: 'session', sessionId: 's1', origin: 'system' });
    useContentPanelStore.getState().setActiveTab('session', t, 's1');
    expect(useContentPanelStore.getState().sessionTabs['s1'].find((e) => e.tabId === t)?.unread).toBe(false);
    expect(useContentPanelStore.getState().activeScope).toBe('session');

    useContentPanelStore.getState().clearSessionTabs('s1');
    expect(useContentPanelStore.getState().sessionTabs['s1']).toBeUndefined();
    expect(useContentPanelStore.getState().sessionTabs['s2']).toHaveLength(1);
  });

  it('removePluginTabs 只移除指定插件的 panel 标签页（global + session）', () => {
    const open = useContentPanelStore.getState().openTab;
    open({ ref: { type: 'panel', pluginId: 'p1', panelId: 'lib' }, title: 'L', scope: 'global', origin: 'user' });
    open({ ref: { type: 'panel', pluginId: 'p2', panelId: 'lib' }, title: 'L2', scope: 'global', origin: 'user' });
    open({ ref: { type: 'panel', pluginId: 'p1', panelId: 'run' }, title: 'R', scope: 'session', sessionId: 's1', origin: 'user' });
    useContentPanelStore.getState().removePluginTabs('p1');
    const s = useContentPanelStore.getState();
    expect(s.globalTabs).toHaveLength(1);
    expect(s.globalTabs[0].ref).toEqual({ type: 'panel', pluginId: 'p2', panelId: 'lib' });
    expect(s.sessionTabs['s1']).toHaveLength(0);
  });

  it('持久化只覆盖全局轨道（partialize）', () => {
    useContentPanelStore.getState().openTab({ ref: assetRef('a1'), title: 'T', scope: 'global', origin: 'user' });
    useContentPanelStore.getState().openTab({ ref: assetRef('s'), title: 'S', scope: 'session', sessionId: 's1', origin: 'user' });
    const raw = localStorage.getItem('mycopilot-content-panel');
    expect(raw).toBeDefined();
    const persisted = JSON.parse(raw!) as { state: { globalTabs?: unknown[]; sessionTabs?: unknown } };
    expect(persisted.state.globalTabs).toHaveLength(1);
    expect(persisted.state.sessionTabs).toBeUndefined();
  });
});
```

- [ ] **Step 2.2: 运行确认失败**

Run: `pnpm --filter web exec vitest run src/store/contentPanelStore.test.ts`
Expected: FAIL（module not found）

- [ ] **Step 2.3: 实现 contentPanelStore.ts**

创建 `apps/web/src/store/contentPanelStore.ts`：

```ts
// Zustand - 内容栏标签页状态（content-panel 设计）
//
// 双类标签页：globalTabs（app 级持久化，localStorage）/ sessionTabs（挂
// sessionId，内存态，跨刷新不恢复）。激活策略（双栏核心体验契约）：
// origin='user' → 激活并展开内容栏；origin='system' → 只建 tab + unread
// 角标，不抢焦点。每类上限 MAX_TABS_PER_SCOPE，超限 LRU 淘汰 openedAt
// 最旧的未 pinned 条目。实施补充（设计状态模型之外的最小扩展）：activeScope
// 记录最近激活的标签类，内容区据此在全局/会话两条激活轨道中二选一显示。

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { contentRefKey, type ContentRef } from '../types/content';

/** 每类标签页数量上限（设计开放问题 4：默认 12；溢出收进下拉列表）。 */
export const MAX_TABS_PER_SCOPE = 12;

export type ContentPanelScope = 'global' | 'session';

export interface TabEntry {
    tabId: string;
    /** 去重键来源：contentRefKey(ref)（tabId 与之稳定对应）。 */
    ref: ContentRef;
    title: string;
    icon?: string;
    /** 激活策略依据：'user' 用户动作触发；'system' 系统 push。 */
    origin: 'user' | 'system';
    /** 用户钉住：永不 LRU 淘汰。 */
    pinned?: boolean;
    /** system push 未读角标；激活时清除。 */
    unread?: boolean;
    /** LRU 时间戳（openTab / 激活时刷新）。 */
    openedAt: number;
}

export interface OpenTabInput {
    ref: ContentRef;
    title: string;
    icon?: string;
    scope: ContentPanelScope;
    /** session 类必填（global 类忽略）。 */
    sessionId?: string;
    origin: 'user' | 'system';
}

interface ContentPanelState {
    globalTabs: TabEntry[];
    sessionTabs: Record<string, TabEntry[]>;
    activeGlobalTabId: string | null;
    activeSessionTabId: Record<string, string | null>;
    /** 最近激活的标签类（内容区显示轨道）。 */
    activeScope: ContentPanelScope;
    /** 内容栏整体开合（用户可折叠；用户打开 tab 时自动展开）。 */
    panelOpen: boolean;

    /** 打开（或去重复用）标签页，返回稳定 tabId。 */
    openTab: (input: OpenTabInput) => string;
    closeTab: (scope: ContentPanelScope, tabId: string, sessionId?: string) => void;
    setActiveTab: (scope: ContentPanelScope, tabId: string, sessionId?: string) => void;
    togglePin: (scope: ContentPanelScope, tabId: string, sessionId?: string) => void;
    setPanelOpen: (open: boolean) => void;
    /** 会话删除时清理其标签栈（设计开放问题 2：随 sessionId 键自然失效）。 */
    clearSessionTabs: (sessionId: string) => void;
    /** 插件禁用/卸载后移除其面板标签页（global + session 全部）。 */
    removePluginTabs: (pluginId: string) => void;
}

/** 稳定 tabId：同一 contentRef 永远同一 tabId（去重复用 + closeTab 自识别）。 */
export function tabIdForRef(ref: ContentRef): string {
    return `tab-${contentRefKey(ref)}`;
}

/** LRU 淘汰：超过上限时移除 openedAt 最旧的未 pinned 条目（全部 pinned 则停止）。 */
function evictLRU(tabs: TabEntry[]): TabEntry[] {
    const next = [...tabs];
    while (next.length > MAX_TABS_PER_SCOPE) {
        let victim = -1;
        for (let i = 0; i < next.length; i++) {
            if (next[i].pinned) continue;
            if (victim === -1 || next[i].openedAt < next[victim].openedAt) victim = i;
        }
        if (victim === -1) break;
        next.splice(victim, 1);
    }
    return next;
}

/** 打开（或复用）一条 tab：去重键命中 → 复用并升格/刷新；未命中 → 前插新条目并 LRU。 */
function openInTabs(tabs: TabEntry[], input: OpenTabInput, tabId: string): TabEntry[] {
    const isUser = input.origin === 'user';
    if (tabs.some((t) => t.tabId === tabId)) {
        return tabs.map((t) =>
            t.tabId === tabId
                ? {
                      ...t,
                      // 用户重复打开视为确认：origin 升格 user、清角标
                      origin: isUser ? ('user' as const) : t.origin,
                      unread: isUser ? false : t.unread,
                      openedAt: Date.now(),
                  }
                : t,
        );
    }
    const entry: TabEntry = {
        tabId,
        ref: input.ref,
        title: input.title,
        icon: input.icon,
        origin: input.origin,
        unread: !isUser,
        openedAt: Date.now(),
    };
    return evictLRU([entry, ...tabs]);
}

/** 淘汰后修正激活 id：被淘汰则回退到列表首项（最近打开）。 */
function fixedActive(tabs: TabEntry[], prevActiveId: string | null): string | null {
    if (prevActiveId === null) return null;
    return tabs.some((t) => t.tabId === prevActiveId) ? prevActiveId : (tabs[0]?.tabId ?? null);
}

export const useContentPanelStore = create<ContentPanelState>()(
    persist(
        (set, get) => ({
            globalTabs: [],
            sessionTabs: {},
            activeGlobalTabId: null,
            activeSessionTabId: {},
            activeScope: 'global',
            panelOpen: false,

            openTab: (input) => {
                const tabId = tabIdForRef(input.ref);
                const isUser = input.origin === 'user';

                if (input.scope === 'global') {
                    const state = get();
                    const globalTabs = openInTabs(state.globalTabs, input, tabId);
                    if (isUser) {
                        set({ globalTabs, activeGlobalTabId: tabId, activeScope: 'global', panelOpen: true });
                    } else {
                        // system push：不激活不抢焦点；仅当激活 tab 被 LRU 淘汰时回退
                        set({ globalTabs, activeGlobalTabId: fixedActive(globalTabs, state.activeGlobalTabId) });
                    }
                    return tabId;
                }

                const sid = input.sessionId ?? '';
                const state = get();
                const tabs = openInTabs(state.sessionTabs[sid] ?? [], input, tabId);
                const prevActive = state.activeSessionTabId[sid] ?? null;
                set({
                    sessionTabs: { ...state.sessionTabs, [sid]: tabs },
                    activeSessionTabId: isUser
                        ? { ...state.activeSessionTabId, [sid]: tabId }
                        : { ...state.activeSessionTabId, [sid]: fixedActive(tabs, prevActive) },
                    ...(isUser ? { activeScope: 'session' as const, panelOpen: true } : {}),
                });
                return tabId;
            },

            closeTab: (scope, tabId, sessionId) => {
                if (scope === 'global') {
                    set((state) => {
                        const globalTabs = state.globalTabs.filter((t) => t.tabId !== tabId);
                        return {
                            globalTabs,
                            activeGlobalTabId:
                                state.activeGlobalTabId === tabId
                                    ? (globalTabs[0]?.tabId ?? null)
                                    : state.activeGlobalTabId,
                        };
                    });
                    return;
                }
                const sid = sessionId ?? '';
                set((state) => {
                    const tabs = (state.sessionTabs[sid] ?? []).filter((t) => t.tabId !== tabId);
                    const prevActive = state.activeSessionTabId[sid] ?? null;
                    return {
                        sessionTabs: { ...state.sessionTabs, [sid]: tabs },
                        activeSessionTabId: {
                            ...state.activeSessionTabId,
                            [sid]: prevActive === tabId ? (tabs[0]?.tabId ?? null) : prevActive,
                        },
                    };
                });
            },

            setActiveTab: (scope, tabId, sessionId) => {
                if (scope === 'global') {
                    set((state) => ({
                        activeGlobalTabId: tabId,
                        activeScope: 'global',
                        panelOpen: true,
                        globalTabs: state.globalTabs.map((t) =>
                            t.tabId === tabId ? { ...t, unread: false, openedAt: Date.now() } : t,
                        ),
                    }));
                    return;
                }
                const sid = sessionId ?? '';
                set((state) => ({
                    activeScope: 'session',
                    panelOpen: true,
                    activeSessionTabId: { ...state.activeSessionTabId, [sid]: tabId },
                    sessionTabs: {
                        ...state.sessionTabs,
                        [sid]: (state.sessionTabs[sid] ?? []).map((t) =>
                            t.tabId === tabId ? { ...t, unread: false, openedAt: Date.now() } : t,
                        ),
                    },
                }));
            },

            togglePin: (scope, tabId, sessionId) => {
                const mapFn = (t: TabEntry): TabEntry => (t.tabId === tabId ? { ...t, pinned: !t.pinned } : t);
                if (scope === 'global') {
                    set((state) => ({ globalTabs: state.globalTabs.map(mapFn) }));
                    return;
                }
                const sid = sessionId ?? '';
                set((state) => ({
                    sessionTabs: { ...state.sessionTabs, [sid]: (state.sessionTabs[sid] ?? []).map(mapFn) },
                }));
            },

            setPanelOpen: (open) => set({ panelOpen: open }),

            clearSessionTabs: (sessionId) =>
                set((state) => {
                    const sessionTabs = { ...state.sessionTabs };
                    delete sessionTabs[sessionId];
                    const activeSessionTabId = { ...state.activeSessionTabId };
                    delete activeSessionTabId[sessionId];
                    return { sessionTabs, activeSessionTabId };
                }),

            removePluginTabs: (pluginId) =>
                set((state) => ({
                    globalTabs: state.globalTabs.filter(
                        (t) => !(t.ref.type === 'panel' && t.ref.pluginId === pluginId),
                    ),
                    sessionTabs: Object.fromEntries(
                        Object.entries(state.sessionTabs).map(([sid, tabs]) => [
                            sid,
                            tabs.filter((t) => !(t.ref.type === 'panel' && t.ref.pluginId === pluginId)),
                        ]),
                    ),
                })),
        }),
        {
            name: 'mycopilot-content-panel',
            storage: createJSONStorage(() => localStorage),
            // 只持久化全局轨道（sessionTabs / activeSessionTabId / panelOpen / activeScope 均为内存态）
            partialize: (state) => ({
                globalTabs: state.globalTabs,
                activeGlobalTabId: state.activeGlobalTabId,
            }),
        },
    ),
);
```

- [ ] **Step 2.4: 运行确认通过**

Run: `pnpm --filter web exec vitest run src/store/contentPanelStore.test.ts`
Expected: PASS（8 个用例）

- [ ] **Step 2.5: 会话删除时清理标签栈（sessionStore 接线）**

`apps/web/src/store/sessionStore.ts` 修改两点：

1. 文件头部 import 区（`import { api } from '../api';` 之后）加：

```ts
import { useContentPanelStore } from './contentPanelStore';
```

2. `deleteSessionSummary` 末尾（`set((state) => {...})` 调用之后）追加一行：

```ts
        deleteSessionSummary: (id) => {
            set((state) => {
                const newCache = { ...state.messagesCache };
                delete newCache[id];
                return {
                    sessionSummaries: state.sessionSummaries.filter(s => s.id !== id),
                    messagesCache: newCache,
                    currentSession: state.currentSession?.id === id ? null : state.currentSession,
                };
            });
            // 会话删除 → 其会话标签栈随之清理（content-panel 设计开放问题 2）
            useContentPanelStore.getState().clearSessionTabs(id);
        },
```

（`contentPanelStore` 不 import `sessionStore`，无循环依赖。）

- [ ] **Step 2.6: store 回归**

Run: `pnpm --filter web exec vitest run src/store`
Expected: 全部 PASS（contentPanelStore 新增 + sessionStore 既有用例零回归；jsdom 默认提供 localStorage，persist 中间件无障碍）

- [ ] **Step 2.7: Commit**

```bash
git add apps/web/src/store/contentPanelStore.ts apps/web/src/store/contentPanelStore.test.ts apps/web/src/store/sessionStore.ts
git commit -m "feat(web): contentPanelStore — dual-scope tabs, activation policy, LRU cap, persistence"
```

---

### Task 3: ContentRenderer 注册表

**Files:**
- Create: `apps/web/src/components/ContentPanel/registry.ts`
- Create: `apps/web/src/components/ContentPanel/registry.test.ts`

**说明:** 注册表是内容引用 → 渲染组件的唯一解析点。`render()` 返回 `Promise<ComponentType>`（各渲染器内部用动态 import，Vite 自动分包）；`priority` 解决同 ref 多渲染器竞争（内置 100/90/10、插件面板兜底 0——Task 9 注册）。

- [ ] **Step 3.1: 写失败测试**

创建 `apps/web/src/components/ContentPanel/registry.test.ts`：

```ts
import { describe, it, expect, afterEach } from 'vitest';
import {
  registerContentRenderer,
  resolveContentRenderer,
  clearContentRenderers,
  type ContentRenderer,
} from './registry';
import type { ContentRef } from '../../types/content';

const anything = (): ContentRenderer => ({
  canHandle: () => true,
  render: () => Promise.resolve(() => null),
});

afterEach(() => clearContentRenderers());

describe('ContentRenderer 注册表', () => {
  it('无匹配渲染器时返回 null', () => {
    const ref: ContentRef = { type: 'asset', assetId: 'a1' };
    expect(resolveContentRenderer(ref, { mime: 'application/pdf' })).toBeNull();
  });

  it('canHandle 过滤 + 唯一命中', () => {
    const onlyImage: ContentRenderer = {
      canHandle: (ref, meta) => ref.type === 'asset' && (meta?.mime ?? '').startsWith('image/'),
      render: () => Promise.resolve(() => null),
    };
    registerContentRenderer(onlyImage);
    expect(resolveContentRenderer({ type: 'asset', assetId: 'a' }, { mime: 'image/png' })).toBe(onlyImage);
    expect(resolveContentRenderer({ type: 'asset', assetId: 'a' }, { mime: 'text/plain' })).toBeNull();
  });

  it('多渲染器竞争时 priority 大者优先；并列取后注册者', () => {
    const low = { ...anything(), priority: 10 };
    const high = { ...anything(), priority: 100 };
    registerContentRenderer(low);
    registerContentRenderer(high);
    expect(resolveContentRenderer({ type: 'asset', assetId: 'a' })).toBe(high);

    const sameHigh = { ...anything(), priority: 100 };
    registerContentRenderer(sameHigh);
    expect(resolveContentRenderer({ type: 'asset', assetId: 'a' })).toBe(sameHigh);
  });

  it('重复注册新实例后解析到新实例（后注册覆盖）', () => {
    const r = anything();
    registerContentRenderer(r);
    expect(resolveContentRenderer({ type: 'asset', assetId: 'a' })).toBe(r);
    const again = { ...anything(), priority: 5 };
    registerContentRenderer(again);
    expect(resolveContentRenderer({ type: 'asset', assetId: 'a' })).toBe(again);
  });
});
```

- [ ] **Step 3.2: 运行确认失败**

Run: `pnpm --filter web exec vitest run src/components/ContentPanel/registry.test.ts`
Expected: FAIL（module not found）

- [ ] **Step 3.3: 实现 registry.ts**

创建 `apps/web/src/components/ContentPanel/registry.ts`：

```ts
// registry.ts — ContentRenderer 注册表（content-panel 设计）。
//
// 内容引用 → 渲染组件 的解析点：canHandle 声明能力（ref + 资产 meta 投影），
// render() 懒加载组件（各渲染器内部动态 import，Vite 自动分包），priority
// 解决同 ref 多渲染器竞争（大者优先；内置 100/90/10，插件面板兜底 0——
// 插件渲染器默认低于内置，见设计文档）。

import type { ComponentType } from 'react';
import type { ContentRef } from '../../types/content';

/** 资产元数据的视图投影（不直接依赖附件资产层计划的 shared Asset，见计划头部说明）。 */
export interface AssetMetaView {
    id: string;
    name?: string;
    mime?: string;
    kind?: string;
}

/** 渲染组件的统一 props（React 19 ref-as-prop）。 */
export interface ContentRendererProps {
    ref: ContentRef;
    /** asset 类由 ContentHost 取 meta 后注入；其余 undefined。 */
    meta?: AssetMetaView;
}

export interface ContentRenderer {
    /** 声明可处理的 contentRef / 资产 meta。 */
    canHandle(ref: ContentRef, meta?: AssetMetaView): boolean;
    /** 渲染组件（懒加载）。 */
    render: () => Promise<ComponentType<ContentRendererProps>>;
    /** 同 ref 多渲染器时的优先级，大者优先；缺省 0。 */
    priority?: number;
}

const renderers: ContentRenderer[] = [];

/** 注册渲染器（同一实例重复注册为原地替换）。 */
export function registerContentRenderer(renderer: ContentRenderer): void {
    const idx = renderers.indexOf(renderer);
    if (idx >= 0) {
        renderers[idx] = renderer;
    } else {
        renderers.push(renderer);
    }
}

/** 解析：canHandle 过滤后取 priority 最大者；并列取后注册者。 */
export function resolveContentRenderer(ref: ContentRef, meta?: AssetMetaView): ContentRenderer | null {
    let best: ContentRenderer | null = null;
    for (const r of renderers) {
        if (!r.canHandle(ref, meta)) continue;
        if (best === null || (r.priority ?? 0) >= (best.priority ?? 0)) best = r;
    }
    return best;
}

/** 测试隔离用：清空注册表。 */
export function clearContentRenderers(): void {
    renderers.length = 0;
}
```

- [ ] **Step 3.4: 运行确认通过**

Run: `pnpm --filter web exec vitest run src/components/ContentPanel/registry.test.ts`
Expected: PASS（4 个用例）

- [ ] **Step 3.5: Commit**

```bash
git add apps/web/src/components/ContentPanel/registry.ts apps/web/src/components/ContentPanel/registry.test.ts
git commit -m "feat(web): ContentRenderer registry with priority resolution"
```

---

### Task 4: MainView 双栏改造 + ContentPanel 容器（响应式）

**Files:**
- Create: `apps/web/src/components/ContentPanel/hooks/useMediaQuery.ts`
- Create: `apps/web/src/components/ContentPanel/index.tsx`
- Create: `apps/web/src/components/ContentPanel/index.test.tsx`
- Modify: `apps/web/src/views/MainView.tsx`
- Create: `apps/web/src/views/MainView.test.tsx`

**说明:** 布局改动收敛在 `MainView` 容器层，`MessageList` / `Sender` / `ChatShell` 内部不动。断点 `lg`（≥1024px，对齐 Tailwind lg）以上 = 右侧常驻栏；以下 = 全屏覆盖层 + 顶部简化切换条。`panelOpen=false` 时内容栏整体不渲染；对话栏保留 `min-w-[420px]`（虚拟滚动列表 + Markdown 表格/代码块水平适配）。本任务内容区先渲染空态（标签栏与 ContentHost 在 Task 5 接入）。

- [ ] **Step 4.1: 创建 useMediaQuery hook**

创建 `apps/web/src/components/ContentPanel/hooks/useMediaQuery.ts`（hooks 位于组件目录内，遵守 web AGENTS.md 约定）：

```ts
// useMediaQuery - 媒体查询 hook（内容栏 lg 断点 = 1024px，对齐 Tailwind lg）。
// matchMedia 不可用（旧环境防御）时返回 false，内容栏走覆盖层形态。

import { useEffect, useState } from 'react';

export function useMediaQuery(query: string): boolean {
    const [matches, setMatches] = useState(() =>
        typeof window !== 'undefined' && typeof window.matchMedia !== 'undefined'
            ? window.matchMedia(query).matches
            : false,
    );

    useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia === 'undefined') return;
        const mql = window.matchMedia(query);
        const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
        setMatches(mql.matches);
        mql.addEventListener('change', onChange);
        return () => mql.removeEventListener('change', onChange);
    }, [query]);

    return matches;
}
```

- [ ] **Step 4.2: 写失败测试（ContentPanel 容器）**

创建 `apps/web/src/components/ContentPanel/index.test.tsx`：

```tsx
// ContentPanel 容器测试：panelOpen 门控、lg 断点双形态（右栏 / 覆盖层）。

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ContentPanel from './index';
import { useContentPanelStore } from '../../store/contentPanelStore';

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mockMatchMedia(matches: boolean) {
    vi.stubGlobal(
        'matchMedia',
        vi.fn().mockImplementation((query: string) => ({
            matches,
            media: query,
            onchange: null,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            addListener: vi.fn(),
            removeListener: vi.fn(),
            dispatchEvent: vi.fn(),
        })),
    );
}

describe('ContentPanel 容器', () => {
    beforeEach(() => {
        vi.unstubAllGlobals();
        useContentPanelStore.setState({
            globalTabs: [],
            sessionTabs: {},
            activeGlobalTabId: null,
            activeSessionTabId: {},
            activeScope: 'global',
            panelOpen: false,
        });
    });

    it('panelOpen=false 时整体不渲染', () => {
        mockMatchMedia(true);
        const { container } = render(<ContentPanel />);
        expect(container.querySelector('[data-testid="content-panel"]')).toBeNull();
    });

    it('窄屏（<lg）：全屏覆盖层 + 关闭按钮收起', () => {
        mockMatchMedia(false);
        useContentPanelStore.setState({ panelOpen: true });
        const { container } = render(<ContentPanel />);
        const panel = container.querySelector('[data-testid="content-panel"]');
        expect(panel?.getAttribute('data-mode')).toBe('overlay');
        fireEvent.click(screen.getByRole('button', { name: '关闭内容栏' }));
        expect(useContentPanelStore.getState().panelOpen).toBe(false);
    });

    it('宽屏（≥lg）：右侧常驻栏形态', () => {
        mockMatchMedia(true);
        useContentPanelStore.setState({ panelOpen: true });
        const { container } = render(<ContentPanel />);
        expect(
            container.querySelector('[data-testid="content-panel"]')?.getAttribute('data-mode'),
        ).toBe('column');
    });
});
```

- [ ] **Step 4.3: 运行确认失败**

Run: `pnpm --filter web exec vitest run src/components/ContentPanel/index.test.tsx`
Expected: FAIL（module not found）

- [ ] **Step 4.4: 实现 ContentPanel 容器（v1 骨架）**

创建 `apps/web/src/components/ContentPanel/index.tsx`：

```tsx
// ContentPanel - 右侧内容栏容器（content-panel 设计）
//
// lg（≥1024px）以上：对话栏右侧的常驻栏（固定宽度、shrink-0、border-l）；
// lg 以下：全屏覆盖层 + 顶部简化切换条（关闭按钮）。panelOpen=false 时整体
// 不渲染。标签栏（GlobalRail / SessionTabStrip）与内容区（ContentHost）由
// Task 5 接入，本版本内容区为空态占位。

import { X } from 'lucide-react';
import { useContentPanelStore } from '../../store/contentPanelStore';
import { useMediaQuery } from './hooks/useMediaQuery';

export default function ContentPanel() {
    const panelOpen = useContentPanelStore((s) => s.panelOpen);
    const setPanelOpen = useContentPanelStore((s) => s.setPanelOpen);
    const desktop = useMediaQuery('(min-width: 1024px)');

    if (!panelOpen) return null;

    const body = (
        <div className="flex h-full min-h-0" data-testid="content-panel-body">
            {/* Task 5: <GlobalRail /> + <SessionTabStrip /> + <ContentHost /> */}
        </div>
    );

    if (!desktop) {
        return (
            <div
                data-testid="content-panel"
                data-mode="overlay"
                className="fixed inset-0 z-40 flex flex-col bg-bg-primary"
            >
                <div className="flex h-11 shrink-0 items-center justify-between border-b border-border-base bg-bg-elevated px-4">
                    <span className="text-sm text-text-secondary">内容栏</span>
                    <button
                        type="button"
                        onClick={() => setPanelOpen(false)}
                        aria-label="关闭内容栏"
                        className="rounded-lg p-1.5 hover:bg-bg-hover"
                    >
                        <X className="h-4 w-4" aria-hidden />
                    </button>
                </div>
                <div className="min-h-0 flex-1 overflow-hidden">{body}</div>
            </div>
        );
    }

    return (
        <div
            data-testid="content-panel"
            data-mode="column"
            className="flex h-full w-[440px] shrink-0 flex-col border-l border-border-base bg-bg-primary xl:w-[520px]"
        >
            {body}
        </div>
    );
}
```

- [ ] **Step 4.5: 运行确认通过**

Run: `pnpm --filter web exec vitest run src/components/ContentPanel/index.test.tsx`
Expected: PASS（3 个用例）

- [ ] **Step 4.6: 写失败测试（MainView 双栏）**

创建 `apps/web/src/views/MainView.test.tsx`：

```tsx
// MainView 双栏布局测试：对话栏常驻 + 内容栏开合入口（ChatShell/内容栏 mock 隔离）。

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MainView } from './MainView';
import { useContentPanelStore } from '../store/contentPanelStore';

vi.mock('../components/ChatShell', () => ({
    default: () => <div data-testid="chat-shell-mock" />,
}));
vi.mock('../components/ToolConfirmationDialog', () => ({
    default: () => null,
}));
vi.mock('../components/ContentPanel', () => ({
    default: () => <div data-testid="content-panel-mock" />,
}));

describe('MainView 双栏布局', () => {
    beforeEach(() => {
        useContentPanelStore.setState({ panelOpen: false });
    });

    it('渲染对话栏（ChatShell）', () => {
        render(<MainView />);
        expect(screen.getByTestId('chat-shell-mock')).toBeTruthy();
    });

    it('内容栏收起时显示「打开内容栏」按钮；点击后展开并隐藏按钮', () => {
        render(<MainView />);
        expect(screen.queryByTestId('content-panel-mock')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: '打开内容栏' }));
        expect(useContentPanelStore.getState().panelOpen).toBe(true);
        expect(screen.getByTestId('content-panel-mock')).toBeTruthy();
        expect(screen.queryByRole('button', { name: '打开内容栏' })).toBeNull();
    });
});
```

- [ ] **Step 4.7: 运行确认失败**

Run: `pnpm --filter web exec vitest run src/views/MainView.test.tsx`
Expected: FAIL（「打开内容栏」按钮不存在）

- [ ] **Step 4.8: 改造 MainView**

`apps/web/src/views/MainView.tsx` 全量替换为：

```tsx
// MainView - Main chat view
// 双栏布局（content-panel 设计）：左对话栏（ChatShell）+ 右内容栏（ContentPanel）。
// lg 以下内容栏退化为覆盖层（ContentPanel 自行处理）。布局改动收敛在容器层，
// MessageList / Sender / ChatShell 内部不动；对话栏保留 min-width。

import { Suspense, lazy } from 'react'
import { PanelRight } from 'lucide-react'
import { useSessionStore } from '../store/sessionStore'
import { useContentPanelStore } from '../store/contentPanelStore'
import ToolConfirmationDialog from '../components/ToolConfirmationDialog'

const ChatShell = lazy(() => import('../components/ChatShell'))
const ContentPanel = lazy(() => import('../components/ContentPanel'))

export function MainView() {
  const pendingConfirmation = useSessionStore((s) => s.pendingConfirmation)
  const resolveConfirmation = useSessionStore((s) => s.resolveConfirmation)
  const panelOpen = useContentPanelStore((s) => s.panelOpen)
  const setPanelOpen = useContentPanelStore((s) => s.setPanelOpen)

  return (
    <div className="flex h-full w-full overflow-hidden bg-bg-elevated text-text-primary">
      <div className="relative flex min-w-[420px] flex-1 flex-col">
        <Suspense fallback={<div className="flex h-full w-full items-center justify-center">加载中...</div>}>
          <ChatShell />
        </Suspense>
        {/* 内容栏开合入口：悬浮在对话栏右上角（不动 ChatShell 内部） */}
        {!panelOpen && (
          <button
            type="button"
            onClick={() => setPanelOpen(true)}
            aria-label="打开内容栏"
            title="打开内容栏"
            className="absolute right-2 top-2 z-10 rounded-lg p-1.5 text-text-tertiary hover:bg-bg-hover hover:text-text-primary"
          >
            <PanelRight className="h-4 w-4" aria-hidden />
          </button>
        )}
      </div>
      <Suspense fallback={null}>
        <ContentPanel />
      </Suspense>
      <ToolConfirmationDialog
        confirmation={pendingConfirmation}
        onResolve={resolveConfirmation}
      />
    </div>
  )
}
```

- [ ] **Step 4.9: 运行确认通过 + 组件级回归**

Run: `pnpm --filter web exec vitest run src/views/MainView.test.tsx src/components/ContentPanel`
Expected: 全部 PASS

- [ ] **Step 4.10: Commit**

```bash
git add apps/web/src/components/ContentPanel/hooks/useMediaQuery.ts apps/web/src/components/ContentPanel/index.tsx apps/web/src/components/ContentPanel/index.test.tsx apps/web/src/views/MainView.tsx apps/web/src/views/MainView.test.tsx
git commit -m "feat(web): dual-column MainView with responsive ContentPanel (lg column / overlay)"
```

---

### Task 5: 标签栏组件 + ContentHost + assets 客户端 API

**Files:**
- Modify: `apps/web/src/api/real.ts`（新增 Assets API 两函数）
- Create: `apps/web/src/components/ContentPanel/GlobalRail.tsx` + `.test.tsx`
- Create: `apps/web/src/components/ContentPanel/SessionTabStrip.tsx` + `.test.tsx`
- Create: `apps/web/src/components/ContentPanel/ContentHost.tsx` + `.test.tsx`
- Create: `apps/web/src/components/ContentPanel/builtin.ts`（注册骨架）
- Modify: `apps/web/src/components/ContentPanel/index.tsx`（组合标签栏与内容区）
- Modify: `apps/web/src/components/ContentPanel/index.test.tsx`（追加联动用例）

**前置说明:** `fetchAssetMeta` / `fetchAssetRaw` 的服务端点由 plan A 提供；本任务只新增 web 侧客户端函数——代码与单测不依赖 plan A 已执行（单测 mock API），**运行时验收前置：plan A 已执行**（未执行时 meta 取数 404 → 渲染器降级，不崩溃）。

- [ ] **Step 5.1: assets 客户端 API**

`apps/web/src/api/real.ts` 在 Plugins API 区块（`uploadPlugin` 之后）追加：

```ts
// ─── Assets API（数据源：附件资产层设计 docs/2026-09-30-attachment-assets-multimodal-design.md；
//     端点由该计划提供，未执行时运行时 404，前端渲染器降级）───

/**
 * 资产元数据的最小视图投影（对齐 assets 表 name/mime_type/kind 的 camelCase
 * 形态；完整 Asset 类型以附件资产层计划为准，落地后可原地切换为直接引用）。
 */
export interface AssetMetaDto {
    id: string;
    name: string;
    mimeType: string;
    kind: string;
}

/**
 * Fetch asset metadata
 * GET /api/assets/:id/meta
 */
export async function fetchAssetMeta(id: string): Promise<AssetMetaDto> {
    const response = await enhancedFetch<{ data: AssetMetaDto }>(`/api/assets/${id}/meta`, {
        method: 'GET',
        timeout: 30000,
    });
    return response.data;
}

/**
 * Fetch asset raw bytes（图片/PDF 经 blob 消费。不走 <img src> 直链——
 * raw 端点要求 Bearer 认证，src 无法携带请求头）
 * GET /api/assets/:id/raw
 */
export async function fetchAssetRaw(id: string): Promise<Response> {
    return fetchWithAuth(`/api/assets/${id}/raw`, { method: 'GET' });
}
```

（`api/index.ts` barrel 是 `export const api = real`，新函数自动可用；`enhancedFetch` / `fetchWithAuth` 同文件既有 import，无需新增。）

- [ ] **Step 5.2: 写失败测试（GlobalRail）**

创建 `apps/web/src/components/ContentPanel/GlobalRail.test.tsx`：

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import GlobalRail, { type RailEntry } from './GlobalRail';

function makeEntry(overrides: Partial<RailEntry> = {}): RailEntry {
    return {
        key: 'e1',
        label: 'agent 状态',
        icon: <span aria-hidden>📊</span>,
        onClick: vi.fn(),
        ...overrides,
    };
}

describe('GlobalRail', () => {
    it('空列表不渲染', () => {
        const { container } = render(<GlobalRail entries={[]} />);
        expect(container.querySelector('[data-testid="global-rail"]')).toBeNull();
    });

    it('渲染图标按钮：title/aria-label、激活态、未读点、点击回调', () => {
        const onClick = vi.fn();
        const { container } = render(<GlobalRail entries={[makeEntry({ onClick, active: true, unread: true })]} />);
        const btn = screen.getByRole('button', { name: 'agent 状态' });
        expect(btn.getAttribute('aria-current')).toBe('true');
        expect(container.querySelector('[data-testid="rail-unread-dot"]')).not.toBeNull();
        fireEvent.click(btn);
        expect(onClick).toHaveBeenCalledTimes(1);
    });
});
```

- [ ] **Step 5.3: 实现 GlobalRail**

创建 `apps/web/src/components/ContentPanel/GlobalRail.tsx`：

```tsx
// GlobalRail - 全局标签页的左侧竖排图标 rail（IDE 活动栏心智，content-panel 设计）。
// 展示组件：入口由调用方派生（常驻注册入口 + 打开的全局 tab，见 ContentPanel）。

import type { ReactNode } from 'react';

export interface RailEntry {
    /** 稳定 key（通常 = tabId）。 */
    key: string;
    label: string;
    icon: ReactNode;
    active?: boolean;
    unread?: boolean;
    onClick: () => void;
}

export default function GlobalRail({ entries }: { entries: RailEntry[] }) {
    if (entries.length === 0) return null;
    return (
        <nav
            aria-label="全局标签页"
            data-testid="global-rail"
            className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-border-base bg-bg-secondary py-2"
        >
            {entries.map((e) => (
                <button
                    key={e.key}
                    type="button"
                    onClick={e.onClick}
                    title={e.label}
                    aria-label={e.label}
                    aria-current={e.active ? 'true' : undefined}
                    className={`relative flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
                        e.active
                            ? 'bg-bg-hover text-text-primary'
                            : 'text-text-tertiary hover:bg-bg-hover/60 hover:text-text-primary'
                    }`}
                >
                    {e.icon}
                    {e.unread && (
                        <span
                            data-testid="rail-unread-dot"
                            className="absolute right-1 top-1 h-2 w-2 rounded-full bg-primary-500"
                            aria-hidden
                        />
                    )}
                </button>
            ))}
        </nav>
    );
}
```

- [ ] **Step 5.4: 运行确认通过**

Run: `pnpm --filter web exec vitest run src/components/ContentPanel/GlobalRail.test.tsx`
Expected: PASS（2 个用例）

- [ ] **Step 5.5: 写失败测试（SessionTabStrip）**

创建 `apps/web/src/components/ContentPanel/SessionTabStrip.test.tsx`：

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SessionTabStrip, { type StripTab } from './SessionTabStrip';

function makeTabs(n: number): StripTab[] {
    return Array.from({ length: n }, (_, i) => ({
        tabId: `t${i}`,
        title: `标签${i}`,
        active: i === 0,
        onClick: vi.fn(),
        onClose: vi.fn(),
    }));
}

describe('SessionTabStrip', () => {
    it('空列表不渲染', () => {
        const { container } = render(<SessionTabStrip tabs={[]} />);
        expect(container.querySelector('[data-testid="session-tab-strip"]')).toBeNull();
    });

    it('渲染 tab：激活态标识 + 点击激活 + 关闭按钮（stopPropagation）', () => {
        const tabs = makeTabs(2);
        const { container } = render(<SessionTabStrip tabs={tabs} />);
        const first = container.querySelector('[data-testid="session-tab"][data-active="true"]');
        expect(first).not.toBeNull();
        fireEvent.click(first!);
        expect(tabs[0].onClick).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByRole('button', { name: '关闭 标签1' }));
        expect(tabs[1].onClose).toHaveBeenCalledTimes(1);
        expect(tabs[1].onClick).not.toHaveBeenCalled(); // 关闭不触发激活
    });

    it('超过可见上限的 tab 收进溢出下拉；extraMenuItems 一并列出并可点击', () => {
        const tabs = makeTabs(8); // MAX_VISIBLE_TABS = 6 → 2 个溢出
        const extra = { key: 'panel:p1:run', label: '打开面板：运行记录', onClick: vi.fn() };
        render(<SessionTabStrip tabs={tabs} extraMenuItems={[extra]} />);
        fireEvent.click(screen.getByTestId('tab-overflow-button'));
        const menu = screen.getByTestId('tab-overflow-menu');
        expect(menu.textContent).toContain('标签6');
        expect(menu.textContent).toContain('打开面板：运行记录');
        fireEvent.click(screen.getByRole('button', { name: '打开面板：运行记录' }));
        expect(extra.onClick).toHaveBeenCalledTimes(1);
    });
});
```

- [ ] **Step 5.6: 实现 SessionTabStrip**

创建 `apps/web/src/components/ContentPanel/SessionTabStrip.tsx`：

```tsx
// SessionTabStrip - 会话标签页的顶部横排 tab 条（content-panel 设计）。
// 可见上限 MAX_VISIBLE_TABS：超出部分 + 会话级插件面板入口收进「⋯」下拉
// （设计：溢出收进下拉列表；按数量而非像素判定，保证可测与确定性）。

import { useState } from 'react';
import { X, MoreHorizontal } from 'lucide-react';

export interface StripTab {
    tabId: string;
    title: string;
    active: boolean;
    unread?: boolean;
    onClick: () => void;
    onClose: () => void;
}

export interface StripMenuItem {
    key: string;
    label: string;
    onClick: () => void;
}

/** 横排可见 tab 上限（其余收进下拉）。 */
const MAX_VISIBLE_TABS = 6;

export default function SessionTabStrip({
    tabs,
    extraMenuItems = [],
}: {
    tabs: StripTab[];
    extraMenuItems?: StripMenuItem[];
}) {
    const [menuOpen, setMenuOpen] = useState(false);
    const visible = tabs.slice(0, MAX_VISIBLE_TABS);
    const menuItems: StripMenuItem[] = [
        ...tabs.slice(MAX_VISIBLE_TABS).map((t) => ({ key: t.tabId, label: t.title, onClick: t.onClick })),
        ...extraMenuItems,
    ];

    if (tabs.length === 0 && menuItems.length === 0) return null;

    return (
        <div
            data-testid="session-tab-strip"
            className="flex h-9 shrink-0 items-center gap-1 overflow-hidden border-b border-border-base bg-bg-elevated px-2"
        >
            {visible.map((t) => (
                <div
                    key={t.tabId}
                    data-testid="session-tab"
                    data-active={t.active}
                    onClick={t.onClick}
                    className={`group flex h-7 max-w-[180px] cursor-pointer items-center gap-1 rounded-md px-2.5 text-[12px] transition-colors ${
                        t.active ? 'bg-bg-hover text-text-primary' : 'text-text-secondary hover:bg-bg-hover/60'
                    }`}
                >
                    <span className="truncate">{t.title}</span>
                    {t.unread && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary-500" aria-hidden />}
                    <button
                        type="button"
                        aria-label={`关闭 ${t.title}`}
                        onClick={(e) => {
                            e.stopPropagation();
                            t.onClose();
                        }}
                        className="shrink-0 opacity-0 hover:text-error-600 group-hover:opacity-100"
                    >
                        <X className="h-3 w-3" aria-hidden />
                    </button>
                </div>
            ))}
            {menuItems.length > 0 && (
                <div className="relative shrink-0">
                    <button
                        type="button"
                        onClick={() => setMenuOpen((v) => !v)}
                        aria-label="更多标签页"
                        data-testid="tab-overflow-button"
                        className="flex h-7 w-7 items-center justify-center rounded-md text-text-tertiary hover:bg-bg-hover"
                    >
                        <MoreHorizontal className="h-4 w-4" aria-hidden />
                    </button>
                    {menuOpen && (
                        <>
                            <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} aria-hidden />
                            <div
                                data-testid="tab-overflow-menu"
                                className="absolute right-0 top-8 z-20 min-w-[160px] rounded-lg border border-border-base bg-bg-elevated py-1 shadow-lg"
                            >
                                {menuItems.map((item) => (
                                    <button
                                        key={item.key}
                                        type="button"
                                        className="w-full truncate px-3 py-1.5 text-left text-[12px] text-text-secondary hover:bg-bg-hover"
                                        onClick={() => {
                                            setMenuOpen(false);
                                            item.onClick();
                                        }}
                                    >
                                        {item.label}
                                    </button>
                                ))}
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
```

- [ ] **Step 5.7: 运行确认通过**

Run: `pnpm --filter web exec vitest run src/components/ContentPanel/SessionTabStrip.test.tsx`
Expected: PASS（3 个用例）

- [ ] **Step 5.8: 写失败测试（ContentHost）**

创建 `apps/web/src/components/ContentPanel/ContentHost.test.tsx`：

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import ContentHost from './ContentHost';
import { clearContentRenderers, registerContentRenderer } from './registry';

const { fetchAssetMetaMock } = vi.hoisted(() => ({ fetchAssetMetaMock: vi.fn() }));
vi.mock('../../api', () => ({
    api: { fetchAssetMeta: fetchAssetMetaMock },
}));

afterEach(() => clearContentRenderers());

describe('ContentHost', () => {
    it('解析到渲染器时懒加载渲染', async () => {
        registerContentRenderer({
            canHandle: (ref) => ref.type === 'trace',
            render: () => Promise.resolve(() => <div data-testid="stub-renderer">trace 内容</div>),
            priority: 100,
        });
        render(<ContentHost ref={{ type: 'trace', sessionId: 's1' }} />);
        expect(await screen.findByTestId('stub-renderer')).toBeTruthy();
    });

    it('asset 类先取 meta（mime 供渲染器选择），取数失败降级为无 meta', async () => {
        const canHandle = vi.fn(() => true);
        registerContentRenderer({
            canHandle,
            render: () => Promise.resolve(() => <div data-testid="stub-renderer" />),
            priority: 100,
        });
        fetchAssetMetaMock.mockResolvedValue({ id: 'a1', name: 'x.png', mimeType: 'image/png', kind: 'image' });
        render(<ContentHost ref={{ type: 'asset', assetId: 'a1' }} />);
        await waitFor(() => {
            expect(canHandle).toHaveBeenCalledWith({ type: 'asset', assetId: 'a1' }, {
                id: 'a1',
                name: 'x.png',
                mime: 'image/png',
                kind: 'image',
            });
        });
    });

    it('无可用渲染器时显示空态', () => {
        render(<ContentHost ref={{ type: 'asset', assetId: 'a1' }} />);
        expect(screen.getByTestId('content-host-empty')).toBeTruthy();
    });
});
```

- [ ] **Step 5.9: 运行确认失败**

Run: `pnpm --filter web exec vitest run src/components/ContentPanel/ContentHost.test.tsx`
Expected: FAIL（module not found）

- [ ] **Step 5.10: 实现 builtin 骨架与 ContentHost**

创建 `apps/web/src/components/ContentPanel/builtin.ts`（本任务先建骨架，Task 6/7/8/9/11 逐步追加注册项）：

```ts
// builtin.ts — 内置渲染器注册（副作用模块：被 ContentHost 导入即注册一次）。
// 各渲染器条目由后续任务追加（Task 6 资产四件、Task 7 PDF、Task 8 trace、
// Task 9 插件面板兜底、Task 11 agent 状态）。

// （Task 6 起填充注册项）
```

创建 `apps/web/src/components/ContentPanel/ContentHost.tsx`：

```tsx
// ContentHost - 当前激活标签内容的渲染入口（注册表解析 + 懒加载 + Suspense）。
// asset 类先取 meta（mime/kind/文件名供渲染器选择），失败降级为无 meta
// （此时仅低优先级兜底渲染器可命中）。

import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import type { ContentRef } from '../../types/content';
import { resolveContentRenderer, type AssetMetaView } from './registry';
import './builtin';

interface ContentHostProps {
    ref: ContentRef;
}

export default function ContentHost({ ref: contentRef }: ContentHostProps) {
    const [meta, setMeta] = useState<AssetMetaView | undefined>(undefined);

    useEffect(() => {
        let cancelled = false;
        if (contentRef.type !== 'asset') {
            setMeta(undefined);
            return;
        }
        const { assetId } = contentRef;
        api.fetchAssetMeta(assetId)
            .then((a) => {
                if (!cancelled) setMeta({ id: a.id, name: a.name, mime: a.mimeType, kind: a.kind });
            })
            .catch(() => {
                if (!cancelled) setMeta(undefined);
            });
        return () => {
            cancelled = true;
        };
    }, [contentRef]);

    const renderer = resolveContentRenderer(contentRef, meta);
    const Lazy = useMemo(
        () => (renderer ? lazy(() => renderer.render().then((c) => ({ default: c }))) : null),
        [renderer],
    );

    if (!renderer || !Lazy) {
        return (
            <div data-testid="content-host-empty" className="p-6 text-sm text-text-tertiary">
                该内容暂无可用的渲染器。
            </div>
        );
    }
    return (
        <div className="h-full overflow-hidden">
            <Suspense fallback={<div className="p-6 text-sm text-text-tertiary">加载渲染器…</div>}>
                <Lazy ref={contentRef} meta={meta} />
            </Suspense>
        </div>
    );
}
```

（React 19 的 ref-as-prop：函数组件直接从 props 解构 `ref`，无需 forwardRef。）

- [ ] **Step 5.11: 运行确认通过**

Run: `pnpm --filter web exec vitest run src/components/ContentPanel/ContentHost.test.tsx`
Expected: PASS（3 个用例）

- [ ] **Step 5.12: 组合进 ContentPanel 容器**

`apps/web/src/components/ContentPanel/index.tsx` 全量替换为：

```tsx
// ContentPanel - 右侧内容栏容器（content-panel 设计）
//
// lg（≥1024px）以上：对话栏右侧的常驻栏；lg 以下：全屏覆盖层 + 顶部简化
// 切换条。panelOpen=false 时整体不渲染。结构：GlobalRail（全局轨道）+
// SessionTabStrip（会话轨道）+ ContentHost（按 activeScope 二选一显示）。

import { lazy, Suspense } from 'react';
import { X } from 'lucide-react';
import { useContentPanelStore } from '../../store/contentPanelStore';
import { useSessionStore, NEW_SESSION_SENTINEL } from '../../store/sessionStore';
import { useMediaQuery } from './hooks/useMediaQuery';
import GlobalRail, { type RailEntry } from './GlobalRail';
import SessionTabStrip, { type StripTab } from './SessionTabStrip';

const ContentHost = lazy(() => import('./ContentHost'));

export default function ContentPanel() {
    const panelOpen = useContentPanelStore((s) => s.panelOpen);
    const setPanelOpen = useContentPanelStore((s) => s.setPanelOpen);
    const globalTabs = useContentPanelStore((s) => s.globalTabs);
    const activeGlobalTabId = useContentPanelStore((s) => s.activeGlobalTabId);
    const activeScope = useContentPanelStore((s) => s.activeScope);
    const sessionTabs = useContentPanelStore((s) => s.sessionTabs);
    const activeSessionTabId = useContentPanelStore((s) => s.activeSessionTabId);
    const openTab = useContentPanelStore((s) => s.openTab);
    const closeTab = useContentPanelStore((s) => s.closeTab);
    const setActiveTab = useContentPanelStore((s) => s.setActiveTab);
    const selectedSessionId = useSessionStore((s) => s.selectedSessionId);
    const desktop = useMediaQuery('(min-width: 1024px)');

    const sid =
        selectedSessionId && selectedSessionId !== NEW_SESSION_SENTINEL ? selectedSessionId : '';
    const currentTabs = sid ? (sessionTabs[sid] ?? []) : [];
    const activeSessionTab = sid ? (activeSessionTabId[sid] ?? null) : null;

    const activeTab =
        activeScope === 'global'
            ? (globalTabs.find((t) => t.tabId === activeGlobalTabId) ?? null)
            : (currentTabs.find((t) => t.tabId === activeSessionTab) ?? null);

    // v1 图标兜底：标题前两字符（Task 10/11 为插件面板与 agent 状态换真实图标）
    const railEntries: RailEntry[] = globalTabs.map((t) => ({
        key: t.tabId,
        label: t.title,
        icon: <span className="w-9 truncate text-center font-mono text-[11px]">{t.title.slice(0, 2)}</span>,
        active: activeScope === 'global' && t.tabId === activeGlobalTabId,
        unread: t.unread,
        onClick: () => openTab({ ref: t.ref, title: t.title, icon: t.icon, scope: 'global', origin: 'user' }),
    }));

    const stripTabs: StripTab[] = currentTabs.map((t) => ({
        tabId: t.tabId,
        title: t.title,
        active: activeScope === 'session' && t.tabId === activeSessionTab,
        unread: t.unread,
        onClick: () => setActiveTab('session', t.tabId, sid),
        onClose: () => closeTab('session', t.tabId, sid),
    }));

    if (!panelOpen) return null;

    const body = (
        <div className="flex h-full min-h-0">
            <GlobalRail entries={railEntries} />
            <div className="flex min-w-0 flex-1 flex-col">
                <SessionTabStrip tabs={stripTabs} />
                <div className="min-h-0 flex-1 overflow-hidden">
                    {activeTab ? (
                        <Suspense fallback={<div className="p-6 text-sm text-text-tertiary">加载中…</div>}>
                            <ContentHost ref={activeTab.ref} key={activeTab.tabId} />
                        </Suspense>
                    ) : (
                        <div
                            data-testid="content-panel-empty"
                            className="flex h-full items-center justify-center p-6 text-sm text-text-tertiary"
                        >
                            暂无激活的内容标签页
                        </div>
                    )}
                </div>
            </div>
        </div>
    );

    if (!desktop) {
        return (
            <div
                data-testid="content-panel"
                data-mode="overlay"
                className="fixed inset-0 z-40 flex flex-col bg-bg-primary"
            >
                <div className="flex h-11 shrink-0 items-center justify-between border-b border-border-base bg-bg-elevated px-4">
                    <span className="text-sm text-text-secondary">内容栏</span>
                    <button
                        type="button"
                        onClick={() => setPanelOpen(false)}
                        aria-label="关闭内容栏"
                        className="rounded-lg p-1.5 hover:bg-bg-hover"
                    >
                        <X className="h-4 w-4" aria-hidden />
                    </button>
                </div>
                <div className="min-h-0 flex-1 overflow-hidden">{body}</div>
            </div>
        );
    }

    return (
        <div
            data-testid="content-panel"
            data-mode="column"
            className="flex h-full w-[440px] shrink-0 flex-col border-l border-border-base bg-bg-primary xl:w-[520px]"
        >
            {body}
        </div>
    );
}
```

- [ ] **Step 5.13: 容器测试扩展（标签栏联动）**

在 `apps/web/src/components/ContentPanel/index.test.tsx` 的 describe 内追加用例（import 区补 `import { useSessionStore } from '../../store/sessionStore';`）：

```tsx
    it('用户打开会话 tab → 标签条渲染；打开全局 tab → rail 激活切换轨道', () => {
        mockMatchMedia(true);
        const store = useContentPanelStore.getState();
        store.openTab({
            ref: { type: 'trace', sessionId: 's1', messageId: 'm1' },
            title: '执行过程',
            scope: 'session',
            sessionId: 's1',
            origin: 'user',
        });
        useSessionStore.setState({ selectedSessionId: 's1' });
        const { container } = render(<ContentPanel />);
        const stripTab = container.querySelector('[data-testid="session-tab"]');
        expect(stripTab?.textContent).toContain('执行过程');

        useContentPanelStore
            .getState()
            .openTab({ ref: { type: 'asset', assetId: 'a1' }, title: '资产', scope: 'global', origin: 'user' });
        const railBtn = container.querySelector('[data-testid="global-rail"] button[aria-label="资产"]');
        expect(railBtn?.getAttribute('aria-current')).toBe('true');
    });
```

- [ ] **Step 5.14: 运行确认通过 + ContentPanel 全组回归**

Run: `pnpm --filter web exec vitest run src/components/ContentPanel src/views/MainView.test.tsx`
Expected: 全部 PASS

- [ ] **Step 5.15: Commit**

```bash
git add apps/web/src/api/real.ts apps/web/src/components/ContentPanel/GlobalRail.tsx apps/web/src/components/ContentPanel/GlobalRail.test.tsx apps/web/src/components/ContentPanel/SessionTabStrip.tsx apps/web/src/components/ContentPanel/SessionTabStrip.test.tsx apps/web/src/components/ContentPanel/ContentHost.tsx apps/web/src/components/ContentPanel/ContentHost.test.tsx apps/web/src/components/ContentPanel/builtin.ts apps/web/src/components/ContentPanel/index.tsx apps/web/src/components/ContentPanel/index.test.tsx
git commit -m "feat(web): content panel tab bars, ContentHost renderer resolution, assets client API"
```

---

### Task 6: 内置资产渲染器（image / markdown / code / plain-text）

**Files:**
- Create: `apps/web/src/components/ContentPanel/hooks/useAssetText.ts`
- Create: `apps/web/src/components/ContentPanel/renderers/ImageAssetRenderer.tsx`
- Create: `apps/web/src/components/ContentPanel/renderers/MarkdownAssetRenderer.tsx`
- Create: `apps/web/src/components/ContentPanel/renderers/CodeAssetRenderer.tsx`
- Create: `apps/web/src/components/ContentPanel/renderers/PlainTextAssetRenderer.tsx`
- Modify: `apps/web/src/components/ContentPanel/builtin.ts`（注册四件）
- Test: `apps/web/src/components/ContentPanel/renderers/renderers.test.tsx`（集中测试）

**前置：附件资产层计划已执行（端到端验收时）；单测全程 mock `api.fetchAssetRaw`，不依赖。**

- [ ] **Step 6.1: 创建 useAssetText hook**

创建 `apps/web/src/components/ContentPanel/hooks/useAssetText.ts`：

```ts
// useAssetText - 文本类资产内容的取数 hook（markdown/code/plain 渲染器共用）。

import { useEffect, useState } from 'react';
import { api } from '../../../api';

export function useAssetText(assetId: string): { text: string | null; error: string | null } {
    const [text, setText] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        api.fetchAssetRaw(assetId)
            .then((res) => res.text())
            .then((content) => {
                if (!cancelled) setText(content);
            })
            .catch((e) => {
                if (!cancelled) setError(e instanceof Error ? e.message : String(e));
            });
        return () => {
            cancelled = true;
        };
    }, [assetId]);

    return { text, error };
}
```

- [ ] **Step 6.2: 写失败测试（渲染器 + builtin 分派）**

创建 `apps/web/src/components/ContentPanel/renderers/renderers.test.tsx`：

```tsx
// 资产渲染器测试：取数（blob/text）、错误态、canHandle 分派链。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { api } from '../../../api';
import { resolveContentRenderer } from '../registry';
import {
    imageAssetRenderer,
    markdownAssetRenderer,
    codeAssetRenderer,
    plainTextAssetRenderer,
} from '../builtin';

vi.mock('../../../api', () => ({
    api: {
        fetchAssetRaw: vi.fn(),
    },
}));

const fetchAssetRawMock = vi.mocked(api.fetchAssetRaw);

describe('builtin canHandle 分派', () => {
    it('image：mime image/* 或图片扩展名；非 asset ref 不命中', () => {
        expect(imageAssetRenderer.canHandle({ type: 'asset', assetId: 'a' }, { id: 'a', mime: 'image/png' })).toBe(true);
        expect(imageAssetRenderer.canHandle({ type: 'asset', assetId: 'a' }, { id: 'a', name: 'x.jpg' })).toBe(true);
        expect(imageAssetRenderer.canHandle({ type: 'asset', assetId: 'a' }, { id: 'a', mime: 'text/plain' })).toBe(false);
        expect(imageAssetRenderer.canHandle({ type: 'trace', sessionId: 's' })).toBe(false);
    });

    it('优先级链：md 命中 markdown；代码扩展名命中 code；未知 meta 只命中 plain 兜底；已知二进制无渲染器', () => {
        expect(
            resolveContentRenderer({ type: 'asset', assetId: 'a' }, { id: 'a', name: 'r.md', mime: 'text/markdown' }),
        ).toBe(markdownAssetRenderer);
        expect(
            resolveContentRenderer({ type: 'asset', assetId: 'a' }, { id: 'a', name: 'm.ts', mime: 'text/plain' }),
        ).toBe(codeAssetRenderer);
        expect(resolveContentRenderer({ type: 'asset', assetId: 'a' }, undefined)).toBe(plainTextAssetRenderer);
        expect(resolveContentRenderer({ type: 'asset', assetId: 'a' }, { id: 'a', mime: 'audio/mpeg' })).toBeNull();
    });
});

describe('ImageAssetRenderer', () => {
    beforeEach(() => {
        // jsdom 无 URL.createObjectURL：stub 之
        (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = vi.fn(() => 'blob:mock');
        (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = vi.fn();
    });
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('取 raw → blob → objectURL 渲染 <img>（alt 取文件名）', async () => {
        fetchAssetRawMock.mockResolvedValue(new Response(new Blob(['bin'], { type: 'image/png' })));
        const { default: ImageAssetRenderer } = await import('./ImageAssetRenderer');
        const { container } = render(
            <ImageAssetRenderer ref={{ type: 'asset', assetId: 'a1' }} meta={{ id: 'a1', name: 'pic.png', mime: 'image/png' }} />,
        );
        const img = await waitFor(() => {
            const el = container.querySelector('[data-testid="image-asset-view"] img');
            expect(el).not.toBeNull();
            return el as HTMLImageElement;
        });
        expect(img.getAttribute('src')).toBe('blob:mock');
        expect(img.getAttribute('alt')).toBe('pic.png');
    });

    it('取数失败 → 错误态', async () => {
        fetchAssetRawMock.mockRejectedValue(new Error('HTTP 404'));
        const { default: ImageAssetRenderer } = await import('./ImageAssetRenderer');
        render(<ImageAssetRenderer ref={{ type: 'asset', assetId: 'a1' }} />);
        expect(await screen.findByTestId('image-asset-error')).toBeTruthy();
    });
});

describe('文本类渲染器（useAssetText）', () => {
    it('MarkdownAssetRenderer 渲染 markdown 内容', async () => {
        fetchAssetRawMock.mockResolvedValue(new Response('# 标题'));
        const { default: MarkdownAssetRenderer } = await import('./MarkdownAssetRenderer');
        const { container } = render(<MarkdownAssetRenderer ref={{ type: 'asset', assetId: 'a1' }} />);
        await waitFor(() => {
            expect(container.querySelector('[data-testid="markdown-asset-view"]')).not.toBeNull();
        });
    });

    it('CodeAssetRenderer 以 fence 语言包一层后交给 MarkdownRenderer', async () => {
        fetchAssetRawMock.mockResolvedValue(new Response('const x = 1'));
        const { default: CodeAssetRenderer } = await import('./CodeAssetRenderer');
        const { container } = render(
            <CodeAssetRenderer ref={{ type: 'asset', assetId: 'a1' }} meta={{ id: 'a1', name: 'm.ts', mime: 'text/plain' }} />,
        );
        await waitFor(() => {
            expect(container.querySelector('[data-testid="code-asset-view"]')).not.toBeNull();
        });
    });

    it('PlainTextAssetRenderer 纯文本渲染 + 文件名标注', async () => {
        fetchAssetRawMock.mockResolvedValue(new Response('hello'));
        const { default: PlainTextAssetRenderer } = await import('./PlainTextAssetRenderer');
        const { container } = render(
            <PlainTextAssetRenderer ref={{ type: 'asset', assetId: 'a1' }} meta={{ id: 'a1', name: 'note.txt', mime: 'text/plain' }} />,
        );
        await waitFor(() => {
            const view = container.querySelector('[data-testid="plain-asset-view"]');
            expect(view?.textContent).toContain('hello');
            expect(view?.textContent).toContain('note.txt');
        });
    });
});
```

- [ ] **Step 6.3: 运行确认失败**

Run: `pnpm --filter web exec vitest run src/components/ContentPanel/renderers/renderers.test.tsx`
Expected: FAIL（module not found / builtin 无导出）

- [ ] **Step 6.4: 实现四个渲染器**

创建 `apps/web/src/components/ContentPanel/renderers/ImageAssetRenderer.tsx`：

```tsx
// ImageAssetRenderer - 资产图片渲染器：认证 fetch → blob → objectURL（卸载回收）。

import { useEffect, useState } from 'react';
import { api } from '../../../api';
import type { ContentRendererProps } from '../registry';

export default function ImageAssetRenderer({ ref: contentRef, meta }: ContentRendererProps) {
    const assetId = contentRef.type === 'asset' ? contentRef.assetId : '';
    const [url, setUrl] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        let objectUrl: string | null = null;
        api.fetchAssetRaw(assetId)
            .then((res) => res.blob())
            .then((blob) => {
                if (cancelled) return;
                objectUrl = URL.createObjectURL(blob);
                setUrl(objectUrl);
            })
            .catch((e) => {
                if (!cancelled) setError(e instanceof Error ? e.message : String(e));
            });
        return () => {
            cancelled = true;
            if (objectUrl !== null) URL.revokeObjectURL(objectUrl);
        };
    }, [assetId]);

    if (error) {
        return (
            <div data-testid="image-asset-error" className="p-6 text-sm text-error-600">
                图片加载失败：{error}
            </div>
        );
    }
    if (!url) {
        return <div className="p-6 text-sm text-text-tertiary">图片加载中…</div>;
    }
    return (
        <div data-testid="image-asset-view" className="flex h-full items-center justify-center overflow-auto p-4">
            <img src={url} alt={meta?.name ?? assetId} className="max-h-full max-w-full object-contain" />
        </div>
    );
}
```

创建 `apps/web/src/components/ContentPanel/renderers/MarkdownAssetRenderer.tsx`：

```tsx
// MarkdownAssetRenderer - 资产 Markdown 渲染器：取文本后复用 MarkdownRenderer。

import MarkdownRenderer from '../../MarkdownRenderer';
import { useAssetText } from '../hooks/useAssetText';
import type { ContentRendererProps } from '../registry';

export default function MarkdownAssetRenderer({ ref: contentRef }: ContentRendererProps) {
    const assetId = contentRef.type === 'asset' ? contentRef.assetId : '';
    const { text, error } = useAssetText(assetId);

    if (error) {
        return <div className="p-6 text-sm text-error-600">Markdown 加载失败：{error}</div>;
    }
    if (text === null) {
        return <div className="p-6 text-sm text-text-tertiary">加载中…</div>;
    }
    return (
        <div data-testid="markdown-asset-view" className="h-full overflow-auto p-6">
            <MarkdownRenderer content={text} />
        </div>
    );
}
```

创建 `apps/web/src/components/ContentPanel/renderers/CodeAssetRenderer.tsx`：

```tsx
// CodeAssetRenderer - 资产代码渲染器：按扩展名推断 fence 语言，交给
// MarkdownRenderer 的 prism 高亮（复用既有代码块管线，不另起高亮栈）。

import MarkdownRenderer from '../../MarkdownRenderer';
import { useAssetText } from '../hooks/useAssetText';
import type { ContentRendererProps } from '../registry';

/** 文件扩展名 → fence 语言（prism 消费）。 */
const EXT_LANG: Record<string, string> = {
    ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx', mjs: 'javascript',
    json: 'json', css: 'css', html: 'html', py: 'python', go: 'go', rs: 'rust',
    java: 'java', sql: 'sql', sh: 'bash', bash: 'bash', yml: 'yaml', yaml: 'yaml',
};

export default function CodeAssetRenderer({ ref: contentRef, meta }: ContentRendererProps) {
    const assetId = contentRef.type === 'asset' ? contentRef.assetId : '';
    const { text, error } = useAssetText(assetId);

    if (error) {
        return <div className="p-6 text-sm text-error-600">文件加载失败：{error}</div>;
    }
    if (text === null) {
        return <div className="p-6 text-sm text-text-tertiary">加载中…</div>;
    }
    const ext = meta?.name?.split('.').pop()?.toLowerCase() ?? '';
    const lang = EXT_LANG[ext] ?? '';
    return (
        <div data-testid="code-asset-view" className="h-full overflow-auto p-4">
            <MarkdownRenderer content={'```' + lang + '\n' + text + '\n```'} />
        </div>
    );
}
```

创建 `apps/web/src/components/ContentPanel/renderers/PlainTextAssetRenderer.tsx`：

```tsx
// PlainTextAssetRenderer - 纯文本兜底渲染器（priority 10：仅未知 meta 或文本类命中）。

import { useAssetText } from '../hooks/useAssetText';
import type { ContentRendererProps } from '../registry';

export default function PlainTextAssetRenderer({ ref: contentRef, meta }: ContentRendererProps) {
    const assetId = contentRef.type === 'asset' ? contentRef.assetId : '';
    const { text, error } = useAssetText(assetId);

    if (error) {
        return <div className="p-6 text-sm text-error-600">文件加载失败：{error}</div>;
    }
    if (text === null) {
        return <div className="p-6 text-sm text-text-tertiary">加载中…</div>;
    }
    return (
        <div data-testid="plain-asset-view" className="h-full overflow-auto p-6">
            <div className="mb-3 text-[12px] text-text-tertiary">{meta?.name ?? assetId}</div>
            <pre className="m-0 whitespace-pre-wrap font-mono text-[12px] leading-relaxed text-text-secondary">{text}</pre>
        </div>
    );
}
```

- [ ] **Step 6.5: 注册进 builtin.ts**

`apps/web/src/components/ContentPanel/builtin.ts` 全量替换为：

```ts
// builtin.ts — 内置渲染器注册（副作用模块：被 ContentHost 导入即注册一次）。
//
// asset 类按 meta（mime/kind/文件名）分派；priority：图片/Markdown 100、
// 代码 90、纯文本 10（兜底，仅未知 meta 或文本类命中）。
// 后续任务追加：Task 7 PDF、Task 8 trace、Task 9 插件面板兜底、Task 11 agent 状态。

import { registerContentRenderer, type ContentRenderer } from './registry';

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;
const MARKDOWN_EXT = /\.(md|markdown)$/i;
const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|json|css|html|py|go|rs|java|sql|sh|bash|yml|yaml)$/i;

export const imageAssetRenderer: ContentRenderer = {
    canHandle: (ref, meta) =>
        ref.type === 'asset' &&
        ((meta?.mime ?? '').startsWith('image/') || IMAGE_EXT.test(meta?.name ?? '')),
    render: () => import('./renderers/ImageAssetRenderer').then((m) => m.default),
    priority: 100,
};

export const markdownAssetRenderer: ContentRenderer = {
    canHandle: (ref, meta) =>
        ref.type === 'asset' &&
        ((meta?.mime ?? '').startsWith('text/markdown') ||
            meta?.kind === 'markdown' ||
            MARKDOWN_EXT.test(meta?.name ?? '')),
    render: () => import('./renderers/MarkdownAssetRenderer').then((m) => m.default),
    priority: 100,
};

export const codeAssetRenderer: ContentRenderer = {
    canHandle: (ref, meta) =>
        ref.type === 'asset' && (meta?.kind === 'code' || CODE_EXT.test(meta?.name ?? '')),
    render: () => import('./renderers/CodeAssetRenderer').then((m) => m.default),
    priority: 90,
};

export const plainTextAssetRenderer: ContentRenderer = {
    // 兜底：meta 取数失败（undefined）或文本类 mime/kind。已知二进制非图片/PDF → 无渲染器（空态）。
    canHandle: (ref, meta) =>
        ref.type === 'asset' &&
        (meta === undefined ||
            (meta.mime ?? '').startsWith('text/') ||
            meta.kind === 'text' ||
            meta.kind === 'csv' ||
            meta.kind === 'docx'),
    render: () => import('./renderers/PlainTextAssetRenderer').then((m) => m.default),
    priority: 10,
};

registerContentRenderer(imageAssetRenderer);
registerContentRenderer(markdownAssetRenderer);
registerContentRenderer(codeAssetRenderer);
registerContentRenderer(plainTextAssetRenderer);
```

- [ ] **Step 6.6: 运行确认通过**

Run: `pnpm --filter web exec vitest run src/components/ContentPanel`
Expected: 全部 PASS（渲染器 7 用例 + 既有用例零回归）

- [ ] **Step 6.7: Commit**

```bash
git add apps/web/src/components/ContentPanel/hooks/useAssetText.ts apps/web/src/components/ContentPanel/renderers/ImageAssetRenderer.tsx apps/web/src/components/ContentPanel/renderers/MarkdownAssetRenderer.tsx apps/web/src/components/ContentPanel/renderers/CodeAssetRenderer.tsx apps/web/src/components/ContentPanel/renderers/PlainTextAssetRenderer.tsx apps/web/src/components/ContentPanel/renderers/renderers.test.tsx apps/web/src/components/ContentPanel/builtin.ts
git commit -m "feat(web): built-in asset renderers (image/markdown/code/plain-text) with registry dispatch"
```

---

### Task 7: PDF 渲染器（pdfjs-dist 懒加载 chunk + worker）

**Files:**
- Modify: `apps/web/package.json`（新增依赖 pdfjs-dist）
- Modify: `apps/web/vite.config.ts`（manualChunks 加 pdf-vendor）
- Create: `apps/web/src/components/ContentPanel/renderers/pdfjs.ts`
- Create: `apps/web/src/components/ContentPanel/renderers/PdfAssetRenderer.tsx`
- Create: `apps/web/src/components/ContentPanel/renderers/PdfAssetRenderer.test.tsx`
- Modify: `apps/web/src/components/ContentPanel/builtin.ts`（注册 PDF）

**前置：** 端到端验收前置 plan A 已执行；本任务代码与单测只依赖 `/raw` API 契约（mock）。

- [ ] **Step 7.1: 安装依赖**

Run: `pnpm --filter web add pdfjs-dist`
Expected: 安装成功（约 ^5.x）

- [ ] **Step 7.2: 写失败测试**

创建 `apps/web/src/components/ContentPanel/renderers/PdfAssetRenderer.test.tsx`：

```tsx
// PDF 渲染器测试：pdfjs 全量 mock（jsdom 无 canvas/worker），验证取数、
// 页数状态、翻页控件与 worker 配置模块。

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { api } from '../../../api';

vi.mock('../../../api', () => ({
    api: {
        fetchAssetRaw: vi.fn(),
    },
}));

const getDocumentMock = vi.fn();
const destroyMock = vi.fn();
vi.mock('pdfjs-dist', () => ({
    GlobalWorkerOptions: { workerSrc: '' },
    getDocument: (...args: unknown[]) => getDocumentMock(...args),
}));

const fetchAssetRawMock = vi.mocked(api.fetchAssetRaw);

function fakeDoc(numPages: number) {
    return {
        numPages,
        destroy: destroyMock,
        getPage: vi.fn(async (n: number) => ({
            getViewport: ({ scale }: { scale: number }) => ({ width: 100 * scale, height: 140 * scale }),
            // jsdom canvas.getContext 返回 null → render 被跳过（组件已守卫）
            render: vi.fn(() => ({ promise: Promise.resolve() })),
            pageIndex: n - 1,
        })),
    };
}

describe('PdfAssetRenderer', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getDocumentMock.mockReturnValue({ promise: Promise.resolve(fakeDoc(2)) });
        fetchAssetRawMock.mockResolvedValue(
            new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), {
                headers: { 'content-type': 'application/pdf' },
            }),
        );
    });

    it('取 raw → getDocument({data}) → 页数与翻页控件', async () => {
        const { default: PdfAssetRenderer } = await import('./PdfAssetRenderer');
        render(<PdfAssetRenderer ref={{ type: 'asset', assetId: 'p1' }} />);
        expect(await screen.findByText('1 / 2')).toBeTruthy();
        expect(getDocumentMock).toHaveBeenCalledTimes(1);
        expect((getDocumentMock.mock.calls[0][0] as { data: Uint8Array }).data.byteLength).toBe(4);
    });

    it('翻页：下一页 → 第 2 页；首页禁用上一页', async () => {
        const { default: PdfAssetRenderer } = await import('./PdfAssetRenderer');
        render(<PdfAssetRenderer ref={{ type: 'asset', assetId: 'p1' }} />);
        await screen.findByText('1 / 2');
        const prev = screen.getByRole('button', { name: '上一页' }) as HTMLButtonElement;
        expect(prev.disabled).toBe(true);
        fireEvent.click(screen.getByRole('button', { name: '下一页' }));
        expect(await screen.findByText('2 / 2')).toBeTruthy();
    });

    it('取数失败 → 错误态', async () => {
        fetchAssetRawMock.mockRejectedValue(new Error('HTTP 404'));
        const { default: PdfAssetRenderer } = await import('./PdfAssetRenderer');
        render(<PdfAssetRenderer ref={{ type: 'asset', assetId: 'p1' }} />);
        expect(await screen.findByTestId('pdf-asset-error')).toBeTruthy();
    });

    it('worker 配置模块设置 GlobalWorkerOptions.workerSrc', async () => {
        const { pdfjsLib } = await import('./pdfjs');
        expect(pdfjsLib.GlobalWorkerOptions.workerSrc).toContain('pdf.worker');
    });
});
```

- [ ] **Step 7.3: 运行确认失败**

Run: `pnpm --filter web exec vitest run src/components/ContentPanel/renderers/PdfAssetRenderer.test.tsx`
Expected: FAIL（module not found）

- [ ] **Step 7.4: 实现 pdfjs 配置模块与渲染器**

创建 `apps/web/src/components/ContentPanel/renderers/pdfjs.ts`：

```ts
// pdfjs.ts — pdf.js 运行时配置（独立模块：仅被 PdfAssetRenderer 动态 import，
// pdfjs 永不进主 bundle；worker 以 ?url 资产引入，Vite 解析为构建产物 URL）。

import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export { pdfjsLib };
```

（`?url` 模块声明由 `vite/client` 类型提供——仓库已用 `?react`（svgr）同机制，`apps/web/src/vite-env.d.ts` 的 `/// <reference types="vite/client" />` 已覆盖。）

创建 `apps/web/src/components/ContentPanel/renderers/PdfAssetRenderer.tsx`：

```tsx
// PdfAssetRenderer - 资产 PDF 渲染器：认证 fetch → ArrayBuffer → pdf.js 分页渲染。
// pdfjs 经独立模块动态 import（自动分包）；canvas 2d 上下文不可用时跳过绘制
// （jsdom 测试环境守卫，浏览器恒可用）。

import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { ContentRendererProps } from '../registry';

export default function PdfAssetRenderer({ ref: contentRef }: ContentRendererProps) {
    const assetId = contentRef.type === 'asset' ? contentRef.assetId : '';
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
    const [pageNumber, setPageNumber] = useState(1);
    const [error, setError] = useState<string | null>(null);

    // 加载文档（assetId 变化时重建）
    useEffect(() => {
        let cancelled = false;
        setDoc(null);
        setPageNumber(1);
        setError(null);

        (async () => {
            const [{ pdfjsLib }, { api }] = await Promise.all([
                import('./pdfjs'),
                import('../../../api'),
            ]);
            const res = await api.fetchAssetRaw(assetId);
            const data = new Uint8Array(await res.arrayBuffer());
            const loaded = await pdfjsLib.getDocument({ data }).promise;
            if (cancelled) {
                loaded.destroy();
                return;
            }
            setDoc(loaded);
        })().catch((e) => {
            if (!cancelled) setError(e instanceof Error ? e.message : String(e));
        });

        return () => {
            cancelled = true;
        };
    }, [assetId]);

    // 文档切换/卸载时销毁旧文档（释放 worker 资源）
    useEffect(() => {
        return () => {
            doc?.destroy();
        };
    }, [doc]);

    // 渲染当前页
    useEffect(() => {
        if (!doc) return;
        let cancelled = false;
        (async () => {
            const page = await doc.getPage(Math.min(pageNumber, doc.numPages));
            if (cancelled) return;
            const canvas = canvasRef.current;
            if (!canvas) return;
            const ctx = canvas.getContext('2d');
            if (!ctx) return; // jsdom 等无 canvas 环境
            const containerWidth = canvas.parentElement?.clientWidth || 600;
            const base = page.getViewport({ scale: 1 });
            const scale = Math.max(0.5, Math.min(2, containerWidth / base.width));
            const viewport = page.getViewport({ scale });
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            await page.render({ canvasContext: ctx, viewport }).promise;
        })().catch((e) => {
            if (!cancelled) setError(e instanceof Error ? e.message : String(e));
        });
        return () => {
            cancelled = true;
        };
    }, [doc, pageNumber]);

    if (error) {
        return (
            <div data-testid="pdf-asset-error" className="p-6 text-sm text-error-600">
                PDF 加载失败：{error}
            </div>
        );
    }
    return (
        <div className="flex h-full flex-col">
            <div className="flex shrink-0 items-center justify-center gap-3 border-b border-border-base bg-bg-elevated px-4 py-1.5 text-[12px] text-text-secondary">
                <button
                    type="button"
                    aria-label="上一页"
                    disabled={!doc || pageNumber <= 1}
                    onClick={() => setPageNumber((n) => Math.max(1, n - 1))}
                    className="rounded px-2 py-0.5 hover:bg-bg-hover disabled:opacity-40"
                >
                    上一页
                </button>
                <span className="font-mono">
                    {doc ? `${Math.min(pageNumber, doc.numPages)} / ${doc.numPages}` : '加载中…'}
                </span>
                <button
                    type="button"
                    aria-label="下一页"
                    disabled={!doc || pageNumber >= doc.numPages}
                    onClick={() => setPageNumber((n) => n + 1)}
                    className="rounded px-2 py-0.5 hover:bg-bg-hover disabled:opacity-40"
                >
                    下一页
                </button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-4">
                <canvas ref={canvasRef} className="mx-auto block max-w-full" />
            </div>
        </div>
    );
}
```

- [ ] **Step 7.5: 注册 PDF 渲染器**

`apps/web/src/components/ContentPanel/builtin.ts` 修改两点：

1. `plainTextAssetRenderer` 定义之后追加：

```ts
const PDF_EXT = /\.pdf$/i;

export const pdfAssetRenderer: ContentRenderer = {
    canHandle: (ref, meta) =>
        ref.type === 'asset' &&
        (meta?.mime === 'application/pdf' || PDF_EXT.test(meta?.name ?? '')),
    render: () => import('./renderers/PdfAssetRenderer').then((m) => m.default),
    priority: 100,
};
```

2. 注册调用区追加一行：

```ts
registerContentRenderer(pdfAssetRenderer);
```

- [ ] **Step 7.6: vite 独立 chunk**

`apps/web/vite.config.ts` 的 `manualChunks` 函数内、`utils-vendor` 分支之后追加：

```ts
          // pdf.js 体积大且仅 PDF 渲染器动态使用：独立 chunk，配合渲染器懒加载
          if (id.includes('pdfjs-dist')) {
            return 'pdf-vendor'
          }
```

- [ ] **Step 7.7: 运行确认通过**

Run: `pnpm --filter web exec vitest run src/components/ContentPanel/renderers/PdfAssetRenderer.test.tsx`
Expected: PASS（4 个用例）

Run: `pnpm --filter web exec vitest run src/components/ContentPanel`
Expected: 全部 PASS（注册表分派用例零回归——既有断言的 mime 均非 application/pdf）

- [ ] **Step 7.8: 构建验证（chunk 隔离）**

Run: `pnpm --filter web build`
Expected: 构建成功；产物中出现独立的 `pdf-vendor` chunk（pdfjs 不进 index/main chunk）

- [ ] **Step 7.9: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml apps/web/vite.config.ts apps/web/src/components/ContentPanel/renderers/pdfjs.ts apps/web/src/components/ContentPanel/renderers/PdfAssetRenderer.tsx apps/web/src/components/ContentPanel/renderers/PdfAssetRenderer.test.tsx apps/web/src/components/ContentPanel/builtin.ts
git commit -m "feat(web): PDF asset renderer with lazy pdfjs chunk and worker"
```

---

### Task 8: Trace 视图 + AgentTimeline 入口 + 审批记录 API

**Files:**
- Modify: `apps/server/src/repo/tool-approval.ts`（新增 listSessionToolApprovals）
- Create: `apps/server/src/repo/__tests__/tool-approval.test.ts`
- Modify: `apps/server/src/routes/sessions.ts`（GET /:id/tool-approvals）
- Modify: `apps/server/src/routes/__tests__/sessions.test.ts`（追加用例）
- Modify: `apps/web/src/api/real.ts`（fetchSessionToolApprovals）
- Create: `apps/web/src/components/TraceView/index.tsx` + `index.test.tsx`
- Modify: `apps/web/src/components/common/AgentTimeline.tsx`（「展开」入口）
- Modify: `apps/web/src/components/common/MessageCard.tsx`（传 sessionId/messageId）
- Modify: `apps/web/src/components/ContentPanel/builtin.ts`（注册 trace 渲染器）

**说明:** v1 不动 SSE 协议；trace 数据 = 前端已持有的 `attachTimelines` 产物 + 服务端审批记录（新只读路由，见计划头部对齐说明）。信息密度以 bilibili 卡片为准绳（设计开放问题 3）：条目默认折叠、点击展开参数/结果全文（不受消息流内 2000 字符截断限制）。

- [ ] **Step 8.1: 写失败测试（repo）**

创建 `apps/server/src/repo/__tests__/tool-approval.test.ts`：

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initDatabase, getDb } from '../../db/index.js';
import { createSession } from '../session.js';
import { createToolApproval, listSessionToolApprovals } from '../tool-approval.js';
import type { ToolApproval } from '@my-copilot/shared';

function buildApproval(sessionId: string, toolCallId: string): Omit<
    ToolApproval,
    'approvalId' | 'state' | 'createdAt' | 'updatedAt'
> {
    return {
        runId: 'run-1',
        jobId: null,
        sessionId,
        agentId: 'default',
        tool: { id: 'web_search', name: 'web_search', source: 'builtin', sourceMcpId: null, policyVersion: 'v1' },
        toolCallId,
        arguments: '{"q":"x"}',
        argumentsDigest: 'd',
        resourceScope: '',
        safetyLevel: 'restricted',
        policyVersion: 'v1',
        expiresAt: Date.now() + 60_000,
    };
}

describe('listSessionToolApprovals', () => {
    let testDir: string;

    beforeEach(() => {
        testDir = mkdtempSync(join(tmpdir(), 'tool-approval-'));
        initDatabase(testDir);
    });

    afterEach(() => {
        try {
            getDb().close();
        } catch {
            // ignore
        }
        if (testDir && existsSync(testDir)) {
            rmSync(testDir, { recursive: true, force: true });
        }
    });

    it('按 session 过滤返回（含 state 投影）', () => {
        const s1 = createSession({ title: 'T1' });
        const s2 = createSession({ title: 'T2' });
        createToolApproval(buildApproval(s1.id, 'call_a'));
        createToolApproval(buildApproval(s1.id, 'call_b'));
        createToolApproval(buildApproval(s2.id, 'call_other'));

        const list = listSessionToolApprovals(s1.id);
        expect(list).toHaveLength(2);
        expect(list.map((a) => a.toolCallId).sort()).toEqual(['call_a', 'call_b']);
        expect(list.every((a) => a.sessionId === s1.id)).toBe(true);
        expect(list.every((a) => a.state === 'pending')).toBe(true);
    });

    it('无记录返回空数组', () => {
        const s1 = createSession({ title: 'T' });
        expect(listSessionToolApprovals(s1.id)).toEqual([]);
    });
});
```

- [ ] **Step 8.2: 运行确认失败**

Run: `pnpm --filter server exec vitest run src/repo/__tests__/tool-approval.test.ts`
Expected: FAIL（listSessionToolApprovals 未导出）

- [ ] **Step 8.3: 实现 repo 函数**

`apps/server/src/repo/tool-approval.ts` 文件末尾追加：

```ts
/** 列出某会话的全部审批记录（trace 视图消费，按创建时间升序）。 */
export function listSessionToolApprovals(sessionId: string): ToolApproval[] {
  const rows = getDb()
    .prepare('SELECT * FROM tool_approvals WHERE session_id = ? ORDER BY created_at, approval_id')
    .all(sessionId) as ToolApprovalRow[];
  return rows.map(rowToApproval);
}
```

- [ ] **Step 8.4: 运行确认通过**

Run: `pnpm --filter server exec vitest run src/repo/__tests__/tool-approval.test.ts`
Expected: PASS（2 个用例）

- [ ] **Step 8.5: 写失败测试（route）**

`apps/server/src/routes/__tests__/sessions.test.ts` 修改（mock 区追加 `vi.mock('../../repo/tool-approval.js', () => ({ listSessionToolApprovals: vi.fn() }));`，import 区补 `import { listSessionToolApprovals } from '../../repo/tool-approval.js';`），describe 内追加：

```ts
  const mockApproval = {
    approvalId: 'ap1',
    runId: 'r1',
    jobId: null,
    sessionId: 's1',
    agentId: 'default',
    tool: { id: 'web_search', name: 'web_search', source: 'builtin', sourceMcpId: null, policyVersion: 'v1' },
    toolCallId: 'call_1',
    arguments: '{}',
    argumentsDigest: 'd',
    resourceScope: '',
    safetyLevel: 'restricted',
    policyVersion: 'v1',
    state: 'approved',
    expiresAt: 2,
    createdAt: 1,
    updatedAt: 1,
  };

  it('GET /:id/tool-approvals returns approvals for the session', async () => {
    vi.mocked(getSession).mockReturnValue({ id: 's1' } as never);
    vi.mocked(listSessionToolApprovals).mockReturnValue([mockApproval as never]);

    const app = createTestApp();
    const res = await app.request('/s1/tool-approvals');
    expect(res.status).toBe(200);
    const body = (await res.json()) as ApiResponse;
    expect(body.data).toEqual([mockApproval]);
    expect(vi.mocked(listSessionToolApprovals)).toHaveBeenCalledWith('s1');
  });

  it('GET /:id/tool-approvals returns 404 for unknown session', async () => {
    vi.mocked(getSession).mockReturnValue(undefined);
    const app = createTestApp();
    const res = await app.request('/ghost/tool-approvals');
    expect(res.status).toBe(404);
  });
```

- [ ] **Step 8.6: 运行确认失败**

Run: `pnpm --filter server exec vitest run src/routes/__tests__/sessions.test.ts`
Expected: 新用例 FAIL（404，路由不存在）

- [ ] **Step 8.7: 实现路由**

`apps/server/src/routes/sessions.ts` 修改两点：

1. import 区补：

```ts
import { listSessionToolApprovals } from '../repo/tool-approval.js';
```

2. `sessionsApp.get('/:id', ...)` 与 `sessionsApp.patch('/:id', ...)` 之间插入：

```ts
// GET /:id/tool-approvals — trace 视图的审批记录数据源（content-panel 设计）。
sessionsApp.get('/:id/tool-approvals', (c) => {
  const id = c.req.param('id');
  if (!getSession(id)) {
    throw new HttpError(404, 'Session not found');
  }
  return successResponse(c, listSessionToolApprovals(id));
});
```

- [ ] **Step 8.8: 运行确认通过 + server 回归**

Run: `pnpm --filter server exec vitest run src/routes/__tests__/sessions.test.ts src/repo/__tests__/tool-approval.test.ts src/tools/__tests__/confirmation.test.ts`
Expected: 全部 PASS（confirmation.test.ts 同表读写零回归）

- [ ] **Step 8.9: web API 函数**

`apps/web/src/api/real.ts` 在 Assets API 区块之后追加（文件头部 shared import 列表补 `ToolApproval`）：

```ts
/**
 * Fetch tool approval records for a session (trace view data source)
 * GET /api/sessions/:id/tool-approvals
 */
export async function fetchSessionToolApprovals(sessionId: string): Promise<ToolApproval[]> {
    const response = await enhancedFetch<{ data: ToolApproval[] }>(
        `/api/sessions/${sessionId}/tool-approvals`,
        { method: 'GET', timeout: 30000 },
    );
    return response.data;
}
```

- [ ] **Step 8.10: 写失败测试（TraceView + AgentTimeline 入口）**

创建 `apps/web/src/components/TraceView/index.test.tsx`：

```tsx
// TraceView 测试：时间线数据消费、审批关联、token/耗时摘要、空态；
// AgentTimeline「展开」入口 → contentPanelStore 会话 tab。

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Message } from '@my-copilot/shared';
import { api } from '../../api';
import { useSessionStore } from '../../store/sessionStore';
import { useContentPanelStore } from '../../store/contentPanelStore';
import TraceView from './index';
import AgentTimeline from '../common/AgentTimeline';

vi.mock('../../api', () => ({
    api: { fetchSessionToolApprovals: vi.fn() },
}));

const fetchApprovalsMock = vi.mocked(api.fetchSessionToolApprovals);

function seedMessages(): Message[] {
    const now = Date.now();
    return [
        { id: 'u1', sessionId: 's1', role: 'user', content: 'q', attachments: [], status: 'sent', createdAt: now },
        {
            id: 'mid1', sessionId: 's1', role: 'assistant', content: '调用工具中…',
            attachments: [], status: 'sent', createdAt: now + 1,
            toolCalls: [{ id: 'call_1', name: 'web_search', arguments: '{"q":"x"}' }],
        },
        { id: 'tr1', sessionId: 's1', role: 'tool', content: '{"results":[]}', attachments: [], status: 'sent', createdAt: now + 2, toolCallId: 'call_1' },
        { id: 'm1', sessionId: 's1', role: 'assistant', content: '最终回答', attachments: [], status: 'sent', createdAt: now + 3 },
    ] as Message[];
}

function reset() {
    useSessionStore.setState({ messagesCache: { s1: seedMessages() } });
    useContentPanelStore.setState({
        globalTabs: [], sessionTabs: {}, activeGlobalTabId: null,
        activeSessionTabId: {}, activeScope: 'global', panelOpen: false,
    });
}

describe('TraceView', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        reset();
    });

    it('消费 attachTimelines 产物：渲染步骤条目（工具名）与摘要', async () => {
        fetchApprovalsMock.mockResolvedValue([]);
        render(<TraceView ref={{ type: 'trace', sessionId: 's1', messageId: 'm1' }} />);
        expect(await screen.findByText('web_search')).toBeTruthy();
        expect(screen.getByTestId('trace-run-summary').textContent).toContain('1 步');
    });

    it('审批记录按 toolCallId 关联为徽标（安全级别 + 状态）', async () => {
        fetchApprovalsMock.mockResolvedValue([
            {
                approvalId: 'ap1', runId: 'r1', jobId: null, sessionId: 's1', agentId: 'default',
                tool: { id: 'web_search', name: 'web_search', source: 'builtin', sourceMcpId: null, policyVersion: 'v1' },
                toolCallId: 'call_1', arguments: '{}', argumentsDigest: 'd', resourceScope: '',
                safetyLevel: 'restricted', policyVersion: 'v1', state: 'approved',
                expiresAt: 2, createdAt: 1, updatedAt: 1,
            },
        ]);
        render(<TraceView ref={{ type: 'trace', sessionId: 's1', messageId: 'm1' }} />);
        const badge = await screen.findByTestId('approval-badge');
        expect(badge.textContent).toContain('已批准');
        expect(badge.textContent).toContain('受限');
    });

    it('会话级 trace（无 messageId）聚合全部 run；无数据时显示空态', async () => {
        fetchApprovalsMock.mockResolvedValue([]);
        render(<TraceView ref={{ type: 'trace', sessionId: 's1' }} />);
        expect(await screen.findByText('web_search')).toBeTruthy();

        render(<TraceView ref={{ type: 'trace', sessionId: 'ghost' }} />);
        expect(screen.getByTestId('trace-empty')).toBeTruthy();
    });
});

describe('AgentTimeline 展开入口', () => {
    beforeEach(() => reset());

    it('提供 sessionId/messageId 时渲染「展开」按钮，点击打开会话 trace tab', () => {
        render(
            <AgentTimeline
                entries={[
                    { kind: 'tool', id: 'call_1', name: 'web_search', status: 'done', startedAt: 1, endedAt: 2 },
                ]}
                sessionId="s1"
                messageId="m1"
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: '在内容栏展开完整过程' }));
        const s = useContentPanelStore.getState();
        expect(s.sessionTabs['s1']).toHaveLength(1);
        expect(s.sessionTabs['s1'][0].ref).toEqual({ type: 'trace', sessionId: 's1', messageId: 'm1' });
        expect(s.activeSessionTabId['s1']).toBe(s.sessionTabs['s1'][0].tabId);
        expect(s.panelOpen).toBe(true);
    });

    it('未提供 sessionId/messageId 时不渲染入口（既有行为零回归）', () => {
        render(<AgentTimeline entries={[{ kind: 'lead', id: 'l1', text: '前导' }]} />);
        expect(screen.queryByRole('button', { name: '在内容栏展开完整过程' })).toBeNull();
    });
});
```

- [ ] **Step 8.11: 运行确认失败**

Run: `pnpm --filter web exec vitest run src/components/TraceView/index.test.tsx`
Expected: FAIL（module not found / 按钮不存在）

- [ ] **Step 8.12: 实现 TraceView**

创建 `apps/web/src/components/TraceView/index.tsx`：

```tsx
// TraceView - agent 过程全量展开视图（content-panel 设计）。
//
// 数据源：现有 attachTimelines 产物（前端已持有，v1 不动 SSE 协议）+
// 审批记录（GET /api/sessions/:id/tool-approvals，按 toolCallId 关联）。
// 信息密度以 bilibili 卡片为准绳：条目默认折叠，点击展开参数/结果全文
// （不受消息流内 2000 字符截断限制）。

import { useEffect, useMemo, useState } from 'react';
import type { ToolApproval } from '@my-copilot/shared';
import { useSessionStore } from '../../store/sessionStore';
import { attachTimelines, asTimelineMessages } from '../../utils/timeline';
import type { MessageWithTimeline, TimelineEntry } from '../../types/timeline';
import { api } from '../../api';
import type { ContentRendererProps } from '../ContentPanel/registry';

/** 粗略 token 估算（≈4 字符/token；UI 标注为估算值）。 */
function estimateTokens(text: string | undefined): number {
    return text ? Math.ceil(text.length / 4) : 0;
}

function entryTokens(entry: TimelineEntry): number {
    switch (entry.kind) {
        case 'reasoning':
            return estimateTokens(entry.text);
        case 'lead':
            return estimateTokens(entry.text);
        case 'tool':
            return estimateTokens(entry.args) + estimateTokens(entry.result);
    }
}

const APPROVAL_STATE_LABEL: Record<string, string> = {
    pending: '待确认',
    approved: '已批准',
    rejected: '已拒绝',
    expired: '已过期',
    cancelled: '已取消',
};

const SAFETY_LABEL: Record<string, string> = {
    safe: '安全',
    restricted: '受限',
    danger: '高风险',
};

function prettyJson(raw: string | undefined): string {
    if (raw === undefined) return '';
    try {
        return JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
        return raw;
    }
}

export default function TraceView({ ref: contentRef }: ContentRendererProps) {
    if (contentRef.type !== 'trace') return null;
    return <TraceRunList sessionId={contentRef.sessionId} messageId={contentRef.messageId} />;
}

function TraceRunList({ sessionId, messageId }: { sessionId: string; messageId?: string }) {
    const messagesCache = useSessionStore((s) => s.messagesCache);
    const [approvals, setApprovals] = useState<ToolApproval[] | null>(null);

    useEffect(() => {
        let cancelled = false;
        api.fetchSessionToolApprovals(sessionId)
            .then((list) => {
                if (!cancelled) setApprovals(list);
            })
            .catch(() => {
                if (!cancelled) setApprovals([]);
            });
        return () => {
            cancelled = true;
        };
    }, [sessionId]);

    const runs = useMemo(() => {
        const messages = messagesCache[sessionId] ?? [];
        const withTimelines = attachTimelines(asTimelineMessages(messages)).filter(
            (m): m is MessageWithTimeline =>
                m.role === 'assistant' && Array.isArray(m.timeline) && m.timeline.length > 0,
        );
        return messageId === undefined ? withTimelines : withTimelines.filter((m) => m.id === messageId);
    }, [messagesCache, sessionId, messageId]);

    const approvalByToolCallId = useMemo(
        () => new Map((approvals ?? []).map((a) => [a.toolCallId, a])),
        [approvals],
    );

    if (runs.length === 0) {
        return (
            <div data-testid="trace-empty" className="p-6 text-sm text-text-tertiary">
                没有可展示的执行过程（会话无工具调用记录，或消息尚未加载）。
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-4 overflow-auto p-4" aria-label="agent 执行过程 trace">
            {runs.map((run) => (
                <TraceRun key={run.id} entries={run.timeline ?? []} approvalByToolCallId={approvalByToolCallId} />
            ))}
        </div>
    );
}

function TraceRun({
    entries,
    approvalByToolCallId,
}: {
    entries: TimelineEntry[];
    approvalByToolCallId: Map<string, ToolApproval>;
}) {
    const totalTokens = entries.reduce((sum, e) => sum + entryTokens(e), 0);
    const toolEntries = entries.filter((e): e is Extract<TimelineEntry, { kind: 'tool' }> => e.kind === 'tool');
    const wallMs =
        toolEntries.length > 0
            ? Math.max(...toolEntries.map((e) => e.endedAt ?? e.startedAt)) -
              Math.min(...toolEntries.map((e) => e.startedAt))
            : 0;

    return (
        <section className="flex flex-col gap-2 rounded-xl border border-border-base bg-bg-secondary/60 p-3">
            <div data-testid="trace-run-summary" className="flex items-center gap-3 text-[12px] text-text-secondary">
                <span className="font-medium text-text-primary">{entries.length} 步</span>
                <span>工具 {toolEntries.length} 次</span>
                {wallMs > 0 && <span className="font-mono">{(wallMs / 1000).toFixed(1)}s</span>}
                <span className="font-mono" title="按字符数估算（≈4 字符/token），非精确值">
                    ≈{totalTokens} tokens（估算）
                </span>
            </div>
            <div className="flex flex-col gap-1.5">
                {entries.map((entry) => (
                    <TraceEntryRow key={entry.id} entry={entry} approvalByToolCallId={approvalByToolCallId} />
                ))}
            </div>
        </section>
    );
}

function TraceEntryRow({
    entry,
    approvalByToolCallId,
}: {
    entry: TimelineEntry;
    approvalByToolCallId: Map<string, ToolApproval>;
}) {
    const [expanded, setExpanded] = useState(false);
    const icon = entry.kind === 'reasoning' ? '🧠' : entry.kind === 'lead' ? '💬' : '🔧';
    const approval = entry.kind === 'tool' ? approvalByToolCallId.get(entry.id) : undefined;
    const hasDetail =
        entry.kind === 'reasoning' || entry.kind === 'lead'
            ? entry.text.length > 0
            : entry.args !== undefined || entry.result !== undefined;

    return (
        <div className="rounded-md border border-border-light bg-bg-elevated">
            <button
                type="button"
                onClick={() => hasDetail && setExpanded((v) => !v)}
                disabled={!hasDetail}
                aria-expanded={expanded}
                className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px] text-text-secondary hover:bg-bg-hover/50 disabled:cursor-default"
            >
                <span aria-hidden>{icon}</span>
                <span className="font-mono truncate">
                    {entry.kind === 'tool'
                        ? entry.name || '…'
                        : entry.kind === 'reasoning'
                          ? '思考过程'
                          : '前导说明'}
                </span>
                {entry.kind === 'tool' && entry.status === 'error' && (
                    <span className="font-bold text-error-600" aria-hidden>✗</span>
                )}
                {entry.kind === 'tool' && entry.endedAt !== undefined && (
                    <span className="font-mono text-[10px] text-text-tertiary">
                        {((entry.endedAt - entry.startedAt) / 1000).toFixed(1)}s
                    </span>
                )}
                {approval && (
                    <span
                        data-testid="approval-badge"
                        className="ml-auto shrink-0 rounded border border-border-base bg-bg-tertiary/60 px-1.5 py-0.5 text-[10px] text-text-secondary"
                    >
                        {SAFETY_LABEL[approval.safetyLevel] ?? approval.safetyLevel} ·{' '}
                        {APPROVAL_STATE_LABEL[approval.state] ?? approval.state}
                    </span>
                )}
            </button>
            {expanded && hasDetail && (
                <div className="flex flex-col gap-2 border-t border-border-light px-2.5 pb-2.5 pt-1.5">
                    {entry.kind === 'tool' && entry.args !== undefined && (
                        <div className="flex flex-col gap-1">
                            <span className="text-[10px] text-text-tertiary">参数</span>
                            <pre className="m-0 max-h-[320px] overflow-auto font-mono text-[11px] text-text-secondary">
                                {prettyJson(entry.args)}
                            </pre>
                        </div>
                    )}
                    {entry.kind === 'tool' && entry.result !== undefined && (
                        <div
                            className={`flex flex-col gap-1 rounded-md p-1.5 ${
                                entry.isError ? 'border border-error-200 bg-error-50' : ''
                            }`}
                        >
                            <span className={`text-[10px] ${entry.isError ? 'text-error-700' : 'text-text-tertiary'}`}>
                                {entry.isError ? '结果（错误）' : '结果'}
                            </span>
                            <pre className="m-0 max-h-[480px] overflow-auto font-mono text-[11px] text-text-secondary">
                                {entry.result}
                            </pre>
                        </div>
                    )}
                    {(entry.kind === 'reasoning' || entry.kind === 'lead') && (
                        <p className="m-0 whitespace-pre-wrap text-[12px] leading-relaxed text-text-secondary">
                            {entry.text}
                        </p>
                    )}
                </div>
            )}
        </div>
    );
}
```

- [ ] **Step 8.13: AgentTimeline 加「展开」入口**

`apps/web/src/components/common/AgentTimeline.tsx` 修改两点：

1. import 区补（`import PluginCardHost ...` 之后）：

```tsx
import { PanelRightOpen } from 'lucide-react'
import { useContentPanelStore } from '../../store/contentPanelStore'
```

2. props 与组件头部改为（`entries.map` 起的既有渲染体原样保留）：

```tsx
export interface AgentTimelineProps {
  /** 时间线条目（有序：按发生顺序）。 */
  entries: TimelineEntry[]
  /** 流式进行中（当前消息 sending）：running 的 tool 条目与未完成 reasoning 默认展开。 */
  live?: boolean
  /** 提供时渲染「在内容栏展开」入口（content-panel 设计：trace 会话 tab）。 */
  sessionId?: string
  /** 与 sessionId 配对使用（入口只在能定位单条消息时间线时出现）。 */
  messageId?: string
}

/**
 * 过程时间线。entries 为空数组或 undefined 时不渲染。
 * 纵向排列（gap 6px），供 MessageCard 在正文之上挂载。
 */
export default function AgentTimeline({ entries, live = false, sessionId, messageId }: AgentTimelineProps) {
  if (!entries || entries.length === 0) return null

  return (
    <div className="flex flex-col gap-1.5" aria-label="执行过程时间线">
      {sessionId !== undefined && messageId !== undefined && (
        <div className="flex items-center justify-end">
          <button
            type="button"
            aria-label="在内容栏展开完整过程"
            title="在内容栏展开完整过程"
            onClick={() =>
              useContentPanelStore.getState().openTab({
                ref: { type: 'trace', sessionId, messageId },
                title: '执行过程',
                scope: 'session',
                sessionId,
                origin: 'user',
              })
            }
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-text-tertiary hover:text-primary-600"
          >
            <PanelRightOpen className="h-3 w-3" aria-hidden />
            展开
          </button>
        </div>
      )}
      {entries.map((entry) => {
```

然后 `apps/web/src/components/common/MessageCard.tsx` 的 AgentTimeline 调用（约 323 行）改为：

```tsx
            <AgentTimeline
              entries={(message as MessageWithTimeline).timeline ?? []}
              live={isSending}
              sessionId={message.sessionId}
              messageId={message.id}
            />
```

- [ ] **Step 8.14: 注册 trace 渲染器**

`apps/web/src/components/ContentPanel/builtin.ts` 修改两点：

1. `pdfAssetRenderer` 定义之后追加：

```ts
export const traceRenderer: ContentRenderer = {
    canHandle: (ref) => ref.type === 'trace',
    render: () => import('../../TraceView').then((m) => m.default),
    priority: 100,
};
```

2. 注册调用区追加：

```ts
registerContentRenderer(traceRenderer);
```

- [ ] **Step 8.15: 运行确认通过 + 既有组件回归**

Run: `pnpm --filter web exec vitest run src/components/TraceView src/components/common/AgentTimeline.test.tsx`
Expected: 全部 PASS（AgentTimeline 既有用例零回归——新 props 可选，未传时行为不变）

Run: `pnpm --filter web exec vitest run src/components/ContentPanel`
Expected: 全部 PASS

- [ ] **Step 8.16: Commit**

```bash
git add apps/server/src/repo/tool-approval.ts apps/server/src/repo/__tests__/tool-approval.test.ts apps/server/src/routes/sessions.ts apps/server/src/routes/__tests__/sessions.test.ts apps/web/src/api/real.ts apps/web/src/components/TraceView apps/web/src/components/common/AgentTimeline.tsx apps/web/src/components/common/MessageCard.tsx apps/web/src/components/ContentPanel/builtin.ts
git commit -m "feat: agent trace view (timeline + tool approvals API) with expand entry on timeline card"
```

---

### Task 9: PanelHost SDK（iframe 宿主推广 + 面板协议四件套）

**Files:**
- Create: `apps/web/src/components/common/pluginRendererEntry.ts` + `.test.ts`（自 PluginCardHost 抽出的入口缓存）
- Modify: `apps/web/src/components/PluginCardHost/index.tsx`（改用共享模块；行为不变）
- Create: `apps/web/src/components/PanelHost/protocol.ts`
- Create: `apps/web/src/components/PanelHost/index.tsx` + `index.test.tsx`
- Create: `apps/web/src/components/ContentPanel/renderers/PluginPanelRenderer.tsx`
- Modify: `apps/web/src/components/ContentPanel/builtin.ts`（注册插件面板兜底渲染器）

**硬约束:** 卡片协议（`render/rendered/error/open`）语义不变；`PluginCardHost` 仅替换入口缓存来源，**既有测试文件零改动且全绿**。postMessage 消息类型一经发布即公共 API：新增可以，改名/改语义禁止。

- [ ] **Step 9.1: 写失败测试（入口缓存抽取）**

创建 `apps/web/src/components/common/pluginRendererEntry.test.ts`：

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchPluginRendererEntry, peekPluginRendererEntry } from './pluginRendererEntry';
import { api } from '../../api';

vi.mock('../../api', () => ({
    api: { fetchPluginFrontend: vi.fn() },
}));

const fetchMock = vi.mocked(api.fetchPluginFrontend);

describe('pluginRendererEntry', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('拉取入口并缓存；二次调用命中缓存不再请求', async () => {
        fetchMock.mockResolvedValue('<html>entry</html>');
        const first = await fetchPluginRendererEntry('p1');
        expect(first).toBe('<html>entry</html>');
        const second = await fetchPluginRendererEntry('p1');
        expect(second).toBe('<html>entry</html>');
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('失败不缓存（下次重试）；peek 可读取已缓存值', async () => {
        fetchMock.mockRejectedValueOnce(new Error('409'));
        await expect(fetchPluginRendererEntry('p2')).rejects.toThrow('409');
        expect(peekPluginRendererEntry('p2')).toBeUndefined();

        fetchMock.mockResolvedValue('<html>e2</html>');
        await fetchPluginRendererEntry('p2');
        expect(peekPluginRendererEntry('p2')).toBe('<html>e2</html>');
    });
});
```

- [ ] **Step 9.2: 运行确认失败 → 实现共享模块**

Run: `pnpm --filter web exec vitest run src/components/common/pluginRendererEntry.test.ts`
Expected: FAIL（module not found）

创建 `apps/web/src/components/common/pluginRendererEntry.ts`：

```ts
// pluginRendererEntry.ts — 插件渲染器入口 HTML 的模块级缓存 + 拉取。
// 自 PluginCardHost 抽出（PanelHost 复用同一缓存；卡片路径行为不变）。

import { api } from '../../api';

const htmlCache = new Map<string, string>();

/** 命中缓存返回缓存值，否则拉取（失败 throw，调用方兜底；失败不缓存）。 */
export function fetchPluginRendererEntry(pluginId: string): Promise<string> {
    const cached = htmlCache.get(pluginId);
    if (cached !== undefined) return Promise.resolve(cached);
    return api.fetchPluginFrontend(pluginId).then((html) => {
        htmlCache.set(pluginId, html);
        return html;
    });
}

/** 同步读取缓存值（组件复用实例切换插件时的渲染期重置用）。 */
export function peekPluginRendererEntry(pluginId: string): string | undefined {
    return htmlCache.get(pluginId);
}
```

- [ ] **Step 9.3: PluginCardHost 改用共享模块（行为不变）**

`apps/web/src/components/PluginCardHost/index.tsx` 修改三点：

1. import 区补（`import { api } from '../../api'` 一行删除，替换为）：

```tsx
import { fetchPluginRendererEntry, peekPluginRendererEntry } from '../common/pluginRendererEntry'
```

2. 删除模块级 `const htmlCache = new Map<string, string>()`（第 19-20 行）。

3. 三处缓存引用替换：
   - `useState<string | null>(htmlCache.get(pluginId) ?? null)` → `useState<string | null>(peekPluginRendererEntry(pluginId) ?? null)`
   - 渲染期重置块中 `setHtml(htmlCache.get(pluginId) ?? null)` → `setHtml(peekPluginRendererEntry(pluginId) ?? null)`
   - 入口拉取 effect 体改为：

```tsx
  // 拉取渲染器入口（缓存命中时 html 非 null，effect 直接跳过；失败 → 兜底）
  useEffect(() => {
    if (html !== null) return
    let cancelled = false
    fetchPluginRendererEntry(pluginId)
      .then((entry) => {
        if (!cancelled) setHtml(entry)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [pluginId, html])
```

Run: `pnpm --filter web exec vitest run src/components/PluginCardHost/index.test.tsx`
Expected: PASS（既有测试文件零改动、全绿——卡片协议回归锚点）

- [ ] **Step 9.4: 实现协议模块 protocol.ts**

创建 `apps/web/src/components/PanelHost/protocol.ts`：

```ts
// protocol.ts — 内容栏面板协议（PanelHost SDK，content-panel 设计）。
//
// 在 bilibili 卡片协议（render/ready/rendered/error/open）之上扩展的面板
// 四件套：生命周期（mount/update/activate/deactivate）、尺寸（resize，宿主→
// 面板——全高面板与卡片方向相反）、主题（theme token 推送）、受控导航
// （openTab/closeTab，宿主仲裁）。消息类型一经发布即公共 API：新增可以，
// 改名/改语义禁止。
//
// 安全模型不变：null origin 沙箱 iframe（sandbox="allow-scripts"，无
// allow-same-origin）+ 宿主按 contentWindow（+ requestId）过滤消息 +
// 外链仅 https 放行。closeTab 默认仅允许关自己；openTab 的 panel 类 ref
// 限定请求方插件自身（防跨插件劫持）。

import type { ContentRef } from '../../types/content';

/** 协议版本（v1 单调整数，设计开放问题 1）。 */
export const PANEL_PROTOCOL_VERSION = 1;

/** 主题 token 子集（宿主从 Tailwind v4 CSS 变量读取后推送）。 */
export interface PanelThemeTokens {
    bg: string;
    bgElevated: string;
    textPrimary: string;
    textSecondary: string;
    border: string;
    primary: string;
    fontSans: string;
}

/** 读取主题 token（CSS 变量缺省时回退浅色值，保证暗色/自定义主题一致）。 */
export function readPanelThemeTokens(): PanelThemeTokens {
    const styles = getComputedStyle(document.documentElement);
    const read = (name: string, fallback: string): string =>
        styles.getPropertyValue(name).trim() || fallback;
    return {
        bg: read('--color-bg-primary', '#FAF9F6'),
        bgElevated: read('--color-bg-elevated', '#FFFFFF'),
        textPrimary: read('--color-text-primary', '#2C3E50'),
        textSecondary: read('--color-text-secondary', '#5A6C7D'),
        border: read('--color-border-base', '#D5D5D0'),
        primary: read('--color-primary-500', '#4A90E2'),
        fontSans: read('--font-sans', 'system-ui, sans-serif'),
    };
}

/** openTab 仲裁：结构校验 + panel 类 ref 限定请求方插件自身。 */
export function isValidOpenTabRef(ref: unknown, ownPluginId: string): ref is ContentRef {
    if (typeof ref !== 'object' || ref === null) return false;
    const r = ref as { type?: unknown };
    if (r.type === 'asset') {
        return typeof (r as { assetId?: unknown }).assetId === 'string';
    }
    if (r.type === 'trace') {
        return typeof (r as { sessionId?: unknown }).sessionId === 'string';
    }
    if (r.type === 'panel') {
        const p = r as { pluginId?: unknown; panelId?: unknown };
        return p.pluginId === ownPluginId && typeof p.panelId === 'string';
    }
    return false;
}

/** openTab 打开的 tab 标题推导（宿主仲裁的一部分）。 */
export function titleForRef(ref: ContentRef): string {
    switch (ref.type) {
        case 'asset':
            return `资产 ${ref.assetId.slice(0, 8)}`;
        case 'trace':
            return '执行过程';
        case 'panel':
            return ref.panelId;
    }
}
```

（宿主→面板 / 面板→宿主的消息类型随组件实现内联定义于 `index.tsx` 并导出，供测试与后续插件 SDK 文档引用。）

- [ ] **Step 9.5: 写失败测试（PanelHost）**

创建 `apps/web/src/components/PanelHost/index.test.tsx`：

```tsx
// PanelHost 测试：握手（protocolVersion 协商）、四件套消息、受控导航仲裁、
// https 外链放行。模式对齐 PluginCardHost/index.test.tsx（createRoot + act
// + 以 iframe.contentWindow 为 source 派发消息）。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { ReactElement } from 'react';
import PanelHost from './index';
import { useContentPanelStore } from '../../store/contentPanelStore';
import { tabIdForRef } from '../../store/contentPanelStore';

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { fetchPluginFrontendMock } = vi.hoisted(() => ({
    fetchPluginFrontendMock: vi.fn(),
}));
vi.mock('../../api', () => ({
    api: { fetchPluginFrontend: fetchPluginFrontendMock },
}));

const RENDERER_HTML = '<!doctype html><html><body>panel renderer</body></html>';

async function renderAsync(ui: ReactElement): Promise<{
    container: HTMLElement;
    unmount: () => void;
    postMessageSpy: ReturnType<typeof vi.fn>;
}> {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
        root.render(ui);
    });
    const iframe = container.querySelector('iframe');
    expect(iframe).not.toBeNull();
    const postMessageSpy = vi.fn();
    iframe!.contentWindow!.postMessage = postMessageSpy;
    return {
        container,
        unmount: () => {
            act(() => root.unmount());
            container.remove();
        },
        postMessageSpy,
    };
}

/** 以 iframe.contentWindow 为 source 派发一条面板消息。 */
function dispatchFromPanel(iframe: HTMLIFrameElement | null, data: Record<string, unknown>) {
    expect(iframe).not.toBeNull();
    act(() => {
        window.dispatchEvent(
            new MessageEvent('message', { source: iframe!.contentWindow, data }),
        );
    });
}

function resetStore() {
    useContentPanelStore.setState({
        globalTabs: [],
        sessionTabs: {},
        activeGlobalTabId: null,
        activeSessionTabId: {},
        activeScope: 'global',
        panelOpen: false,
    });
}

describe('PanelHost', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        fetchPluginFrontendMock.mockResolvedValue(RENDERER_HTML);
        resetStore();
    });
    afterEach(() => {
        resetStore();
    });

    it('ready 携带匹配版本 → mount（panelId + protocolVersion + initialPayload）+ theme + resize', async () => {
        const { container, unmount, postMessageSpy } = await renderAsync(
            <PanelHost pluginId="p1" panelId="lib" scope="global" active={false} tabId="tab-panel:p1:lib" />,
        );
        dispatchFromPanel(container.querySelector('iframe'), { type: 'ready', protocolVersion: 1 });

        const mountMsg = postMessageSpy.mock.calls.find((c) => (c[0] as { type?: string }).type === 'mount');
        expect(mountMsg).toBeDefined();
        expect(mountMsg![0]).toMatchObject({ type: 'mount', panelId: 'lib', protocolVersion: 1 });
        expect(postMessageSpy.mock.calls.some((c) => (c[0] as { type?: string }).type === 'theme')).toBe(true);
        expect(postMessageSpy.mock.calls.some((c) => (c[0] as { type?: string }).type === 'resize')).toBe(true);
        expect(postMessageSpy.mock.calls.some((c) => (c[0] as { type?: string }).type === 'activate')).toBe(false);
        unmount();
    });

    it('ready 版本缺失/不匹配 → 拒绝 mount 并显示兜底（协议版本提示）', async () => {
        const { container, unmount, postMessageSpy } = await renderAsync(
            <PanelHost pluginId="p1" panelId="lib" scope="global" active={false} tabId="tab-panel:p1:lib" />,
        );
        dispatchFromPanel(container.querySelector('iframe'), { type: 'ready', protocolVersion: 99 });
        expect(container.querySelector('[data-testid="panel-host-fallback"]')).not.toBeNull();
        expect(postMessageSpy.mock.calls.some((c) => (c[0] as { type?: string }).type === 'mount')).toBe(false);
        unmount();
    });

    it('active 变化 → activate / deactivate；initialPayload 变化 → update', async () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const root = createRoot(container);
        await act(async () => {
            root.render(
                <PanelHost pluginId="p1" panelId="lib" scope="global" active={false} tabId="tab-panel:p1:lib" />,
            );
        });
        const iframe = container.querySelector('iframe');
        const spy = vi.fn();
        iframe!.contentWindow!.postMessage = spy;
        dispatchFromPanel(iframe, { type: 'ready', protocolVersion: 1 });

        await act(async () => {
            root.render(
                <PanelHost pluginId="p1" panelId="lib" scope="global" active={true} tabId="tab-panel:p1:lib" />,
            );
        });
        expect(spy.mock.calls.some((c) => (c[0] as { type?: string }).type === 'activate')).toBe(true);

        await act(async () => {
            root.render(
                <PanelHost
                    pluginId="p1"
                    panelId="lib"
                    scope="global"
                    active={true}
                    tabId="tab-panel:p1:lib"
                    initialPayload='{"k":2}'
                />,
            );
        });
        const updateMsg = spy.mock.calls.find((c) => (c[0] as { type?: string }).type === 'update');
        expect(updateMsg).toBeDefined();
        expect(updateMsg![0]).toMatchObject({ type: 'update', payload: '{"k":2}' });

        await act(async () => {
            root.render(
                <PanelHost pluginId="p1" panelId="lib" scope="global" active={false} tabId="tab-panel:p1:lib" />,
            );
        });
        expect(spy.mock.calls.some((c) => (c[0] as { type?: string }).type === 'deactivate')).toBe(true);
        act(() => root.unmount());
        container.remove();
    });

    it('openTab：合法 trace ref + activate → user 打开会话 tab；非法（他插件 panel / 未知类型）忽略', async () => {
        const { container, unmount } = await renderAsync(
            <PanelHost pluginId="p1" panelId="run" scope="session" sessionId="s1" active={true} tabId="tab-panel:p1:run" />,
        );
        const iframe = container.querySelector('iframe');
        dispatchFromPanel(iframe, { type: 'ready', protocolVersion: 1 });
        dispatchFromPanel(iframe, { type: 'openTab', ref: { type: 'panel', pluginId: 'other', panelId: 'x' }, activate: true });
        dispatchFromPanel(iframe, { type: 'openTab', ref: { type: 'artifact', artifactId: 'z' }, activate: true });
        expect(useContentPanelStore.getState().sessionTabs['s1']).toBeUndefined();

        dispatchFromPanel(iframe, { type: 'openTab', ref: { type: 'trace', sessionId: 's1' }, activate: true });
        const tabs = useContentPanelStore.getState().sessionTabs['s1'];
        expect(tabs).toHaveLength(1);
        expect(tabs![0].ref).toEqual({ type: 'trace', sessionId: 's1' });
        expect(useContentPanelStore.getState().activeScope).toBe('session');
        unmount();
    });

    it('closeTab：无 tabId = 关自己；指定他人 tabId 拒绝', async () => {
        const store = useContentPanelStore.getState();
        store.openTab({ ref: { type: 'panel', pluginId: 'p1', panelId: 'run' }, title: 'R', scope: 'session', sessionId: 's1', origin: 'user' });
        const otherId = store.openTab({ ref: { type: 'trace', sessionId: 's1' }, title: 'T', scope: 'session', sessionId: 's1', origin: 'user' });

        const { container, unmount } = await renderAsync(
            <PanelHost pluginId="p1" panelId="run" scope="session" sessionId="s1" active={true} tabId={tabIdForRef({ type: 'panel', pluginId: 'p1', panelId: 'run' })} />,
        );
        const iframe = container.querySelector('iframe');
        dispatchFromPanel(iframe, { type: 'ready', protocolVersion: 1 });
        dispatchFromPanel(iframe, { type: 'closeTab', tabId: otherId });
        expect(useContentPanelStore.getState().sessionTabs['s1']).toHaveLength(2);

        dispatchFromPanel(iframe, { type: 'closeTab' });
        const tabs = useContentPanelStore.getState().sessionTabs['s1'];
        expect(tabs!.some((t) => t.ref.type === 'panel' && t.ref.pluginId === 'p1')).toBe(false);
        unmount();
    });

    it('open 消息仅放行 https 链接', async () => {
        const openSpy = vi.fn();
        vi.stubGlobal('open', openSpy);
        const { container, unmount } = await renderAsync(
            <PanelHost pluginId="p1" panelId="lib" scope="global" active={false} tabId="tab-panel:p1:lib" />,
        );
        const iframe = container.querySelector('iframe');
        dispatchFromPanel(iframe, { type: 'open', url: 'javascript:alert(1)' });
        dispatchFromPanel(iframe, { type: 'open', url: 'http://insecure.example' });
        expect(openSpy).not.toHaveBeenCalled();
        dispatchFromPanel(iframe, { type: 'open', url: 'https://example.com/a' });
        expect(openSpy).toHaveBeenCalledWith('https://example.com/a', '_blank', 'noopener,noreferrer');
        vi.unstubAllGlobals();
        unmount();
    });
});
```

- [ ] **Step 9.6: 运行确认失败**

Run: `pnpm --filter web exec vitest run src/components/PanelHost/index.test.tsx`
Expected: FAIL（module not found）

- [ ] **Step 9.7: 实现 PanelHost**

创建 `apps/web/src/components/PanelHost/index.tsx`：

```tsx
// PanelHost - 内容栏面板宿主（PanelHost SDK 四件套，content-panel 设计）。
//
// 生命周期 mount/update/activate/deactivate + resize（宿主→面板，全高面板
// 与卡片方向相反）+ theme token 推送 + 受控导航 openTab/closeTab（宿主仲裁）。
// 握手：面板 ready {protocolVersion}，版本不匹配拒绝 mount 并提示。卡片协议
// （PluginCardHost）不受影响。closeTab 默认仅允许关自己；openTab 的 panel
// 类 ref 限定本插件。

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { fetchPluginRendererEntry } from '../common/pluginRendererEntry';
import { useContentPanelStore } from '../../store/contentPanelStore';
import type { ContentPanelScope } from '../../store/contentPanelStore';
import {
    PANEL_PROTOCOL_VERSION,
    readPanelThemeTokens,
    isValidOpenTabRef,
    titleForRef,
} from './protocol';

/** 握手超时（ms），对齐卡片 RENDER_TIMEOUT_MS 惯例。 */
const MOUNT_TIMEOUT_MS = 10_000;

// —— 协议消息类型（公共 API：新增可以，改名/改语义禁止）——

/** 宿主 → 面板 */
export type HostToPanelMessage =
    | { type: 'mount'; requestId: string; panelId: string; protocolVersion: number; initialPayload?: string }
    | { type: 'update'; requestId: string; payload?: string }
    | { type: 'activate'; requestId: string }
    | { type: 'deactivate'; requestId: string }
    | { type: 'resize'; requestId: string; width: number; height: number }
    | { type: 'theme'; requestId: string; tokens: ReturnType<typeof readPanelThemeTokens> };

/** 面板 → 宿主 */
export type PanelToHostMessage =
    | { type: 'ready'; requestId?: string; protocolVersion?: number }
    | { type: 'rendered'; requestId: string; height?: number }
    | { type: 'error'; requestId?: string; message?: string }
    | { type: 'open'; requestId?: string; url: string }
    | { type: 'openTab'; requestId?: string; ref: unknown; activate?: boolean }
    | { type: 'closeTab'; requestId?: string; tabId?: string };

export interface PanelHostProps {
    pluginId: string;
    panelId: string;
    scope: ContentPanelScope;
    /** session 类面板当前会话（initialPayload 透传给面板）。 */
    sessionId?: string;
    /** 当前 tab 是否激活（驱动 activate/deactivate；面板据此管理轮询/状态）。 */
    active: boolean;
    /** 面板首帧数据（宿主不解释；变化时推送 update）。 */
    initialPayload?: string;
    /** 自身 tab 的 tabId（closeTab 无参 = 关自己）。 */
    tabId: string;
}

export default function PanelHost({
    pluginId,
    panelId,
    scope,
    sessionId,
    active,
    initialPayload,
    tabId,
}: PanelHostProps) {
    const [html, setHtml] = useState<string | null>(null);
    const [failed, setFailed] = useState(false);
    const [failedReason, setFailedReason] = useState<string | null>(null);
    const iframeRef = useRef<HTMLIFrameElement | null>(null);
    const containerRef = useRef<HTMLDivElement | null>(null);
    // 惰性初始化：整个挂载周期稳定不变（消息路由标识，对齐卡片惯例）
    const [requestId] = useState(() => `panel-${crypto.randomUUID()}`);
    const mountedRef = useRef(false);
    const payloadRef = useRef(initialPayload);
    const activeRef = useRef(active);
    activeRef.current = active;

    const openTab = useContentPanelStore((s) => s.openTab);
    const closeTab = useContentPanelStore((s) => s.closeTab);

    const post = useCallback((msg: HostToPanelMessage) => {
        iframeRef.current?.contentWindow?.postMessage(msg, '*');
    }, []);

    const pushSize = useCallback(() => {
        const el = containerRef.current;
        if (!el) return;
        post({ type: 'resize', requestId, width: el.clientWidth, height: el.clientHeight });
    }, [post, requestId]);

    // 入口拉取（复用共享缓存；失败 → 兜底）
    useEffect(() => {
        let cancelled = false;
        fetchPluginRendererEntry(pluginId)
            .then((entry) => {
                if (!cancelled) setHtml(entry);
            })
            .catch(() => {
                if (!cancelled) {
                    setFailed(true);
                    setFailedReason('插件渲染器不可用（未启用或未声明 frontendEntry）');
                }
            });
        return () => {
            cancelled = true;
        };
    }, [pluginId]);

    // 协议主体：ready 握手（版本协商）→ mount + theme + resize；面板→宿主消息仲裁
    useEffect(() => {
        if (!html || failed) return;
        let settled = false;

        const onMessage = (event: MessageEvent) => {
            if (event.source !== iframeRef.current?.contentWindow) return;
            const data = event.data as PanelToHostMessage;
            if (!data || typeof data !== 'object') return;
            switch (data.type) {
                case 'ready': {
                    if (typeof data.protocolVersion === 'number' && data.protocolVersion === PANEL_PROTOCOL_VERSION) {
                        mountedRef.current = true;
                        settled = true;
                        post({
                            type: 'mount',
                            requestId,
                            panelId,
                            protocolVersion: PANEL_PROTOCOL_VERSION,
                            initialPayload: payloadRef.current,
                        });
                        post({ type: 'theme', requestId, tokens: readPanelThemeTokens() });
                        pushSize();
                        if (activeRef.current) post({ type: 'activate', requestId });
                    } else {
                        setFailed(true);
                        setFailedReason(`面板协议版本不兼容（宿主 v${PANEL_PROTOCOL_VERSION}）`);
                    }
                    return;
                }
                case 'rendered':
                    // 全高面板不需要高度上报语义；仅作握手完成信号（幂等）
                    settled = true;
                    return;
                case 'error':
                    setFailed(true);
                    setFailedReason(data.message ?? '面板渲染失败');
                    return;
                case 'open':
                    // 沙箱内无 allow-popups：跳转由宿主代为执行（仅放行 https）
                    if (typeof data.url === 'string' && data.url.startsWith('https://')) {
                        window.open(data.url, '_blank', 'noopener,noreferrer');
                    }
                    return;
                case 'openTab': {
                    if (!isValidOpenTabRef(data.ref, pluginId)) return;
                    const ref = data.ref;
                    openTab({
                        ref,
                        title: titleForRef(ref),
                        scope: scope === 'session' ? 'session' : 'global',
                        sessionId: scope === 'session' ? sessionId : undefined,
                        origin: data.activate === true ? 'user' : 'system',
                    });
                    return;
                }
                case 'closeTab': {
                    const target = typeof data.tabId === 'string' ? data.tabId : tabId;
                    if (target !== tabId) return; // 仅允许关自己（宿主仲裁）
                    closeTab(scope, target, scope === 'session' ? sessionId : undefined);
                    return;
                }
            }
        };

        window.addEventListener('message', onMessage);
        const timer = setTimeout(() => {
            if (!settled && !mountedRef.current) {
                setFailed(true);
                setFailedReason('面板握手超时');
            }
        }, MOUNT_TIMEOUT_MS);

        return () => {
            window.removeEventListener('message', onMessage);
            clearTimeout(timer);
        };
    }, [html, failed, pluginId, panelId, scope, sessionId, tabId, requestId, post, pushSize, openTab, closeTab]);

    // activate / deactivate：active 变化且已 mount 时发送
    useEffect(() => {
        if (!mountedRef.current) return;
        post({ type: active ? 'activate' : 'deactivate', requestId });
    }, [active, html, post, requestId]);

    // initialPayload 变化 → 已 mount 的面板推 update
    useEffect(() => {
        if (payloadRef.current === initialPayload) return;
        payloadRef.current = initialPayload;
        if (mountedRef.current) {
            post({ type: 'update', requestId, payload: initialPayload });
        }
    }, [initialPayload, post, requestId]);

    // resize 推送：ResizeObserver 可用时订阅容器（observe 即触发首推）；
    // 不可用（jsdom 等旧环境）退化为 html 就绪后一次
    useEffect(() => {
        if (!html) return;
        if (typeof ResizeObserver === 'undefined') {
            pushSize();
            return;
        }
        const observer = new ResizeObserver(() => pushSize());
        if (containerRef.current) observer.observe(containerRef.current);
        return () => observer.disconnect();
    }, [html, pushSize]);

    if (failed) {
        return (
            <div
                data-testid="panel-host-fallback"
                className="flex h-full flex-col items-center justify-center gap-2 p-6 text-sm text-text-secondary"
            >
                <AlertTriangle className="h-5 w-5 text-amber-500" aria-hidden />
                <span>
                    面板「{pluginId}/{panelId}」不可用{failedReason ? `：${failedReason}` : ''}
                </span>
            </div>
        );
    }

    return (
        <div
            ref={containerRef}
            data-testid="panel-host"
            data-plugin-id={pluginId}
            data-panel-id={panelId}
            className="h-full w-full"
        >
            {html ? (
                <iframe
                    ref={iframeRef}
                    title={`插件面板 ${panelId}`}
                    sandbox="allow-scripts"
                    srcDoc={html}
                    className="h-full w-full border-0"
                />
            ) : (
                <div className="flex h-full items-center justify-center text-[12px] text-text-tertiary">
                    正在加载插件「{pluginId}」面板…
                </div>
            )}
        </div>
    );
}
```

（注：`post` / `pushSize` 必须声明在协议 effect 之前——上面已按此顺序组织；实现时保持该顺序，避免闭包引用未初始化。）

- [ ] **Step 9.8: 运行确认通过**

Run: `pnpm --filter web exec vitest run src/components/PanelHost/index.test.tsx`
Expected: PASS（6 个用例）

- [ ] **Step 9.9: 插件面板渲染器接线（注册表兜底，priority 0）**

创建 `apps/web/src/components/ContentPanel/renderers/PluginPanelRenderer.tsx`：

```tsx
// PluginPanelRenderer - 插件面板的注册表适配层：从 store 推导 PanelHost 所需的
// scope / active / tabId / sessionId（渲染器 props 只有 ref + meta，适配在此完成）。

import PanelHost from '../../PanelHost';
import { useContentPanelStore, tabIdForRef } from '../../../store/contentPanelStore';
import { useSessionStore, NEW_SESSION_SENTINEL } from '../../../store/sessionStore';
import { contentRefKey, type ContentRef } from '../../../types/content';
import type { ContentRendererProps } from '../registry';

function sameRef(a: ContentRef, key: string): boolean {
    return contentRefKey(a) === key;
}

export default function PluginPanelRenderer({ ref: contentRef }: ContentRendererProps) {
    const globalTabs = useContentPanelStore((s) => s.globalTabs);
    const sessionTabs = useContentPanelStore((s) => s.sessionTabs);
    const activeGlobalTabId = useContentPanelStore((s) => s.activeGlobalTabId);
    const activeScope = useContentPanelStore((s) => s.activeScope);
    const activeSessionTabId = useContentPanelStore((s) => s.activeSessionTabId);
    const selectedSessionId = useSessionStore((s) => s.selectedSessionId);

    if (contentRef.type !== 'panel') return null;
    const key = contentRefKey(contentRef);
    const scope = globalTabs.some((t) => sameRef(t.ref, key)) ? 'global' : 'session';
    const sid =
        selectedSessionId && selectedSessionId !== NEW_SESSION_SENTINEL ? selectedSessionId : '';
    const active =
        scope === 'global'
            ? activeScope === 'global' && activeGlobalTabId === tabIdForRef(contentRef)
            : activeScope === 'session' && sid !== '' && activeSessionTabId[sid] === tabIdForRef(contentRef);

    return (
        <PanelHost
            pluginId={contentRef.pluginId}
            panelId={contentRef.panelId}
            scope={scope}
            sessionId={scope === 'session' && sid ? sid : undefined}
            active={active}
            tabId={tabIdForRef(contentRef)}
            initialPayload={
                scope === 'session' && sid ? JSON.stringify({ sessionId: sid }) : undefined
            }
        />
    );
}
```

（早退 `return null` 位于全部 hooks 之后，避免条件 hooks 调用违规。）

`apps/web/src/components/ContentPanel/builtin.ts` 修改两点：

1. `traceRenderer` 定义之后追加：

```ts
export const pluginPanelRenderer: ContentRenderer = {
    // 插件面板兜底：panel 类 ref（宿主内建命名空间除外，那由 agent 状态渲染器处理）
    canHandle: (ref) => ref.type === 'panel' && ref.pluginId !== HOST_PANEL_PLUGIN_ID,
    render: () => import('./renderers/PluginPanelRenderer').then((m) => m.default),
    priority: 0,
};
```

（import 区补 `import { HOST_PANEL_PLUGIN_ID } from '../../types/content';`）

2. 注册调用区追加：

```ts
registerContentRenderer(pluginPanelRenderer);
```

- [ ] **Step 9.10: 运行确认通过 + 卡片协议总回归**

Run: `pnpm --filter web exec vitest run src/components/PanelHost src/components/PluginCardHost src/components/common/pluginRendererEntry.test.ts src/components/ContentPanel`
Expected: 全部 PASS（PluginCardHost 既有测试零改动全绿 = 向后兼容锚点）

- [ ] **Step 9.11: Commit**

```bash
git add apps/web/src/components/common/pluginRendererEntry.ts apps/web/src/components/common/pluginRendererEntry.test.ts apps/web/src/components/PluginCardHost/index.tsx apps/web/src/components/PanelHost/protocol.ts apps/web/src/components/PanelHost/index.tsx apps/web/src/components/PanelHost/index.test.tsx apps/web/src/components/ContentPanel/renderers/PluginPanelRenderer.tsx apps/web/src/components/ContentPanel/builtin.ts
git commit -m "feat(web): PanelHost SDK — panel protocol (lifecycle/resize/theme/controlled nav) generalizing card host"
```

---

### Task 10: manifest `provides.panels`（shared 类型 + 双 schema + 校验）+ 插件面板注册

**Files:**
- Modify: `packages/shared/src/plugin.ts`（PanelDeclaration + PluginProvides.panels）
- Modify: `docs/rfc/schemas/plugin.manifest.schema.json`（原件）
- Modify: `apps/server/src/plugin/schemas/plugin.manifest.schema.json`（拷贝件，与原件逐字节一致——同步测试强制）
- Test: `apps/server/src/plugin/__tests__/validate.test.ts`（追加用例）
- Create: `apps/web/src/components/ContentPanel/usePluginPanels.ts`
- Modify: `apps/web/src/components/ContentPanel/index.tsx`（rail 常驻入口 + strip 面板菜单 + 遗留 tab 清理）
- Test: `apps/web/src/components/ContentPanel/usePluginPanels.test.ts`

**说明:** `frontendEntry` 已存在于 shared 类型与两份 schema（见计划头部对齐说明），本任务只新增 `panels`。schema 修改必须**同时改两份拷贝**（`validate.test.ts` 的同步测试逐字节比对）；建议先改 `docs/rfc/schemas/` 原件，再整文件复制到 `apps/server/src/plugin/schemas/`。`panels` 不加入 `PluginProvides.anyOf` 非空约束——面板渲染入口依赖 `frontendEntry`，单独声明 `panels` 而无 `frontendEntry` 的清单在 schema 层仍需其他能力块满足 anyOf，宿主注册时忽略无 `frontendEntry` 的 `panels`。

- [ ] **Step 10.1: 写失败测试（validate）**

`apps/server/src/plugin/__tests__/validate.test.ts` 的 `describe('validateManifest', ...)` 内追加：

```ts
  it('accepts provides.panels declarations alongside frontendEntry', () => {
    const raw = acmeManifest();
    raw.provides = {
      frontendEntry: { entry: 'frontend/index.html' },
      panels: [
        { id: 'library', title: '视频库', scope: 'global' },
        { id: 'run-history', title: '运行记录', scope: 'session' },
      ],
    };
    const result = validateManifest(raw);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects an illegal panels scope value', () => {
    const raw = acmeManifest();
    raw.provides = {
      frontendEntry: { entry: 'frontend/index.html' },
      panels: [{ id: 'library', title: 'L', scope: 'window' }],
    };
    const result = validateManifest(raw);
    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('scope');
  });

  it('rejects a panel missing required title', () => {
    const raw = acmeManifest();
    raw.provides = {
      frontendEntry: { entry: 'frontend/index.html' },
      panels: [{ id: 'library', scope: 'global' }],
    };
    const result = validateManifest(raw);
    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('title');
  });

  it('rejects duplicate panel ids (uniqueItems)', () => {
    const raw = acmeManifest();
    raw.provides = {
      frontendEntry: { entry: 'frontend/index.html' },
      panels: [
        { id: 'library', title: 'A', scope: 'global' },
        { id: 'library', title: 'B', scope: 'global' },
      ],
    };
    const result = validateManifest(raw);
    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('panels');
  });
```

- [ ] **Step 10.2: 运行确认失败**

Run: `pnpm --filter server exec vitest run src/plugin/__tests__/validate.test.ts`
Expected: 新用例 FAIL（additionalProperties：panels 未定义）

- [ ] **Step 10.3: 改两份 schema（逐字节一致）**

对 `docs/rfc/schemas/plugin.manifest.schema.json` 做两处修改：

1. `$defs.PluginProvides.properties` 中 `memoryBackends` 之后追加：

```json
        "panels": {
          "type": "array",
          "description": "内容栏常驻面板声明（content-panel 设计）；启用后按 scope 注册到全局 rail 或会话标签条。渲染入口依赖 frontendEntry（宿主忽略无 frontendEntry 的 panels）。",
          "items": { "$ref": "#/$defs/PanelDeclaration" },
          "uniqueItems": true,
          "maxItems": 8,
          "default": []
        }
```

2. `$defs.MemoryBackendRef` 之后追加新 `$defs` 节点：

```json
    "PanelDeclaration": {
      "type": "object",
      "description": "内容栏面板声明。id 与 pluginId 组成 panel 类内容引用（pluginId:panelId）。",
      "additionalProperties": false,
      "required": ["id", "title", "scope"],
      "properties": {
        "id": {
          "type": "string",
          "description": "面板在插件内唯一的 kebab-case 标识符。",
          "pattern": "^[a-z][a-z0-9-]{1,63}$"
        },
        "title": { "$ref": "#/$defs/NonEmptyString" },
        "scope": {
          "type": "string",
          "description": "'global' 注册到全局 rail；'session' 注册到会话标签条。",
          "enum": ["global", "session"]
        }
      }
    }
```

然后**整文件复制**到 `apps/server/src/plugin/schemas/plugin.manifest.schema.json`（PowerShell：`Copy-Item -LiteralPath docs/rfc/schemas/plugin.manifest.schema.json -Destination apps/server/src/plugin/schemas/plugin.manifest.schema.json -Force`）。

Run: `pnpm --filter server exec vitest run src/plugin/__tests__/validate.test.ts`
Expected: 全部 PASS（新增 4 用例 + 既有用例 + 双拷贝同步测试）

- [ ] **Step 10.4: shared 类型**

`packages/shared/src/plugin.ts` 修改两处：

1. `FrontendEntry` 接口之后追加：

```ts
/** 内容栏面板声明（content-panel 设计）：插件常驻面板注册。 */
export interface PanelDeclaration {
  /** 面板在插件内唯一的 kebab-case 标识符；与 pluginId 组成 panel 类内容引用。 */
  id: string;
  /** 面板标题（UI 显示）。 */
  title: string;
  /** 'global' 注册到全局 rail；'session' 注册到会话标签条。 */
  scope: 'global' | 'session';
}
```

2. `PluginProvides` 追加字段（`memoryBackends` 之后）：

```ts
  /** 内容栏常驻面板声明；渲染入口依赖 frontendEntry。 */
  panels?: PanelDeclaration[];
```

Run: `pnpm typecheck`
Expected: PASS（新增字段全部可选，零破坏）

- [ ] **Step 10.5: 写失败测试（usePluginPanels）**

创建 `apps/web/src/components/ContentPanel/usePluginPanels.test.ts`：

```ts
// usePluginPanels 测试：enabled + frontendEntry + panels 三重过滤。
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { PluginRecord } from '@my-copilot/shared';
import { usePluginPanels } from './usePluginPanels';
import { api } from '../../api';

vi.mock('../../api', () => ({
    api: { fetchPlugins: vi.fn() },
}));

const fetchPluginsMock = vi.mocked(api.fetchPlugins);

function plugin(id: string, state: string, provides: Record<string, unknown>): PluginRecord {
    return {
        id,
        version: '0.1.0',
        source: 'official',
        state: state as PluginRecord['state'],
        manifest: {
            name: id,
            version: '0.1.0',
            description: 'd',
            author: { name: 'a' },
            license: 'MIT',
            engineCompatibility: { minVersion: '0.1.0' },
            source: 'official',
            permissions: {},
            provides: provides as PluginRecord['manifest']['provides'],
        },
        directory: `/plugins/${id}`,
        createdAt: 1,
        updatedAt: 1,
    } as PluginRecord;
}

describe('usePluginPanels', () => {
    it('只收录 enabled 且声明 frontendEntry + panels 的插件面板', async () => {
        fetchPluginsMock.mockResolvedValue([
            plugin('enabled-with-panels', 'enabled', {
                frontendEntry: { entry: 'frontend/index.html' },
                panels: [
                    { id: 'library', title: '视频库', scope: 'global' },
                    { id: 'run', title: '运行记录', scope: 'session' },
                ],
            }),
            plugin('disabled', 'disabled', {
                frontendEntry: { entry: 'frontend/index.html' },
                panels: [{ id: 'x', title: 'X', scope: 'global' }],
            }),
            plugin('no-frontend', 'enabled', {
                mcpServers: [{ id: 'm', transport: 'stdio', command: 'node' }],
                panels: [{ id: 'y', title: 'Y', scope: 'global' }],
            }),
            plugin('card-only', 'enabled', {
                frontendEntry: { entry: 'frontend/index.html' },
            }),
        ]);

        const { result } = renderHook(() => usePluginPanels());
        // 初始 loading 态
        expect(result.current.loaded).toBe(false);
        await vi.waitFor(() => {
            expect(result.current.loaded).toBe(true);
        });
        expect(result.current.entries).toEqual([
            { pluginId: 'enabled-with-panels', panelId: 'library', title: '视频库', scope: 'global' },
            { pluginId: 'enabled-with-panels', panelId: 'run', title: '运行记录', scope: 'session' },
        ]);
    });

    it('取数失败降级为空列表（loaded 仍置位）', async () => {
        fetchPluginsMock.mockRejectedValue(new Error('network'));
        const { result } = renderHook(() => usePluginPanels());
        await vi.waitFor(() => {
            expect(result.current.loaded).toBe(true);
        });
        expect(result.current.entries).toEqual([]);
    });
});
```

- [ ] **Step 10.6: 运行确认失败 → 实现 usePluginPanels**

Run: `pnpm --filter web exec vitest run src/components/ContentPanel/usePluginPanels.test.ts`
Expected: FAIL（module not found）

创建 `apps/web/src/components/ContentPanel/usePluginPanels.ts`：

```ts
// usePluginPanels - 已启用插件声明的面板入口（content-panel 设计）。
// 过滤条件三重：state === 'enabled' 且 provides.frontendEntry 且 provides.panels。
// loaded 标记首次取数完成（false 期间不做遗留 tab 清理，防误删）。

import { useEffect, useState } from 'react';
import { api } from '../../api';

export interface PluginPanelEntry {
    pluginId: string;
    panelId: string;
    title: string;
    scope: 'global' | 'session';
}

export function usePluginPanels(): { entries: PluginPanelEntry[]; loaded: boolean } {
    const [entries, setEntries] = useState<PluginPanelEntry[]>([]);
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        let cancelled = false;
        api.fetchPlugins()
            .then((plugins) => {
                if (cancelled) return;
                const result: PluginPanelEntry[] = [];
                for (const p of plugins) {
                    if (p.state !== 'enabled') continue;
                    const provides = p.manifest.provides;
                    if (!provides.frontendEntry || !provides.panels) continue;
                    for (const panel of provides.panels) {
                        result.push({
                            pluginId: p.id,
                            panelId: panel.id,
                            title: panel.title,
                            scope: panel.scope,
                        });
                    }
                }
                setEntries(result);
                setLoaded(true);
            })
            .catch(() => {
                if (!cancelled) {
                    setEntries([]);
                    setLoaded(true);
                }
            });
        return () => {
            cancelled = true;
        };
    }, []);

    return { entries, loaded };
}
```

Run: `pnpm --filter web exec vitest run src/components/ContentPanel/usePluginPanels.test.ts`
Expected: PASS（2 个用例）

- [ ] **Step 10.7: ContentPanel 接线（rail 常驻入口 + strip 面板菜单 + 遗留清理）**

`apps/web/src/components/ContentPanel/index.tsx` 修改：

1. import 区补：

```tsx
import { useEffect } from 'react'
import { LayoutDashboard } from 'lucide-react'
import { tabIdForRef, type TabEntry } from '../../store/contentPanelStore'
import { HOST_PANEL_PLUGIN_ID } from '../../types/content'
import { usePluginPanels } from './usePluginPanels'
```

（`import { lazy, Suspense } from 'react'` 行合并 `useEffect`。）

2. `useMediaQuery` 之后加：

```tsx
  const { entries: pluginPanels, loaded: pluginsLoaded } = usePluginPanels()
  const pluginGlobalPanels = pluginPanels.filter((p) => p.scope === 'global')
  const pluginSessionPanels = pluginPanels.filter((p) => p.scope === 'session')

  // 已打开的插件面板 tab 若对应插件已不在启用列表（禁用/卸载/去掉 panels 声明）→ 清理。
  // 仅在插件列表首次加载完成后执行，防加载间隙误删。
  useEffect(() => {
    if (!pluginsLoaded) return
    const keys = new Set(pluginPanels.map((p) => `tab-panel:${p.pluginId}:${p.panelId}`))
    const state = useContentPanelStore.getState()
    const allTabs: TabEntry[] = [...state.globalTabs, ...Object.values(state.sessionTabs).flat()]
    const stale = new Set<string>()
    for (const t of allTabs) {
      if (t.ref.type === 'panel' && t.ref.pluginId !== HOST_PANEL_PLUGIN_ID && !keys.has(t.tabId)) {
        stale.add(t.ref.pluginId)
      }
    }
    stale.forEach((pluginId) => useContentPanelStore.getState().removePluginTabs(pluginId))
  }, [pluginPanels, pluginsLoaded])
```

3. `railEntries` 构造替换为（注册入口常驻 + 打开的非面板全局 tab 追加）：

```tsx
  // rail = 常驻注册入口（插件全局面板；Task 11 追加 agent 状态）+ 已打开的非注册全局 tab
  const registeredRailKeys = new Set<string>()
  const pluginRailEntries: RailEntry[] = pluginGlobalPanels.map((p) => {
    const tabId = `tab-panel:${p.pluginId}:${p.panelId}`
    registeredRailKeys.add(tabId)
    return {
      key: tabId,
      label: p.title,
      icon: <LayoutDashboard className="h-4 w-4" aria-hidden />,
      active: activeScope === 'global' && activeGlobalTabId === tabId,
      unread: globalTabs.find((t) => t.tabId === tabId)?.unread,
      onClick: () =>
        openTab({
          ref: { type: 'panel', pluginId: p.pluginId, panelId: p.panelId },
          title: p.title,
          scope: 'global',
          origin: 'user',
        }),
    }
  })

  const railEntries: RailEntry[] = [
    ...pluginRailEntries,
    ...globalTabs
      .filter((t) => !registeredRailKeys.has(t.tabId))
      .map((t) => ({
        key: t.tabId,
        label: t.title,
        icon: (
          <span className="w-9 truncate text-center font-mono text-[11px]">{t.title.slice(0, 2)}</span>
        ),
        active: activeScope === 'global' && t.tabId === activeGlobalTabId,
        unread: t.unread,
        onClick: () => openTab({ ref: t.ref, title: t.title, icon: t.icon, scope: 'global', origin: 'user' }),
      })),
  ]
```

4. `<SessionTabStrip tabs={stripTabs} />` 改为：

```tsx
                <SessionTabStrip
                    tabs={stripTabs}
                    extraMenuItems={
                        sid
                            ? pluginSessionPanels.map((p) => ({
                                  key: `panel:${p.pluginId}:${p.panelId}`,
                                  label: `打开面板：${p.title}`,
                                  onClick: () =>
                                      openTab({
                                          ref: { type: 'panel', pluginId: p.pluginId, panelId: p.panelId },
                                          title: p.title,
                                          scope: 'session',
                                          sessionId: sid,
                                          origin: 'user',
                                      }),
                              }))
                            : []
                    }
                />
```

- [ ] **Step 10.8: 写失败测试（接线）→ 运行 → 通过**

在 `apps/web/src/components/ContentPanel/index.test.tsx` 追加（文件头部 vi.mock 区补 `vi.mock('../../api', () => ({ api: { fetchPlugins: vi.fn(), fetchAssetMeta: vi.fn() } }));` 并 import `api` 取 mock；`beforeEach` 里 `vi.mocked(api.fetchPlugins).mockResolvedValue([])`）：

```tsx
    it('启用插件的全局面板常驻 rail；点击打开 tab；禁用后遗留 tab 被清理', async () => {
        mockMatchMedia(true);
        vi.mocked(api.fetchPlugins).mockResolvedValue([
            {
                id: 'demo',
                version: '0.1.0',
                source: 'official',
                state: 'enabled',
                manifest: {
                    name: 'demo',
                    version: '0.1.0',
                    description: 'd',
                    author: { name: 'a' },
                    license: 'MIT',
                    engineCompatibility: { minVersion: '0.1.0' },
                    source: 'official',
                    permissions: {},
                    provides: {
                        frontendEntry: { entry: 'frontend/index.html' },
                        panels: [{ id: 'library', title: '视频库', scope: 'global' }],
                    },
                },
                directory: '/plugins/demo',
                createdAt: 1,
                updatedAt: 1,
            } as never,
        ]);

        const { container } = render(<ContentPanel />);
        useContentPanelStore.getState().setPanelOpen(true);
        const railBtn = await waitFor(() =>
            container.querySelector('[data-testid="global-rail"] button[aria-label="视频库"]'),
        );
        expect(railBtn).not.toBeNull();

        // 打开 tab（用户）→ rail 激活态，且不重复出现第二个入口
        fireEvent.click(railBtn!);
        expect(useContentPanelStore.getState().globalTabs).toHaveLength(1);

        // 插件禁用（面板声明消失）→ 遗留 tab 被清理
        vi.mocked(api.fetchPlugins).mockResolvedValue([]);
        await waitFor(() => {
            expect(useContentPanelStore.getState().globalTabs).toHaveLength(0);
        });
    });
```

⚠️ 上例依赖组件内 `useEffect` 对插件列表变化的响应——`usePluginPanels` 当前只在挂载时取数一次，插件列表变化（禁用）后需重挂载才刷新。手动验收（Step 12.2）覆盖「设置页禁用插件 → 切回对话页」场景（路由切换触发重挂载）；单测中用 `unmount()` + 重新 `render` 模拟。若测试因此不稳定，改为：先 render 一次（空列表）断言清理逻辑、再重新 render（有面板）断言注册。

（import 区补 `waitFor`。）

Run: `pnpm --filter web exec vitest run src/components/ContentPanel`
Expected: 全部 PASS

- [ ] **Step 10.9: Commit**

```bash
git add packages/shared/src/plugin.ts docs/rfc/schemas/plugin.manifest.schema.json apps/server/src/plugin/schemas/plugin.manifest.schema.json apps/server/src/plugin/__tests__/validate.test.ts apps/web/src/components/ContentPanel/usePluginPanels.ts apps/web/src/components/ContentPanel/usePluginPanels.test.ts apps/web/src/components/ContentPanel/index.tsx apps/web/src/components/ContentPanel/index.test.tsx
git commit -m "feat: manifest provides.panels (shared type + dual schemas) and plugin panel registration in content panel"
```

---

### Task 11: agent 状态全局标签页（最小版）

**Files:**
- Create: `apps/web/src/components/ContentPanel/AgentStatusPanel.tsx`
- Modify: `apps/web/src/components/ContentPanel/builtin.ts`（注册 host 面板渲染器）
- Modify: `apps/web/src/components/ContentPanel/index.tsx`（rail 常驻入口 + agentState push）

**说明:** 最小版只投影 `sessionStore` 的 `agentState` / `activeToolCalls` / `activeJobId`（不订阅 job SSE 详情——那是 ChatShell 的职责）。push 规则：`agentState` 离开 `idle` 时以 `origin: 'system'` 打开「agent 状态」全局 tab（角标不抢焦点，双栏核心体验契约）。

- [ ] **Step 11.1: 写失败测试**

创建 `apps/web/src/components/ContentPanel/AgentStatusPanel.test.tsx`：

```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import AgentStatusPanel from './AgentStatusPanel';
import { useSessionStore } from '../../store/sessionStore';

describe('AgentStatusPanel', () => {
    beforeEach(() => {
        useSessionStore.setState({
            agentState: 'idle',
            activeToolCalls: [],
            activeJobId: null,
        });
    });

    it('空闲态：状态标签 + 空工具列表 + 无后台任务', () => {
        render(<AgentStatusPanel ref={{ type: 'panel', pluginId: '__host__', panelId: 'agent-status' }} />);
        expect(screen.getByTestId('agent-status-panel').textContent).toContain('空闲');
        expect(screen.getByTestId('agent-status-panel').textContent).toContain('（无进行中的工具调用）');
        expect(screen.getByTestId('agent-status-panel').textContent).toContain('（无）');
    });

    it('运行态：状态标签 + 工具调用列表', () => {
        useSessionStore.setState({
            agentState: 'tool_running',
            activeToolCalls: [
                { id: 'call_1', name: 'web_search', status: 'running' },
                { id: 'call_2', name: 'read_file', status: 'done' },
            ],
            activeJobId: 'job-9',
        });
        render(<AgentStatusPanel ref={{ type: 'panel', pluginId: '__host__', panelId: 'agent-status' }} />);
        const text = screen.getByTestId('agent-status-panel').textContent ?? '';
        expect(text).toContain('工具执行中');
        expect(text).toContain('web_search');
        expect(text).toContain('read_file');
        expect(text).toContain('job-9');
    });
});
```

- [ ] **Step 11.2: 运行确认失败 → 实现**

Run: `pnpm --filter web exec vitest run src/components/ContentPanel/AgentStatusPanel.test.tsx`
Expected: FAIL（module not found）

创建 `apps/web/src/components/ContentPanel/AgentStatusPanel.tsx`：

```tsx
// AgentStatusPanel - 「agent 状态」全局标签页（最小版，content-panel 设计）。
// 数据源：sessionStore 的 agentState / activeToolCalls / activeJobId（状态投影，
// 不订阅 job SSE 详情——那是 ChatShell 的职责）。

import { CircleCheck, CircleX, Loader2 } from 'lucide-react';
import { useSessionStore, type AgentState } from '../../store/sessionStore';
import type { ContentRendererProps } from './registry';

const AGENT_STATE_LABELS: Record<AgentState, string> = {
    idle: '空闲',
    thinking: '思考中',
    tool_running: '工具执行中',
    responding: '回复中',
    error: '出错',
    cancelled: '已取消',
};

export default function AgentStatusPanel(_props: ContentRendererProps) {
    const agentState = useSessionStore((s) => s.agentState);
    const activeToolCalls = useSessionStore((s) => s.activeToolCalls);
    const activeJobId = useSessionStore((s) => s.activeJobId);

    return (
        <div data-testid="agent-status-panel" className="flex flex-col gap-4 p-4 text-sm">
            <div className="flex items-center gap-2">
                {agentState === 'idle' ? (
                    <CircleCheck className="h-4 w-4 text-success-dark" aria-hidden />
                ) : agentState === 'error' ? (
                    <CircleX className="h-4 w-4 text-error-600" aria-hidden />
                ) : (
                    <Loader2 className="h-4 w-4 animate-spin text-primary-500" aria-hidden />
                )}
                <span className="font-medium text-text-primary">当前状态：{AGENT_STATE_LABELS[agentState]}</span>
            </div>
            <section className="flex flex-col gap-1.5">
                <h3 className="m-0 text-[12px] text-text-tertiary">本轮工具调用</h3>
                {activeToolCalls.length === 0 ? (
                    <span className="text-[12px] text-text-tertiary">（无进行中的工具调用）</span>
                ) : (
                    activeToolCalls.map((call) => (
                        <div
                            key={call.id}
                            className="flex items-center gap-2 font-mono text-[12px] text-text-secondary"
                        >
                            <span className={call.status === 'running' ? 'text-primary-600' : 'text-success-dark'}>
                                {call.status === 'running' ? '▶' : '✓'}
                            </span>
                            <span className="truncate">{call.name || '…'}</span>
                        </div>
                    ))
                )}
            </section>
            <section className="flex flex-col gap-1">
                <h3 className="m-0 text-[12px] text-text-tertiary">后台任务</h3>
                <span className="font-mono text-[12px] text-text-secondary">{activeJobId ?? '（无）'}</span>
            </section>
        </div>
    );
}
```

（hooks 全部无条件调用——不依赖 props 早退。）

Run: `pnpm --filter web exec vitest run src/components/ContentPanel/AgentStatusPanel.test.tsx`
Expected: PASS（2 个用例）

- [ ] **Step 11.3: 注册 host 面板渲染器**

`apps/web/src/components/ContentPanel/builtin.ts` 修改两点：

1. `pluginPanelRenderer` 定义之后追加：

```ts
export const agentStatusRenderer: ContentRenderer = {
    canHandle: (ref) =>
        ref.type === 'panel' &&
        ref.pluginId === HOST_PANEL_PLUGIN_ID &&
        ref.panelId === HOST_PANEL_AGENT_STATUS,
    render: () => import('./AgentStatusPanel').then((m) => m.default),
    priority: 100,
};
```

（import 区补 `HOST_PANEL_AGENT_STATUS`：`import { HOST_PANEL_PLUGIN_ID, HOST_PANEL_AGENT_STATUS } from '../../types/content';`）

2. 注册调用区追加：

```ts
registerContentRenderer(agentStatusRenderer);
```

- [ ] **Step 11.4: ContentPanel 接线（rail 常驻入口 + push）**

`apps/web/src/components/ContentPanel/index.tsx` 修改：

1. import 区补：

```tsx
import { useRef } from 'react'
import { Activity } from 'lucide-react'
import { agentStatusRef, HOST_PANEL_AGENT_STATUS, HOST_PANEL_PLUGIN_ID } from '../../types/content'
```

2. `usePluginPanels` 之后加 push effect（agent 后台运行 → system push 全局 tab，角标不抢焦点）：

```tsx
  const agentState = useSessionStore((s) => s.agentState)
  const pushedRef = useRef(false)
  useEffect(() => {
    if (agentState === 'idle') {
      pushedRef.current = false
      return
    }
    if (pushedRef.current) return
    pushedRef.current = true
    useContentPanelStore.getState().openTab({
      ref: agentStatusRef(),
      title: 'agent 状态',
      scope: 'global',
      origin: 'system',
    })
  }, [agentState])
```

3. `pluginRailEntries` 之前加常驻入口，并纳入 `registeredRailKeys`：

```tsx
  const agentStatusTabId = `tab-panel:${HOST_PANEL_PLUGIN_ID}:${HOST_PANEL_AGENT_STATUS}`
  const agentStatusEntry: RailEntry = {
    key: agentStatusTabId,
    label: 'agent 状态',
    icon: <Activity className="h-4 w-4" aria-hidden />,
    active: activeScope === 'global' && activeGlobalTabId === agentStatusTabId,
    unread: globalTabs.find((t) => t.tabId === agentStatusTabId)?.unread,
    onClick: () =>
      openTab({ ref: agentStatusRef(), title: 'agent 状态', scope: 'global', origin: 'user' }),
  }
```

`railEntries` 组装改为：

```tsx
  const railEntries: RailEntry[] = [
    agentStatusEntry,
    ...pluginRailEntries,
    ...globalTabs
      .filter((t) => t.tabId !== agentStatusTabId && !registeredRailKeys.has(t.tabId))
      .map((t) => ({
        key: t.tabId,
        label: t.title,
        icon: (
          <span className="w-9 truncate text-center font-mono text-[11px]">{t.title.slice(0, 2)}</span>
        ),
        active: activeScope === 'global' && t.tabId === activeGlobalTabId,
        unread: t.unread,
        onClick: () => openTab({ ref: t.ref, title: t.title, icon: t.icon, scope: 'global', origin: 'user' }),
      })),
  ]
```

- [ ] **Step 11.5: 写失败测试（push 行为）→ 运行 → 通过**

在 `apps/web/src/components/ContentPanel/index.test.tsx` 追加：

```tsx
    it('agentState 离开 idle → system push「agent 状态」全局 tab（角标、不抢焦点）', async () => {
        mockMatchMedia(true);
        vi.mocked(api.fetchPlugins).mockResolvedValue([]);
        render(<ContentPanel />);
        useContentPanelStore.getState().openTab({
            ref: { type: 'asset', assetId: 'focus' },
            title: '用户焦点',
            scope: 'global',
            origin: 'user',
        });
        const focusedId = useContentPanelStore.getState().activeGlobalTabId;

        act(() => {
            useSessionStore.setState({ agentState: 'thinking' });
        });
        const s = useContentPanelStore.getState();
        const statusTab = s.globalTabs.find(
            (t) => t.ref.type === 'panel' && t.ref.pluginId === '__host__' && t.ref.panelId === 'agent-status',
        );
        expect(statusTab).toBeDefined();
        expect(statusTab?.unread).toBe(true);
        expect(s.activeGlobalTabId).toBe(focusedId); // 焦点未变（不抢焦点）

        const { container } = render(<ContentPanel />);
        useContentPanelStore.getState().setPanelOpen(true);
        await waitFor(() => {
            expect(container.querySelector('[data-testid="global-rail"] button[aria-label="agent 状态"]')).not.toBeNull();
        });
    });
```

（import 区补 `act`。）

Run: `pnpm --filter web exec vitest run src/components/ContentPanel`
Expected: 全部 PASS

- [ ] **Step 11.6: Commit**

```bash
git add apps/web/src/components/ContentPanel/AgentStatusPanel.tsx apps/web/src/components/ContentPanel/AgentStatusPanel.test.tsx apps/web/src/components/ContentPanel/builtin.ts apps/web/src/components/ContentPanel/index.tsx apps/web/src/components/ContentPanel/index.test.tsx
git commit -m "feat(web): agent status global tab with system-push badge (no focus stealing)"
```

---

### Task 12: 全量回归 + README + 设计文档状态

**Files:**
- Modify: `README.md`（功能清单补内容栏条目）
- Modify: `docs/2026-09-30-content-panel-design.md`（状态行）

- [ ] **Step 12.1: 全仓类型检查 + 全部测试 + lint**

Run: `pnpm typecheck`
Expected: PASS

Run: `pnpm --filter server test && pnpm --filter web test`
Expected: 全部 PASS（重点关注 `PluginCardHost`、`AgentTimeline`、`sessionStore`、`validate`、`sessions`、`confirmation` 既有套件零回归）

Run: `pnpm lint`
Expected: PASS

- [ ] **Step 12.2: 端到端冒烟（`pnpm dev`）**

验收清单（标注 ⛔ 的前置 plan A 已执行）：

1. 双栏布局：宽屏对话 + 右侧内容栏；点击对话栏右上角图标开合内容栏；窗口缩到 <1024px → 内容栏变全屏覆盖层 + 关闭按钮
2. trace：发一条触发工具调用的消息 → 消息 timeline 卡片右上「展开」→ 内容栏打开会话 tab，展示步骤树 / 参数 / 结果 / 耗时 / token 估算；受限工具触发确认后 trace 内出现审批徽标（安全级别 + 状态）
3. agent 状态：发送中观察 rail 的「agent 状态」图标出现 unread 角标但焦点不切换；点击图标 → 状态面板显示当前 agentState / 工具调用 / 后台任务 id
4. 插件面板（可选，需一个声明 panels 的测试插件）：见下方「面板手动验证 fixture」——启用后 rail 出现面板图标，点击进入 PanelHost 面板（暗色 token 一致、activate/deactivate 切换、面板内 openTab/closeTab 受控导航）
5. bilibili 回归：安装并启用 bilibili-search → 消息流卡片渲染正常（协议未变）；确认其 plugin.json 无 `panels` → rail 无其入口
6. ⛔ 资产预览：上传图片/PDF/Markdown 附件（plan A 管道）→ 附件点击进内容栏（若 plan A 的前端入口已实现）或经 `@file`（input-commands 计划）打开 → 图片/PDF 分页/Markdown 渲染正常；PDF 首屏不阻塞主 bundle（Network 面板确认 `pdf-vendor` chunk 懒加载）

**面板手动验证 fixture（可选，验证后删除、不提交）：**

临时目录 `plugins/panel-demo/`，两文件：

`plugins/panel-demo/plugin.json`：

```json
{
  "name": "panel-demo",
  "version": "0.1.0",
  "description": "PanelHost 协议手动验证 fixture（验证后删除）",
  "author": { "name": "dev" },
  "license": "MIT",
  "engineCompatibility": { "minVersion": "0.1.0" },
  "source": "community",
  "permissions": {},
  "provides": {
    "frontendEntry": { "entry": "frontend/index.html" },
    "panels": [{ "id": "demo", "title": "演示面板", "scope": "global" }]
  }
}
```

`plugins/panel-demo/frontend/index.html`：

```html
<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<title>panel demo</title>
</head>
<body>
<div id="app"></div>
<script>
(function () {
  'use strict';
  var mounted = false;
  var app = document.getElementById('app');
  function post(msg) { window.parent.postMessage(msg, '*'); }
  function render(state) {
    app.innerHTML = '<div style="font:13px system-ui;color:' + (state.tokens && state.tokens.textPrimary || '#333') + '">' +
      '<p>面板已 ' + (mounted ? 'update' : 'mount') + '（protocol v1）</p>' +
      '<p>activate: ' + state.active + '</p>' +
      '<p>resize: ' + state.width + 'x' + state.height + '</p>' +
      '<button id="open">openTab trace</button> <button id="close">closeTab（关自己）</button></div>';
    document.getElementById('open').onclick = function () {
      post({ type: 'openTab', ref: { type: 'trace', sessionId: 'any' }, activate: false });
    };
    document.getElementById('close').onclick = function () { post({ type: 'closeTab' }); };
  }
  var state = { tokens: {}, width: 0, height: 0, active: false };
  window.addEventListener('message', function (event) {
    var d = event.data;
    if (!d || typeof d !== 'object') return;
    if (d.type === 'mount') { mounted = true; state.active = true; render(state); }
    if (d.type === 'update') render(state);
    if (d.type === 'activate') { state.active = true; render(state); }
    if (d.type === 'deactivate') { state.active = false; render(state); }
    if (d.type === 'resize') { state.width = d.width; state.height = d.height; render(state); }
    if (d.type === 'theme') { state.tokens = d.tokens; render(state); }
  });
  post({ type: 'ready', protocolVersion: 1 });
})();
</script>
</body>
</html>
```

安装启用（参照 bilibili-search README 的 curl 流程），验证后在设置页禁用并删除目录。

- [ ] **Step 12.3: README 功能清单**

`README.md` 的「### 对话体验」小节末尾追加一条：

```markdown
- 内容栏：双栏布局（左对话 / 右内容），全局与会话两类标签页；支持图片、PDF、Markdown、代码与纯文本资产预览、agent 执行过程 trace 视图与插件常驻面板（沙箱 iframe 协议）。
```

- [ ] **Step 12.4: 设计文档状态更新**

`docs/2026-09-30-content-panel-design.md` 头部状态行改为：

```markdown
**状态：** 已实施（实施计划 `docs/2026-09-30-content-panel-plan.md`；开放问题裁定见该计划：协议版本 = 单调整数 v1 = 1、会话 tab 栈随会话删除清理、tab 上限 12、信息密度以 bilibili 卡片为准绳）
```

- [ ] **Step 12.5: Commit**

```bash
git add README.md docs/2026-09-30-content-panel-design.md docs/2026-09-30-content-panel-plan.md
git commit -m "docs: mark content panel design as implemented and document feature in README"
```

---

## 规格覆盖自查（写给执行者）

| 设计文档条目 | 任务 |
|---|---|
| 双栏布局（chat 左 / content 右，lg 断点，覆盖层降级，对话栏 min-width） | Task 4 |
| 全局 rail（竖排图标）+ 会话 tab 条（横排、关闭按钮、溢出下拉） | Task 5（+ Task 10/11 入口扩展） |
| contentRef 三变体 + 规范化去重键 | Task 1 |
| ContentRenderer 注册表（canHandle/render/priority） | Task 3 |
| 内置渲染器：图片 / Markdown / 代码 / 纯文本 | Task 6 |
| 内置渲染器：PDF（pdf.js 懒加载 + worker + 独立 chunk） | Task 7 |
| 标签页模型（globalTabs 持久 / sessionTabs 内存 / activeTabId / origin / unread / pinned / LRU 上限） | Task 2 |
| 激活策略（user → 激活；system push → 角标不抢焦点） | Task 2（规则）+ Task 11（push 实例） |
| 去重（同 ref 复用 + origin 升格） | Task 2 |
| 会话 tab 栈随会话删除清理（开放问题 2） | Task 2（Step 2.5 接线） |
| Agent trace 视图（步骤树 / 参数与返回 / 审批记录 / token 与耗时估算） | Task 8 |
| trace 入口：timeline 卡片「展开」→ 会话 tab | Task 8（Step 8.13） |
| PanelHost 四件套（mount/update/activate/deactivate、resize 宿主→面板、theme tokens、受控导航 openTab/closeTab 宿主仲裁） | Task 9 |
| `ready {protocolVersion}` 握手，不匹配拒绝 mount（开放问题 1：v1 单调整数） | Task 9 |
| 卡片协议语义不变（bilibili 向后兼容硬约束） | Task 9（Step 9.3/9.10 回归锚点） |
| manifest `provides.frontendEntry` 补类型与 schema | **无需执行**——已存在（shared `FrontendEntry` + 双 schema，见计划头部对齐说明） |
| manifest `provides.panels`（shared 类型 + schema 双拷贝 + 校验） | Task 10 |
| 插件启用后按 panels 注册 tab 入口（按 scope） | Task 10 |
| agent 状态全局标签页（最小版） | Task 11 |
| 资产预览数据源（`/api/assets/:id/raw` + `/meta`） | Task 5（web 客户端函数；端点属 plan A） |
| 全量回归 + 文档 | Task 12 |

**明确不在本计划内（防执行者顺手实现）:**
- host API bridge（面板请求宿主能力：读附件 / 查会话 / 调 LLM）——协议扩展位，v1 不实现（设计非目标）
- HTML artifact 渲染、`artifact` contentRef 变体（未来演进）
- planner 结构化事件 / 计划视图（需 SSE 协议扩展，届时单开 RFC）
- 「文件库」全局标签页：依赖资产列表 API（plan A 未定义列表端点），随资产管理页另行计划；本计划只预留 `__host__` 命名空间
- `@file` 引用预览入口（归 input-commands 计划，复用本计划 contentRef 协议即可）
- 附件点击 → 资产 tab 的 MessageCard 入口（依赖 plan A 的 parts 渲染落地）
- 多窗口 / 面板拖出 / 分屏（设计非目标）
- PDF 文本层选择 / 大纲 / 缩放控件（v1 只做分页渲染）
- 面板间拖拽排序、tab 右键菜单（pinned 的 UI 入口 v1 仅 store 能力，无右键菜单——如需 UI 在后续迭代补）

