# 双栏内容面板（标签页 / 内容注册表 / PanelHost）设计

**日期：** 2026-09-30
**状态：** 设计定稿，待用户批准后转入实施计划
**分支：** main
**来源：** 2026-09-30 产品形态讨论结论沉淀
**关联文档：** `2026-09-30-attachment-assets-multimodal-design.md`（资产预览数据源）、`2026-09-30-input-commands-design.md`（`@file` 引用打开面板）、`docs/rfc/plugin-manifest-lifecycle.md`、`docs/rfc/types/plugin-security.d.ts`（信任层级）、`plugins/bilibili-search/`（现有沙箱渲染器实例）

## 背景与动机

MyCopilot 的产品定位是自托管 agent workspace（README：在同一个工作区里管理会话、模型、Skills、工具和 MCP 服务）。当前前端是单栏对话（`MainView → ChatShell`），输出侧只有消息流一条通道。

现状已有的可复用基础：

| 基础 | 代码级事实 |
|------|-----------|
| agent 过程数据 | `ChatShell/index.tsx` 的 `attachTimelines` 已把中间轮次（toolCalls + tool 结果）折叠为挂在最终消息上的 timeline |
| 沙箱渲染器 | `plugins/bilibili-search/frontend/index.html`：null origin 沙箱 iframe + postMessage 协议（`render/ready/rendered/error/open`）+ 自带 CSP + 高度上报（提交 d903993 已外部化） |
| 插件信任模型 | plugin-security RFC：Tier 1 内建 / Tier 2 official（可进程内）/ Tier 3 community（子进程沙箱、权限声明、审计） |
| 资产层 | 附件资产化设计（同日）提供可预览的持久化文件 |

## 目标

1. **双栏布局**：左对话栏（控制通道）+ 右内容栏（观察/操作通道），窄屏降级为覆盖层
2. **双类标签页**：全局标签页（文件库、agent 状态、插件常驻面板）+ 会话标签页（会话内打开的文件、trace），插件可注册两类
3. **contentRef + ContentRenderer 注册表**：一个内容引用协议喂四个入口（附件点击 / timeline 展开 / `@` 引用预览 / 插件导航）
4. **内置渲染器**：PDF（pdf.js 懒加载）、图片、Markdown、代码、纯文本
5. **Agent trace 视图**：消费现有 timeline 数据的全量展开视图
6. **PanelHost SDK**：把 bilibili 的 iframe 卡片协议推广为内容栏面板协议（四件套）

## 非目标

- 不做 HTML artifact 渲染（agent 生成物渲染是未来演进；沙箱化 renderer 雏形已备）
- 不做多窗口 / 面板拖出 / 面板分屏
- 不做 planner 结构化事件（需 SSE 协议扩展，见"未来演进"；v1 trace 消费存量数据）
- 不做插件任意 React 组件加载（宿主 bundle 内运行 = 无隔离 + 版本耦合，与信任模型冲突；Tier 2 official 的进程内选项留待未来）
- 不做协作编辑 / 面板内实时多用户

## 决策记录（用户已确认）

| 决策点 | 结论 | 备选与理由 |
|--------|------|-----------|
| 内容栏容器形态 | **标签页** | 单面板 + pin（初稿建议）被否——用户选择 tabs；tabs 把"抢占"问题简化为"激活策略"一条规则 |
| 标签页分类 | **全局 + 会话两类**：会话内文件展示属会话标签页；文件系统目录、agent 状态等属全局标签页；插件可注册新标签页 | 用户定义；全局类 app 级持久，会话类挂 sessionId（v1 内存态，跨刷新不恢复） |
| 激活策略 | 用户动作触发 → 激活并切换；系统 push（agent 事件等）→ 只创建 tab + 角标，不抢焦点 | 双栏的核心体验契约：阅读不被打断 |
| 插件面板技术形态 | **扩展 bilibili 沙箱 iframe 协议**（PanelHost SDK），不加载任意前端组件进宿主 | 隔离性 / 零版本耦合 / 低作者门槛 / 与信任层级对齐，详见"PanelHost SDK" |

