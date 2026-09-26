# 统一设置中心（Settings Hub）设计

> 日期：2026-09-25 · 状态：已批准（待实施） · 范围：`apps/web`
> 决议：采用方案 B（独立设置壳，顶级路由）；本期不加「通用」分类；设置侧栏固定
> `w-64` 不折叠；`Ctrl+,` 快捷键与导航 badge 推迟为可选后续。

## 动机

当前前端把 Providers / Tools / Skills / MCPs 四个配置入口平铺在主侧栏（Asider）
footer，作为一级导航。问题：

1. **不可扩展**：每新增一个配置域（如插件、未来的外观/数据管理）就多一个一级
   入口，footer 很快挤爆。
2. **插件页缺位**：后端 `/api/plugins` 与生命周期状态机已在 main，但
   `PluginsPage` 停在 `plugin-system` 分支未合入，前端无插件管理入口。
3. 与成熟 agent 产品（Claude、ChatGPT、Cursor、Discord、Open WebUI、Cherry
   Studio）的共识模式不符：主界面侧栏只放一个设置入口，设置是带独立二级导航
   的完整页面。

## 目标

- Asider footer 只保留**一个**「设置」入口（demo 角色仍隐藏）。
- `/settings` 提升为顶级路由，进入后左侧为设置专属侧栏：顶部「← 返回应用」，
   下方竖向二级导航（模型服务/工具/技能/MCP/插件），内容区渲染各分类页。
- 合入 plugin-system 分支的 `PluginsPage` 及其 API 客户端方法，提供插件
   安装/启用/禁用/卸载与生命周期事件查看的 UI。
- 深链兼容：现有 `/settings/<section>` 路径保持不变。

## 非目标

- 不做「通用」分类（Token/版本信息页）——等真有通用配置项再挂。
- 不做设置侧栏折叠（设置是临时态，固定 `w-64`）。
- 不做移动端适配、设置内搜索、`Ctrl+,` 快捷键、导航 badge。
- 不改五个现有分类页面的内部实现（它们只是换壳）。

## 方案（B：独立设置壳）

参考 Claude / Cherry Studio 的设置形态：设置拥有自己的 Layout 壳，与会话
AppShell 平行，而不是复用 Asider 容器做双态渲染。

理由：职责清晰（AppShell 管会话、SettingsShell 管配置）、Asider 只删不增、
设置壳样式可独立演进；视觉效果与「进入设置后左侧栏变为设置导航」的诉求一致。

### 路由结构

```text
/                    → Layout（AppShell：Asider + 主内容区）
  index              → MainView
/settings            → SettingsShell（顶级路由）
  index              → <Navigate to="/settings/providers" replace />
  providers          → ProvidersPage
  providers/:id      → ProviderDetailPage
  tools              → ToolsPage
  skills             → SkillsPage
  mcps               → McpsPage
  plugins            → PluginsPage（自 plugin-system 分支合入）
```

- `SettingsShell` 不再嵌套在 `Layout` 下：`router.tsx` 中 `/settings` 成为
  根级数组的新条目，`Layout` 的 children 只剩 index 路由。
- `/settings` 直访重定向到 `providers`（首个分类），保持「点设置必见内容」。

### 布局规格

```text
┌──────────────┬─────────────────────────────┐
│ ← 返回应用    │                             │
│ ⚙ 设置       │                             │
│──────────────│                             │
│ ▦ 模型服务    │   <Outlet/> 渲染当前分类页    │
│ 🔧 工具      │   （沿用现有页面组件与页头，   │
│ 📜 技能      │     如「MCP 管理 + 新建」）    │
│ ⚡ MCP      │                             │
│ 🧩 插件      │                             │
│              │                             │
│ （竖向可滚动， │                             │
│  未来分类追加  │                             │
│  到列表尾部）  │                             │
│──────────────│                             │
│ MyCopilot    │                             │
│ Author:@…    │                             │
└──────────────┴─────────────────────────────┘
```

（示意图中符号仅为占位，实际使用 lucide 图标，见下文图标规范。）

- 左侧栏固定 `w-64`、`bg-bg-secondary`、右边框 `border-border-base`，与会话
  侧栏同风格；**不折叠**。
- 当前项高亮 `text-primary-500 bg-primary-50`（与 Asider 现有高亮一致）。
- footer 沿用 Asider 的版本信息块（MyCopilot / Author）。

### 图标规范（lucide-react）

- **新增依赖 `lucide-react`**。理由：描边极简风格与项目 Tailwind token 体系的
  干净 UI 匹配；按图标 ESM 导入、摇树后仅引入所用图标（本方案约 7 个，增量
  几 KB）；`currentColor` 继承文字色、`w-4/h-4` 类控制尺寸，与 Tailwind v4
  零配置集成；React 19 兼容、MIT。
- 现有 svgr 手绘图标（折叠箭头、加号等结构性图标）**保持不动**；仅设置相关
  导入换用 lucide。
- 尺寸/描边约定：导航图标 `w-4 h-4`、返回/入口按钮 `w-5 h-5`，默认
  stroke-width，颜色一律继承 `currentColor`。

