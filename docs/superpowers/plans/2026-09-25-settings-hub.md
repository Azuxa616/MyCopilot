# 统一设置中心（Settings Hub）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Asider footer 的四个设置一级入口收敛为单个「设置」入口，`/settings` 提升为顶级路由并换成带左侧分类导航的独立设置壳（SettingsShell），同时从 plugin-system 分支合入 PluginsPage 插件管理页。

**Architecture:** 两个平行路由壳：`/` 用现有 Layout（AppShell），`/settings` 用新 SettingsShell（固定 w-64 导航侧栏 + max-w-4xl 内容容器）。五个现有分类页面零改动换壳；PluginsPage 经 `git show` 从分支整文件取回，其 API 方法手工合并进 `api/real.ts`（barrel `api = real` 自动透出）。

**Tech Stack:** React 19 + react-router v6（createBrowserRouter）+ Tailwind v4 + lucide-react（新依赖）+ Vitest/jsdom

**Spec:** `docs/superpowers/specs/2026-09-25-settings-hub-design.md`

**⚠️ 提交约定：** 本计划的 Commit 步骤需用户显式授权后执行；未授权时跳过 commit，仅完成代码与验证。工作区存在用户未暂存改动（`MessageList.tsx` 等），任何 commit 只允许显式 `git add` 本计划涉及的文件。

**文件总览：**

| 文件 | 动作 |
|---|---|
| `apps/web/package.json` | 加依赖 lucide-react |
| `packages/shared/src/plugin.ts` | 末尾追加 `PluginRecord` 接口（35 行，分支原文） |
| `apps/web/src/api/real.ts` | 导入列表加 2 个类型 + 文件末尾追加 Plugins API 段（6 个函数，分支原文） |
| `apps/web/src/views/settings/PluginsPage.tsx` | 自分支整文件取回 |
| `apps/web/src/views/settings/__tests__/PluginsPage.test.tsx` | 自分支整文件取回 |
| `apps/web/src/views/settings/SettingsShell.tsx` | 新建 |
| `apps/web/src/views/settings/__tests__/SettingsShell.test.tsx` | 新建 |
| `apps/web/src/router.tsx` | `/settings` 提升为顶级路由 |
| `apps/web/src/views/settings/SettingsLayout.tsx` | 删除 |
| `apps/web/src/components/Asider/index.tsx` | footer 四项换单入口 |
| `apps/web/src/components/Asider/index.test.tsx` | 新建 |

---

### Task 1: 安装 lucide-react

**Files:**
- Modify: `apps/web/package.json`（经 pnpm 自动改）

- [ ] **Step 1: 安装**

Run: `pnpm --filter web add lucide-react`
Expected: `apps/web/package.json` dependencies 出现 `"lucide-react": "^x.y.z"`，exit 0

- [ ] **Step 2: 冒烟验证按需导入**

Run: `pnpm --filter web exec tsc --noEmit`
Expected: 0 错误（尚未引用，仅确认依赖可用）

---

### Task 2: shared 层 PluginRecord 类型

**Files:**
- Modify: `packages/shared/src/plugin.ts`（文件末尾，`DEFAULT_PLUGIN_BUDGET` 之后追加）

- [ ] **Step 1: 追加类型定义**

在 `packages/shared/src/plugin.ts` 文件末尾追加（分支原文，引用的 `PluginSource`/`LifecycleState`/`PluginType`/`PluginManifest` 本文件已有定义）：

```typescript

// ---------------------------------------------------------------------------
// 插件注册表（repo 层的 shared 镜像）
// ---------------------------------------------------------------------------

/**
 * 插件注册表行记录（repo/plugin.ts 的 shared 镜像）。
 *
 * 对应数据库 `plugins` 表的完整行结构，包括插件元数据、状态、
 * 清单快照和错误信息。由 `apps/server/src/repo/plugin.ts` 定义并使用。
 */
export interface PluginRecord {
  /** 插件标识符（清单 name）*/
  id: string;
  /** 语义化版本 */
  version: string;
  /** 来源层级 */
  source: PluginSource;
  /** 生命周期状态 */
  state: LifecycleState;
  /** 可选的插件类型 */
  type?: PluginType;
  /** 安装时的完整清单快照 */
  manifest: PluginManifest;
  /** 内容摘要（verify 阶段写入）*/
  digest?: string;
  /** 插件目录路径 */
  directory: string;
  /** 错误信息（状态转换失败时）*/
  error?: string;
  /** 创建时间（毫秒时间戳）*/
  createdAt: number;
  /** 更新时间（毫秒时间戳）*/
  updatedAt: number;
}
```