## 布局与响应式

```text
┌──────────┬──────────────────────────────────────┐
│          │ [全局 rail]│ 会话 tab 条（横排）       │
│  会话     │──────────────────────────────────────│
│  侧栏     │                                      │
│ （现有）  │           内容栏主体                  │
│          │                                      │
│┌────────┐│                                      │
││对话栏   ││                                      │
││(ChatShell)│                                     │
│└────────┘│                                      │
└──────────┴──────────────────────────────────────┘
```

- 全局标签页做**左侧竖排图标 rail**（IDE 活动栏心智），会话标签页做内容栏顶部横排 tab——两类视觉/交互分离，不混排
- 断点 `lg`：以上双栏；以下内容栏退化为全屏覆盖层 + 顶部简化切换条
- 对话栏保留 `min-width`（虚拟滚动列表 + Markdown 表格/代码块水平适配；大内容"在内容栏打开"形成分工）
- 布局改动收敛在 MainView 容器层，MessageList / Sender 组件内部不动

## contentRef 协议

统一的内容引用，贯穿四个入口（去重键 = 规范化序列化）：

```ts
export type ContentRef =
  | { type: 'asset'; assetId: string }                    // 资产预览（PDF/图片/MD/代码/文本）
  | { type: 'trace'; sessionId: string; messageId?: string } // agent 过程视图
  | { type: 'panel'; pluginId: string; panelId: string };  // 插件面板
// 预留：| { type: 'artifact'; artifactId: string }
```

## ContentRenderer 注册表

```ts
export interface ContentRenderer {
  /** 声明可处理的 contentRef / mime。 */
  canHandle(ref: ContentRef, meta?: { mime?: string }): boolean;
  /** 渲染组件（懒加载）。 */
  render: () => Promise<ComponentType<{ ref: ContentRef }>>;
  /** 同 ref 多渲染器时的优先级，大者优先；插件渲染器默认低于内置。 */
  priority?: number;
}
```

内置渲染器：PDF（pdf.js，注意 worker 配置与独立 chunk 懒加载）、图片（`GET /api/assets/:id/raw`）、Markdown、代码高亮、纯文本。插件通过 PanelHost 注册自定义渲染（本质是 panel 类型 contentRef，不覆盖内置 renderer）。

## 标签页模型（contentPanelStore，Zustand）

```ts
interface TabEntry {
  tabId: string;
  ref: ContentRef;              // 去重键
  title: string;
  icon?: string;
  origin: 'user' | 'system';    // 激活策略依据
  pinned?: boolean;             // 用户钉住：永不 LRU 淘汰
  unread?: boolean;             // system push 未读角标
}

interface ContentPanelState {
  globalTabs: TabEntry[];                    // app 级持久（localStorage / 用户偏好）
  sessionTabs: Record<string, TabEntry[]>;   // 挂 sessionId，切会话换栈（内存态，不持久化）
  activeGlobalTabId: string | null;
  activeSessionTabId: Record<string, string | null>;
}
```

- **上限**：每类 8~12 个，溢出收进下拉列表；超限时 LRU 淘汰（`pinned` 除外）
- **生命周期分型**：插件 tab（iframe）关闭即销毁；文件预览 tab 关闭释放、可 LRU 缓存内容
- **去重**：打开已存在的 contentRef → 复用 tab；`origin` 升格为 `user`（用户重复打开视为确认）

## Agent trace 视图

- 数据源：现有 `attachTimelines` 产物（前端已持有），**v1 不动 SSE 协议**
- 展示：步骤树 / 每次工具调用的参数与返回 / 审批记录（`tool_approvals`）/ token 与耗时
- 入口：消息 timeline 卡片的"展开"图标 → `{ type: 'trace' }` 会话 tab；agent 后台 job 运行时 push 全局"agent 状态"标签页（角标不抢焦点）
- planner 结构化计划视图待 SSE 协议扩展（未来演进）

## PanelHost SDK

### 现状协议解剖（bilibili 实例，消息流内嵌卡片）

