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