- [ ] **Step 2: 验证 shared 包**

Run: `pnpm --filter @my-copilot/shared exec tsc --noEmit`
Expected: 0 错误（`packages/shared/src/index.ts` 已 `export * from './plugin.js'`，无需改动）

Run: `pnpm --filter @my-copilot/shared test`
Expected: 全绿（含既有 `__tests__/plugin.test.ts`）

- [ ] **Step 3: Commit（需授权）**

```bash
$env:GIT_MASTER='1'; git add packages/shared/src/plugin.ts
$env:GIT_MASTER='1'; git commit -m "feat(shared): add PluginRecord mirror type for plugin registry"
```

---

### Task 3: api/real.ts 合入 Plugins API

**Files:**
- Modify: `apps/web/src/api/real.ts`（导入块 + 文件末尾）

- [ ] **Step 1: 扩展类型导入**

把 `apps/web/src/api/real.ts` 顶部 import 块中的最后一行：

```typescript
  Mcp, CreateMcpParams, UpdateMcpParams, McpConfig, TestMcpConfigResult,
} from '@my-copilot/shared';
```

改为：

```typescript
  Mcp, CreateMcpParams, UpdateMcpParams, McpConfig, TestMcpConfigResult,
  PluginRecord, PluginLifecycleEvent,
} from '@my-copilot/shared';
```

- [ ] **Step 2: 文件末尾追加 Plugins API 段**（分支原文，`enhancedFetch` 与既有风格一致）

```typescript

// ─── Plugins API ───

/**
 * List all plugins
 * GET /api/plugins
 */
export async function fetchPlugins(): Promise<PluginRecord[]> {
    const response = await enhancedFetch<{ data: PluginRecord[] }>('/api/plugins', {
        method: 'GET',
        timeout: 30000,
        retry: true,
        maxRetries: 3,
    });
    return response.data;
}

/**
 * Install a plugin from a directory
 * POST /api/plugins/install
 */
export async function installPlugin(params: { directory: string }): Promise<PluginRecord> {
    const response = await enhancedFetch<{ data: PluginRecord }>('/api/plugins/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
        timeout: 60000,
    });
    return response.data;
}

/**
 * Enable a plugin
 * PATCH /api/plugins/:id/enable
 */
export async function enablePlugin(id: string): Promise<PluginRecord> {
    const response = await enhancedFetch<{ data: PluginRecord }>(`/api/plugins/${id}/enable`, {
        method: 'PATCH',
        timeout: 30000,
    });
    return response.data;
}

/**
 * Disable a plugin
 * PATCH /api/plugins/:id/disable
 */
export async function disablePlugin(id: string): Promise<PluginRecord> {
    const response = await enhancedFetch<{ data: PluginRecord }>(`/api/plugins/${id}/disable`, {
        method: 'PATCH',
        timeout: 30000,
    });
    return response.data;
}

/**
 * Uninstall a plugin
 * DELETE /api/plugins/:id
 */
export async function uninstallPlugin(id: string): Promise<void> {
    await enhancedFetch<{ data: unknown }>(`/api/plugins/${id}`, {
        method: 'DELETE',
        timeout: 30000,
    });
}

/**
 * Fetch lifecycle events for a plugin
 * GET /api/plugins/:id/events
 */
export async function fetchPluginEvents(id: string): Promise<PluginLifecycleEvent[]> {
    const response = await enhancedFetch<{ data: PluginLifecycleEvent[] }>(`/api/plugins/${id}/events`, {
        method: 'GET',
        timeout: 30000,
        retry: true,
        maxRetries: 3,
    });
    return response.data;
}
```

注：`api/index.ts` barrel 是 `export const api = real`，新函数自动经 `api.*` 可用，无需改 barrel。

- [ ] **Step 3: 验证**

Run: `pnpm --filter web exec tsc --noEmit`
Expected: 0 错误

Run: `pnpm --filter web exec eslint src/api/real.ts`
Expected: 0 错误

- [ ] **Step 4: Commit（需授权）**

```bash
$env:GIT_MASTER='1'; git add apps/web/src/api/real.ts
$env:GIT_MASTER='1'; git commit -m "feat(web): add plugin API client methods on real.ts"
```

---

### Task 4: 合入 PluginsPage 并在旧壳下验证