```text
宿主 → 插件 iframe： render {requestId, payload}
插件 → 宿主：        ready / rendered {height} / error {message} / open {url}
安全：sandbox 属性无 allow-same-origin（null origin）；插件 HTML 自带 CSP；
      宿主按 requestId + contentWindow 过滤消息；外链仅 https 放行
```

### 内容栏面板协议（四件套扩展）

| 类别 | 消息 | 说明 |
|------|------|------|
| 生命周期（宿主→面板） | `mount {requestId, panelId, protocolVersion, initialPayload}` | iframe 创建后首帧数据 |
| | `update {payload}` | 数据刷新 |
| | `activate` / `deactivate` | tab 切换通知（面板据此管理轮询/状态） |
| 尺寸（宿主→面板） | `resize {width, height}` | 内容栏是全高面板，方向与卡片相反：宿主推送 viewport 尺寸，面板自适应 |
| 主题（宿主→面板） | `theme {tokens}` | 颜色/字体 token 同步，保证暗色一致 |
| 受控导航（面板→宿主） | `openTab {ref: ContentRef, activate?}` / `closeTab {tabId?}` | 宿主仲裁后执行；`closeTab` 默认仅允许关自己 |
| 既有（面板→宿主） | `ready` / `rendered` / `error` / `open {url}` | 语义不变；`rendered.height` 仅内嵌卡片场景需要 |
| 握手 | `ready {protocolVersion}` | 版本协商，不匹配则宿主拒绝 mount 并提示 |

消息类型一经发布即公共 API，按"将来不能改"的标准设计（新增可以，改名/改语义禁止）。

### manifest 扩展

```jsonc
"provides": {
  "frontendEntry": { "entry": "frontend/index.html" },   // 补进 shared PluginManifest 类型与 schema（现状：bilibili 已在用，类型未定义）
  "panels": [
    { "id": "library", "title": "视频库", "scope": "global" }   // scope: 'global' | 'session'
  ]
}
```

- 仅声明 `frontendEntry` 而无 `panels`（现状插件）：只做消息流卡片渲染，不注册面板，**完全向后兼容**
- 插件启用后按 `panels` 声明注册 tab 入口（全局 rail 或会话 tab 条，按 scope）

### 安全模型

- 沿用现有渲染边界：null origin 沙箱 iframe + 插件自带 CSP + 宿主消息过滤，**不新增沙箱依赖**
- 信任层级对齐 plugin-security RFC：Tier 3 community 一律 iframe；Tier 2 official 的"进程内"选项不在本期
- host API bridge（面板请求宿主能力：读附件 / 查会话 / 调 LLM）为**协议扩展位**：必须映射 manifest `permissions` 的前端镜像并经宿主代理执行，v1 不实现

## 与现有系统的咬合

- **附件资产层设计**：`asset` 类 contentRef 的数据源（`/api/assets/:id/raw`）
- **input-commands 设计**：`@file` 悬停预览与点击打开复用 contentRef 协议
- **插件系统**：manifest schema（`docs/rfc/schemas/plugin.manifest.schema.json`）需同步 `frontendEntry` 与 `panels`；`PluginType` 的 `frontend-response` 即本设计的面板宿主形态
- **布局**：`MainView` 容器改造；会话侧栏（现有）不动

## 开放问题

1. PanelHost `protocolVersion` 的版本化策略（semver 子集 or 单调整数）——建议 v1 单调整数
2. 会话 tab 栈是否随会话删除而清理（建议：是，随 sessionId 键自然失效）
3. trace 视图信息密度分层（摘要行默认展开还是折叠）——实施时以 bilibili 卡片密度为准绳
4. tab 上限默认值（建议 12）与 LRU 参数

## 未来演进

- host API bridge（权限门控的宿主能力代理）
- HTML artifact 渲染（agent 生成物进内容栏，复用沙箱 renderer）
- planner 结构化事件 + 计划视图（SSE 协议扩展，对齐 diy-agent 设计"不改 SSE 11 种事件"的克制边界，届时单开 RFC）
- 面板拖出为独立窗口 / 分屏
