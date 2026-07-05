// SettingsLayout - Settings page layout with back button

import { Outlet, useNavigate } from 'react-router-dom'

export function SettingsLayout() {
  const navigate = useNavigate()

  return (
    <div className="flex flex-col h-full w-full max-w-4xl mx-auto p-6">
      <header className="flex items-center gap-4 mb-6">
        <button
          onClick={() => navigate('/')}
          className="px-4 py-2 bg-bg-secondary border border-border-base text-text-primary rounded-lg hover:bg-bg-hover transition-colors"
        >
          ← 返回
        </button>
        <h1 className="text-2xl font-semibold text-text-primary">设置</h1>
      </header>
      <div className="flex-1 overflow-y-auto">
        <Outlet />
      </div>
    </div>
  )
}