**Files:**
- Create: `apps/web/src/views/settings/PluginsPage.tsx`（分支原文件，约 300 行）
- Create: `apps/web/src/views/settings/__tests__/PluginsPage.test.tsx`（分支原文件，150 行）
- Modify: `apps/web/src/router.tsx`（旧 SettingsLayout children 暂挂 plugins 路由）

- [ ] **Step 1: 整文件取回（用 cmd 重定向避免 PowerShell 编码改写）**

```bash
cmd /c "git show plugin-system:apps/web/src/views/settings/PluginsPage.tsx > apps\web\src\views\settings\PluginsPage.tsx"
cmd /c "mkdir apps\web\src\views\settings\__tests__ 2>nul"
cmd /c "git show plugin-system:apps/web/src/views/settings/__tests__/PluginsPage.test.tsx > apps\web\src\views\settings\__tests__\PluginsPage.test.tsx"
```

取回后检查文件首行应分别是 `// PluginsPage - 插件管理：...` 与 `// PluginsPage.test.tsx - Tests for...`（无 BOM 乱码）。分支页面的全部 import（`api` barrel、`Modal`、`FormField`、`Badge`、`Alert/alertUtils`、shared 类型）已确认在 main 存在。

- [ ] **Step 2: 旧壳下暂挂路由**

`apps/web/src/router.tsx`：import 区加

```typescript
import { PluginsPage } from './views/settings/PluginsPage';
```

`settings` children 数组的 `mcps` 行后加：

```typescript
          { path: 'plugins', element: <PluginsPage /> },
```

- [ ] **Step 3: 跑合入测试**

Run: `pnpm --filter web exec vitest run src/views/settings/__tests__/PluginsPage.test.tsx`
Expected: 全部 PASS（该测试自包含：mock `../../../api`、createRoot + act 挂载、覆盖空态与按钮矩阵；若个别断言因 main 分叉失败，按失败信息修正测试内 fixture，不改实现语义）

- [ ] **Step 4: 验证**

Run: `pnpm --filter web exec tsc --noEmit`
Expected: 0 错误

- [ ] **Step 5: Commit（需授权）**

```bash
$env:GIT_MASTER='1'; git add apps/web/src/views/settings/PluginsPage.tsx apps/web/src/views/settings/__tests__/PluginsPage.test.tsx apps/web/src/router.tsx
$env:GIT_MASTER='1'; git commit -m "feat(web): add Plugins management page with lifecycle actions and event viewer"
```

---

### Task 5: SettingsShell（TDD）

**Files:**
- Create: `apps/web/src/views/settings/SettingsShell.tsx`
- Test: `apps/web/src/views/settings/__tests__/SettingsShell.test.tsx`

- [ ] **Step 1: 写失败测试**

`apps/web/src/views/settings/__tests__/SettingsShell.test.tsx`（沿用分支 PluginsPage.test 的 createRoot + act 惯例，不引 testing-library）：

```tsx
// SettingsShell.test.tsx — 设置壳：五分类导航渲染、当前项高亮、demo 角色重定向。

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { ReactElement } from 'react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import { SettingsShell } from '../SettingsShell'
import { useConfigStore } from '../../../store/configStore'

// React 19 requires this flag for act() to work correctly.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** Mounts a React element inside a MemoryRouter-driven route tree. */
async function renderAsync(ui: ReactElement): Promise<{
  container: HTMLElement
  unmount: () => void
}> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(ui)
  })
  return {
    container,
    unmount: () => {
      act(() => root.unmount())
      container.remove()
    },
  }
}

function shellRoutes(): ReactElement {
  return (
    <MemoryRouter initialEntries={['/settings/mcps']}>
      <Routes>
        <Route path="/settings" element={<SettingsShell />}>
          <Route path="providers" element={<div data-testid="page">providers</div>} />
          <Route path="tools" element={<div data-testid="page">tools</div>} />
          <Route path="skills" element={<div data-testid="page">skills</div>} />
          <Route path="mcps" element={<div data-testid="page">mcps</div>} />
          <Route path="plugins" element={<div data-testid="page">plugins</div>} />
        </Route>
      </Routes>
    </MemoryRouter>
  )
}

describe('SettingsShell', () => {
  beforeEach(() => {
    useConfigStore.setState({ role: 'admin' })
    vi.clearAllMocks()
  })

  it('渲染五个分类导航项并高亮当前路由', async () => {
    const { container, unmount } = await renderAsync(shellRoutes())

    const labels = Array.from(container.querySelectorAll('nav button span')).map(
      (s) => s.textContent,
    )
    expect(labels).toEqual(['模型服务', '工具', '技能', 'MCP', '插件'])

    // /settings/mcps → 「MCP」高亮
    const active = container.querySelector('nav button[aria-current="page"] span')
    expect(active?.textContent).toBe('MCP')

    // 子路由内容已渲染
    expect(container.querySelector('[data-testid="page"]')?.textContent).toBe('mcps')
    unmount()
  })

  it('demo 角色直访设置被重定向回 /', async () => {
    useConfigStore.setState({ role: 'demo' })
    let captured: string | undefined
    function Probe() {
      captured = useLocation().pathname
      return null
    }
    const { unmount } = await renderAsync(
      <MemoryRouter initialEntries={['/settings/mcps']}>
        <Probe />
        <Routes>
          <Route path="/settings" element={<SettingsShell />}>
            <Route path="mcps" element={null} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )
    expect(captured).toBe('/')
    unmount()
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter web exec vitest run src/views/settings/__tests__/SettingsShell.test.tsx`
Expected: FAIL——`Failed to resolve import "../SettingsShell"`（文件不存在）