| 用途 | lucide 图标 |
|---|---|
| 设置入口 / 设置侧栏标题 | `Settings` |
| 返回应用 | `ArrowLeft` |
| 模型服务 providers | `Server` |
| 工具 tools | `Wrench` |
| 技能 skills | `ScrollText` |
| MCP mcps | `Plug` |
| 插件 plugins | `Puzzle` |

### 组件设计

**新增 `views/settings/SettingsShell.tsx`**（替代并删除 `SettingsLayout.tsx`）：

```tsx
// 结构伪代码
import { Settings, ArrowLeft, Server, Wrench, ScrollText, Plug, Puzzle } from 'lucide-react'

const SECTIONS = [
  { path: 'providers', label: '模型服务', icon: Server },
  { path: 'tools',     label: '工具',     icon: Wrench },
  { path: 'skills',    label: '技能',     icon: ScrollText },
  { path: 'mcps',      label: 'MCP',     icon: Plug },
  { path: 'plugins',   label: '插件',     icon: Puzzle },
] as const  // icon 为 LucideIcon 组件引用，渲染 <item.icon className="w-4 h-4" />

export function SettingsShell() {
  // demo 角色守卫：直访 /settings 时整体重定向回应用（否则页面接口全 403）
  const role = useConfigStore((s) => s.role)
  if (role === 'demo') return <Navigate to="/" replace />

  return (
    <div className="flex h-screen w-screen bg-bg-primary">
      <aside className="w-64 …">  {/* 返回按钮 + 标题 + SECTIONS 导航 + 版本 footer */} </aside>
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto p-6">  {/* 沿用旧壳内容容器，五个现有页面零改动 */}
          <Outlet />
        </div>
      </main>
    </div>
  )
}
```

- 高亮判定用 `useLocation().pathname` 前缀匹配（`providers/:id` 子路由也高亮
  「模型服务」）。
- 返回按钮 `navigate('/')`；浏览器后退天然可用（路由历史）。

**改动 `components/Asider/index.tsx`**：

- footer 的「设置」分组（四项 + 标题）替换为单个按钮：lucide `Settings`
  图标（`w-5 h-5`）+「设置」文案 → `navigate('/settings')`；保留
  `role !== 'demo'` 判定与版本信息块。
- `goToSettings` / `isSettingsActive` 及四项数组删除。

### PluginsPage 合入（来自 plugin-system 分支）

分支领先 main 13 个提交但未合并，其中前端相关且 main 缺失的：

| 文件 | 动作 |
|---|---|
| `apps/web/src/views/settings/PluginsPage.tsx` | 整文件取回（生命周期操作 + 事件查看器 UI） |
| `apps/web/src/views/settings/__tests__/PluginsPage.test.tsx` | 整文件取回，跑通后视 main 现状微调 |
| `apps/web/src/api/real.ts` | 分支与 main 已分叉，**手工合并**其 plugin 方法（fetchPlugins/install/enable/disable/uninstall/事件）到 main 版本，并经 `api/index.ts` barrel 导出 |
| `packages/shared/src/plugin.ts` | 追加分支上的 `PluginRecord` 镜像类型（main 缺失的 35 行），从 `packages/shared/src/index.ts` 导出 |

注意：合入时其余 9 个后端提交**不需要**——后端路由/loader/桥接已在 main。

## 验收标准

1. Asider footer 仅一个「设置」入口；demo 角色不显示该入口，且直访
   `/settings/*` 被重定向回 `/`。
2. 点击设置进入 `/settings/providers`；五个分类导航可切换、当前项高亮
   （含 `providers/:id` 子路由）。
3. 「← 返回应用」回到 `/`；浏览器后退行为正常。
4. 旧深链 `/settings/mcps|skills|tools|providers` 手输直达，不 404。
5. 插件页可展示插件列表、执行 enable/disable（install/uninstall 走
   `POST /api/plugins/install` / `DELETE /api/plugins/:id`）、查看生命周期事件。
6. `pnpm --filter web test`、`pnpm lint`、`pnpm typecheck` 全绿；新增/合入
   组件有渲染测试覆盖（SettingsShell 导航渲染 + demo 重定向）。

## 实施阶段

0. **阶段 0（依赖）**：`pnpm --filter web add lucide-react`。
1. **阶段 1（前置合入）**：shared `PluginRecord` → `api/real.ts` plugin 方法 →
   `PluginsPage` + 测试；在现有 SettingsLayout 下挂 `/settings/plugins` 路由
   先验证可用。
2. **阶段 2（换壳）**：新增 `SettingsShell` → `router.tsx` 提升 `/settings` 为
   顶级路由 → 删除 `SettingsLayout` → Asider footer 换单入口。
3. **阶段 3（可选后续，不在本期）**：`Ctrl+,`、导航 badge、通用分类。

## 开放问题决议记录

| 问题 | 决议 |
|---|---|
| 是否加「通用」分类 | 不加（YAGNI，未来有通用配置项再挂） |
| 设置侧栏折叠 | 固定 `w-64` 不折叠 |
| 旧 SettingsLayout 的 `max-w-4xl` 内容宽度 | SettingsShell 内容区保留 `max-w-4xl mx-auto p-6` 容器（滚动在 main 上），五个现有页面零改动 |
