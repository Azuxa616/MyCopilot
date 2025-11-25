import { useState, Suspense, lazy } from 'react'

// 懒加载主要组件
const Asider = lazy(() => import('../components/Asider/index'))
const ChatShell = lazy(() => import('../components/ChatShell'))
export default function MainView() {
    const [isCollapsed, setIsCollapsed] = useState(false)
    
    return (
        <div className="flex h-screen w-screen bg-bg-primary overflow-hidden">
            <aside className={`flex h-full shrink-0 border-r border-border-base transition-all duration-300 ${isCollapsed ? 'w-16' : 'w-64'}`}>
                <Suspense fallback={<div className="flex items-center justify-center h-full w-full">加载中...</div>}>
                    <Asider isCollapsed={isCollapsed} onToggleCollapse={() => setIsCollapsed(!isCollapsed)} />
                </Suspense>
            </aside>
            <main className="flex-1 flex flex-col items-center bg-bg-elevated text-text-primary overflow-hidden">
                <Suspense fallback={<div className="flex items-center justify-center h-full w-full">加载中...</div>}>
                    <ChatShell />
                </Suspense>
            </main>
        </div>

    )
}