- [ ] **Step 3: 实现 SettingsShell**

`apps/web/src/views/settings/SettingsShell.tsx`：

```tsx
// SettingsShell - 设置中心壳：左侧设置导航（返回应用 + 分类）+ 右侧内容区。
//
// 替代旧 SettingsLayout（顶部「← 返回」+ max-w-4xl 容器形态）：/settings 是
// 顶级路由，进入后左侧栏不再显示会话列表而是设置分类导航。demo 角色直访
// /settings 时整体重定向回应用（demo token 无权访问设置页接口，避免一屏 403）。
//
// 内容区沿用旧壳的 max-w-4xl mx-auto p-6 容器，五个现有分类页面零改动。

import { Outlet, useLocation, useNavigate, Navigate } from 'react-router-dom'
import {
  Settings,
  ArrowLeft,
  Server,
  Wrench,
  ScrollText,
  Plug,
  Puzzle,
} from 'lucide-react'
import { useConfigStore } from '../../store/configStore'

/** 设置分类清单：新增分类在此追加一行（竖向导航天然可扩展）。 */
const SECTIONS = [
  { path: 'providers', label: '模型服务', icon: Server },
  { path: 'tools', label: '工具', icon: Wrench },
  { path: 'skills', label: '技能', icon: ScrollText },
  { path: 'mcps', label: 'MCP', icon: Plug },
  { path: 'plugins', label: '插件', icon: Puzzle },
] as const

export function SettingsShell() {
  const navigate = useNavigate()
  const location = useLocation()
  const role = useConfigStore((state) => state.role)

  if (role === 'demo') {
    return <Navigate to="/" replace />
  }

  // startsWith 使 providers/:id 子路由也高亮「模型服务」。
  const isActive = (path: string) => location.pathname.startsWith(`/settings/${path}`)

  return (
    <div className="flex h-screen w-screen bg-bg-primary overflow-hidden">
      <aside className="flex flex-col w-64 shrink-0 h-full border-r border-border-base bg-bg-secondary">
        {/* 顶部：返回应用 */}
        <header className="flex items-center px-3 pt-3 shrink-0">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-1.5 px-2 py-1.5 text-sm text-text-secondary hover:text-text-primary hover:bg-bg-hover rounded-lg transition-colors"
            aria-label="返回应用"
          >
            <ArrowLeft className="w-5 h-5" />
            返回应用
          </button>
        </header>

        {/* 标题 */}
        <div className="flex items-center gap-2 px-4 py-3 shrink-0">
          <Settings className="w-5 h-5 text-text-secondary" />
          <h2 className="text-lg font-semibold text-text-primary">设置</h2>
        </div>

        {/* 分类导航（竖向可滚动，未来分类追加到尾部） */}
        <nav className="flex-1 flex flex-col gap-1 px-2 overflow-y-auto" aria-label="设置分类">
          {SECTIONS.map((item) => {
            const active = isActive(item.path)
            return (
              <button
                key={item.path}
                onClick={() => navigate(`/settings/${item.path}`)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm rounded-lg transition-colors ${
                  active
                    ? 'text-primary-500 bg-primary-50'
                    : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover'
                }`}
                aria-current={active ? 'page' : undefined}
              >
                <item.icon className="w-4 h-4 shrink-0" />
                <span>{item.label}</span>
              </button>
            )
          })}
        </nav>

        {/* 版本 footer（沿用 Asider 惯例） */}
        <footer className="shrink-0 border-t border-border-base">
          <div className="w-full text-center text-xs py-2 text-text-tertiary bg-bg-tertiary flex flex-col items-center">
            <span>MyCopilot Demo</span>
            <span>Author: @Azuxa616</span>
          </div>
        </footer>
      </aside>

      <main className="flex-1 overflow-y-auto bg-bg-elevated text-text-primary">
        <div className="max-w-4xl mx-auto p-6">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter web exec vitest run src/views/settings/__tests__/SettingsShell.test.tsx`
Expected: 2 个用例 PASS

- [ ] **Step 5: Commit（需授权）**

```bash
$env:GIT_MASTER='1'; git add apps/web/src/views/settings/SettingsShell.tsx apps/web/src/views/settings/__tests__/SettingsShell.test.tsx
$env:GIT_MASTER='1'; git commit -m "feat(web): add SettingsShell with section nav and demo-role guard"
```

---

### Task 6: 路由提升 + 删除旧壳

**Files:**
- Modify: `apps/web/src/router.tsx`（全文替换）
- Delete: `apps/web/src/views/settings/SettingsLayout.tsx`

- [ ] **Step 1: 重写 router.tsx**

```typescript
import { createBrowserRouter, Navigate } from 'react-router-dom';
import { Layout } from './views/Layout';
import { MainView } from './views/MainView';
import { SettingsShell } from './views/settings/SettingsShell';
import { ProvidersPage } from './views/settings/ProvidersPage';
import { ProviderDetailPage } from './views/settings/ProviderDetailPage';
import { ToolsPage } from './views/settings/ToolsPage';
import { SkillsPage } from './views/settings/SkillsPage';
import { McpsPage } from './views/settings/McpsPage';
import { PluginsPage } from './views/settings/PluginsPage';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [{ index: true, element: <MainView /> }],
  },
  {
    path: '/settings',
    element: <SettingsShell />,
    children: [
      // 直访 /settings 重定向到首个分类，保证「点设置必见内容」。
      { index: true, element: <Navigate to="/settings/providers" replace /> },
      { path: 'providers', element: <ProvidersPage /> },
      { path: 'providers/:id', element: <ProviderDetailPage /> },
      { path: 'tools', element: <ToolsPage /> },
      { path: 'skills', element: <SkillsPage /> },
      { path: 'mcps', element: <McpsPage /> },
      { path: 'plugins', element: <PluginsPage /> },
    ],
  },
]);
```

- [ ] **Step 2: 删除旧壳**

```bash
$env:GIT_MASTER='1'; git rm apps/web/src/views/settings/SettingsLayout.tsx
```

（未授权 commit 时用 `Remove-Item apps\web\src\views\settings\SettingsLayout.tsx` 代替）

- [ ] **Step 3: 确认无残留引用**

Run: `git grep -n "SettingsLayout" -- apps/web/src`
Expected: 无输出

- [ ] **Step 4: 跑全部 web 测试**

Run: `pnpm --filter web test`
Expected: 全绿（含 PluginsPage / SettingsShell / 既有组件测试）

- [ ] **Step 5: Commit（需授权）**

```bash
$env:GIT_MASTER='1'; git add apps/web/src/router.tsx
$env:GIT_MASTER='1'; git commit -m "feat(web): promote /settings to top-level route under SettingsShell"
```

---

### Task 7: Asider footer 换单入口（TDD）

**Files:**
- Modify: `apps/web/src/components/Asider/index.tsx`
- Test: `apps/web/src/components/Asider/index.test.tsx`（新建）

- [ ] **Step 1: 写失败测试**

`apps/web/src/components/Asider/index.test.tsx`：

```tsx
// Asider footer 测试：admin 仅一个「设置」入口；demo 隐藏。

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { ReactElement } from 'react'
import { MemoryRouter } from 'react-router-dom'
import Asider from './index'
import { useConfigStore } from '../../store/configStore'

