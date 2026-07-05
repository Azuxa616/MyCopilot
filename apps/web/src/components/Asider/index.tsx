// Asider - Sidebar component
// Contains session list and settings entry

import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
// Components
import ConversationNavItem from './ConversationNavItem'
import EmptyState from '../EmptyState'
// Assets
import IconCollapsedLeft from '../../assets/icon/collapsed-left.svg?react'
import IconCollapsedRight from '../../assets/icon/collapsed-right.svg?react'
import IconPlus from '../../assets/icon/plus.svg?react'
// Store
import { useSessionStore } from '../../store/sessionStore'

export interface AsiderProps {
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

export default function Asider({
  isCollapsed: externalIsCollapsed,
  onToggleCollapse
}: AsiderProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [internalIsCollapsed, setInternalIsCollapsed] = useState(false);
  const isCollapsed = externalIsCollapsed !== undefined ? externalIsCollapsed : internalIsCollapsed;
  const handleToggleCollapse = onToggleCollapse || (() => setInternalIsCollapsed(!internalIsCollapsed));

  // Read from store
  const sessionSummaries = useSessionStore((state) => state.sessionSummaries);
  const selectedSessionId = useSessionStore((state) => state.selectedSessionId);
  const setSelectedSessionId = useSessionStore((state) => state.setSelectedSessionId);
  const deleteSessionSummary = useSessionStore((state) => state.deleteSessionSummary);
  const enterNewSession = useSessionStore((state) => state.enterNewSession);

  // Handle session selection
  const handleItemClick = (sessionId: string) => {
    setSelectedSessionId(sessionId);
    if (location.pathname !== '/') {
      navigate('/');
    }
  };

  // Handle session deletion
  const handleDeleteSession = (sessionId: string) => {
    deleteSessionSummary(sessionId);
    if (selectedSessionId === sessionId) {
      setSelectedSessionId('');
    }
  };

  // Handle new session — just enter "new" mode locally, no backend call
  const handleNewSession = () => {
    enterNewSession();
    if (location.pathname !== '/') {
      navigate('/');
    }
  };

  // Navigate to settings
  const handleSettingsClick = () => {
    navigate('/settings/providers');
  };

  return (
    <div className="w-full h-full flex flex-col bg-bg-secondary transition-all duration-300">
      {/* header */}
      <header className={`flex items-center ${isCollapsed ? 'justify-center' : 'justify-between'} ${isCollapsed ? 'px-2' : 'px-4'} py-3 border-b border-border-base shrink-0`}>
        {!isCollapsed && (
          <h2 className="text-2xl font-semibold text-text-primary hover:text-shadow-primary-500 hover:text-shadow-md transition-all duration-300 whitespace-nowrap">
            MyCopilot
          </h2>
        )}
        {/* Collapse sidebar button */}
        <button
          className="bg-bg-primary border border-border-base text-text-primary hover:bg-bg-hover rounded-full p-1.5 transition-colors shrink-0"
          onClick={handleToggleCollapse}
          title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {isCollapsed ? <IconCollapsedLeft className="w-5 h-5" /> : <IconCollapsedRight className="w-5 h-5" />}
        </button>
      </header>

      {/* main content */}
      <main className={`flex-1 flex flex-col overflow-hidden ${isCollapsed ? 'px-2' : 'px-3'}`}>
        {/* New session button */}
        <button
          onClick={handleNewSession}
          className={`group w-full flex items-center ${isCollapsed ? 'justify-center' : 'justify-center gap-2'} p-3  mt-4 bg-primary-200 border-primary-400 border-2 rounded-lg hover:bg-primary-400 transition-colors shrink-0`}
          title={isCollapsed ? "New session" : undefined}
        >
          <IconPlus className="w-5 h-5 text-primary-500 group-hover:text-white transition-colors" />
          {!isCollapsed && (
            <span className="text-lg font-bold text-primary-500 group-hover:text-white transition-colors whitespace-nowrap">
              New Session
            </span>
          )}
        </button>

        {/* Session list */}
        <div className="flex-1 overflow-y-auto min-h-0 -mr-3 pr-3">
          {sessionSummaries.length === 0 && !isCollapsed ? (
            <EmptyState
              title="暂无对话"
              description="点击上方按钮新建对话开始聊天"
            />
          ) : (
            <nav className="flex flex-col gap-2 mt-4">
              {sessionSummaries.map((summary) => (
                <ConversationNavItem
                  key={summary.id}
                  id={summary.id}
                  title={summary.title}
                  isCollapsed={isCollapsed}
                  isSelected={selectedSessionId === summary.id}
                  onClick={() => handleItemClick(summary.id)}
                  onDelete={() => handleDeleteSession(summary.id)}
                />
              ))}
            </nav>
          )}
        </div>
      </main>

      {/* footer: settings + app version */}
      <footer className="flex flex-col shrink-0 border-t border-border-base bg-bg-secondary">
        <button
          onClick={handleSettingsClick}
          className={`w-full flex items-center ${isCollapsed ? 'justify-center' : 'justify-start'} ${isCollapsed ? 'px-2' : 'px-4'} py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors`}
          title={isCollapsed ? "设置" : undefined}
        >
          {isCollapsed ? (
            <span>⚙</span>
          ) : (
            <span>⚙ 设置</span>
          )}
        </button>
        {!isCollapsed && (
          <div className="w-full text-center text-xs py-2 text-text-tertiary bg-bg-tertiary flex flex-col items-center">
            <span>MyCopilot Demo</span>
            <span>Author: @Azuxa616</span>
          </div>
        )}
      </footer>
    </div>
  )
}
