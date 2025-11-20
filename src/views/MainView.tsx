import { useState } from 'react'
import Asider from '../components/Asider'
import ChatShell from '../components/ChatShell'
export default function MainView() {
    const [isCollapsed, setIsCollapsed] = useState(false)
    
    return (
        <div className="flex h-screen w-screen bg-bg-primary overflow-hidden">
            <aside className={`flex h-full shrink-0 border-r border-border-base transition-all duration-300 ${isCollapsed ? 'w-16' : 'w-64'}`}>
                <Asider isCollapsed={isCollapsed} onToggleCollapse={() => setIsCollapsed(!isCollapsed)} />
            </aside>
            <main className="flex-1 flex flex-col items-center bg-bg-elevated text-text-primary overflow-hidden">
                <ChatShell />
            </main>
        </div>

    )
}