// React 19 requires this flag for act() to work correctly.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

async function renderAsync(ui: ReactElement): Promise<{
  container: HTMLElement
  unmount: () => void
}> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(ui)
  })
  return {
    container,
    unmount: () => {
      act(() => root.unmount())
      container.remove()
    },
  }
}

describe('Asider footer', () => {
  beforeEach(() => {
    useConfigStore.setState({ role: 'admin' })
    vi.clearAllMocks()
  })

  it('admin：footer 仅一个设置入口，不再有四个一级导航', async () => {
    const { container, unmount } = await renderAsync(
      <MemoryRouter>
        <Asider />
      </MemoryRouter>,
    )
    const footerButtons = Array.from(container.querySelectorAll('footer button'))
    expect(footerButtons.length).toBe(1)
    expect(footerButtons[0].textContent).toContain('设置')
    unmount()
  })

  it('demo：设置入口隐藏', async () => {
    useConfigStore.setState({ role: 'demo' })
    const { container, unmount } = await renderAsync(
      <MemoryRouter>
        <Asider />
      </MemoryRouter>,
    )
    expect(container.querySelectorAll('footer button').length).toBe(0)
    unmount()
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter web exec vitest run src/components/Asider/index.test.tsx`
Expected: FAIL——admin 用例按钮数 4 ≠ 1

- [ ] **Step 3: 改 Asider footer**

`apps/web/src/components/Asider/index.tsx`：

3a. import 区加（放在 svgr 图标 import 之后）：

```tsx
import { Settings as IconSettings } from 'lucide-react'
```

3b. 删除 `goToSettings`、`isSettingsActive` 两个函数（`handleNewSession` 之后的整段）。

3c. footer 的「设置」分组（`role !== 'demo' && (...)` 四项循环块 + 「设置」小标题）整体替换为：

```tsx
        {role !== 'demo' && (
          <button
            onClick={() => navigate('/settings')}
            className={`w-full flex items-center ${isCollapsed ? 'justify-center' : 'justify-start gap-2'} ${isCollapsed ? 'px-2' : 'px-4'} py-2.5 text-sm text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors`}
            title={isCollapsed ? '设置' : undefined}
          >
            <IconSettings className="w-5 h-5 shrink-0" />
            {!isCollapsed && <span>设置</span>}
          </button>
        )}
```

版本信息块（`MyCopilot Demo` / `Author: @Azuxa616`）保持不动。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter web exec vitest run src/components/Asider/index.test.tsx`
Expected: 2 个用例 PASS

- [ ] **Step 5: Commit（需授权）**

```bash
$env:GIT_MASTER='1'; git add apps/web/src/components/Asider/index.tsx apps/web/src/components/Asider/index.test.tsx
$env:GIT_MASTER='1'; git commit -m "feat(web): replace sidebar footer nav group with single settings entry"
```

---

### Task 8: 全量验证 + 浏览器实测

- [ ] **Step 1: 三大门禁**

```bash
pnpm --filter web test
pnpm --filter web exec tsc --noEmit
pnpm lint
```

Expected: 三项全绿

- [ ] **Step 2: 起 dev 实测（Playwright，走 webapp-testing 流程）**

```bash
pnpm dev   # 根 .env 已配 PLUGINS_DIR=plugins
```

浏览器验证清单（对照 spec 验收标准）：
1. 主界面侧栏 footer 仅「设置」一个入口，点击进入 `/settings/providers`
2. 左侧五分类可切换、当前项高亮（进入 `providers/:id` 详情仍高亮「模型服务」）
3. 「← 返回应用」回 `/`；浏览器后退正常
4. 手输 `/settings/mcps`、`/settings/skills` 深链直达
5. 插件页：`安装` 弹窗输入目录名 `bilibili-search` → 列表出现 → `启用` → 刷新后状态 enabled；查看生命周期事件
6. 截图留档（主界面 footer + 设置页）

- [ ] **Step 3: 清理 dev 进程**

---

## Self-Review 记录

- **Spec 覆盖**：验收 1↔Task 7（入口+demo 隐藏）+Task 5（demo 重定向）；验收 2/3/4↔Task 5/6；验收 5↔Task 4+8；验收 6↔各 Task 测试步骤 + Task 8 门禁。图标规范↔Task 1/5/7。无遗漏。
- **占位扫描**：无 TBD；Task 4 的分支文件经 `git show` 整文件取回（确定性来源，非占位）；Task 4 Step 3 对测试分叉的处理给了明确判定规则（修 fixture 不改语义）。
- **类型一致性**：`PluginRecord`/`PluginLifecycleEvent` 在 Task 2 定义、Task 3/4 引用一致；`SECTIONS` 的 `path` 值与 Task 6 路由 children 逐一对应；测试选择器（`nav button span`、`aria-current`）与 Task 5 实现的 DOM 结构一致；Task 7 测试断言与 footer 新结构一致（`footer button` 唯一）。
