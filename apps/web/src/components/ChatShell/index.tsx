// ChatShell - Chat interface
// Contains message input area and conversation display area

import { useEffect, useRef, useMemo } from 'react'
// Components
import Sender from '../Sender'
import EmptyChatView from './EmptyChatView'
import LoadingChatView from './LoadingChatView'
import MessageList from './MessageList'
// Hooks
import { useMessageVirtualizer } from './hooks/useMessageVirtualizer'
import { useAutoScroll } from './hooks/useAutoScroll'
import { useEntryReveal } from './hooks/useEntryReveal'
import { useMessageRegenerate } from './hooks/useMessageRegenerate'
import { useJobStream, TERMINAL_JOB_STATUSES } from './hooks/useJobStream'
// Store
import { useSessionStore } from '../../store/sessionStore'
import { NEW_SESSION_SENTINEL } from '../../store/sessionStore'
// Utils
import { attachTimelines, asTimelineMessages } from '../../utils/timeline'


export default function ChatShell() {
  const selectedSessionId = useSessionStore((state) => state.selectedSessionId)
  const currentSession = useSessionStore((state) => state.currentSession)
  const messagesCache = useSessionStore((state) => state.messagesCache)
  const isLoadingMessages = useSessionStore((state) => state.isLoadingMessages)
  const loadSessionMessages = useSessionStore((state) => state.loadSessionMessages)
  const pendingModelId = useSessionStore((state) => state.pendingModelId)
  const activeJobId = useSessionStore((state) => state.activeJobId)
  const setActiveJobId = useSessionStore((state) => state.setActiveJobId)

  // Get messages for current session from cache, grouped into "timeline +
  // final answer" per assistant turn:
  //  - intermediate rounds (assistant with toolCalls, role='tool' results) are
  //    folded into a timeline attached to the terminal assistant message
  //    (rebuilt from DB rows after refresh; live timeline preserved as-is)
  //  - the terminal assistant message keeps only the final answer as content
  const messages = useMemo(
    () =>
      selectedSessionId
        ? attachTimelines(asTimelineMessages(messagesCache[selectedSessionId] || []))
        : [],
    [messagesCache, selectedSessionId],
  )

  // Chat content scroll container
  const messagesContainerRef = useRef<HTMLDivElement | null>(null)

  // Virtual scroller
  const virtualizer = useMessageVirtualizer({
    messages,
    containerRef: messagesContainerRef,
  })

  // Auto-scroll logic
  useAutoScroll({
    messagesLength: messages.length,
    sessionId: currentSession?.id,
    virtualizer,
    containerRef: messagesContainerRef,
  })

  // 进入会话的就绪门控：布局稳定前隐藏消息列并钉底，稳定后淡入
  const { revealed: entryRevealed, showLoading: entryLoading } = useEntryReveal({
    containerRef: messagesContainerRef,
    sessionId: currentSession?.id,
    hasMessages: messages.length > 0,
    lastMessageId: messages[messages.length - 1]?.id,
    virtualizer,
  })

  // Message regeneration logic
  const { handleRegenerate } = useMessageRegenerate()

  // Background job progress (async send mode) — subscribes via SSE while activeJobId is set.
  const { job, isConnected, error } = useJobStream(activeJobId)

  // Load messages when selected session changes (skip pending session)
  useEffect(() => {
    if (selectedSessionId && selectedSessionId !== NEW_SESSION_SENTINEL && !currentSession) {
      loadSessionMessages(selectedSessionId)
    }
  }, [selectedSessionId, currentSession, loadSessionMessages])

  // When the background job reaches a terminal state, refresh the session's
  // messages from the server and clear the active job id. The cache is dropped
  // first because sendMessage added a placeholder assistant message; without
  // invalidation, loadSessionMessages would short-circuit on the stale cache.
  useEffect(() => {
    if (!job || !TERMINAL_JOB_STATUSES.includes(job.status)) return
    if (selectedSessionId && selectedSessionId !== NEW_SESSION_SENTINEL) {
      useSessionStore.setState((state) => {
        const nextCache = { ...state.messagesCache }
        delete nextCache[selectedSessionId]
        return { messagesCache: nextCache }
      })
      loadSessionMessages(selectedSessionId)
    }
    setActiveJobId(null)
  }, [job, selectedSessionId, loadSessionMessages, setActiveJobId])

  const hasNoModel = selectedSessionId === NEW_SESSION_SENTINEL
    ? !pendingModelId
    : !!currentSession && currentSession.modelId === null

  // Status text for the background job progress bar.
  const jobStatusText = error
    ? '连接异常，重试中...'
    : !isConnected
      ? '连接中...'
      : !job
        ? '处理中...'
        : job.status === 'pending'
          ? '排队中...'
          : job.status === 'running'
            ? '处理中...'
            : job.status === 'done'
              ? '已完成'
              : job.status === 'failed'
                ? '处理失败'
                : job.status === 'cancelled'
                  ? '已取消'
                  : '处理中...'

  return (
    <div className="flex flex-col h-full w-full">
      {/* Content area */}
      <div className="flex-1 overflow-hidden">
        {!selectedSessionId || !currentSession || messages.length === 0 ? (
          <div className="flex flex-col h-full">
            {hasNoModel && (
              <div className="shrink-0 px-4 py-3 bg-warning-50 border-b border-warning-200 text-sm text-warning-700">
                {selectedSessionId === NEW_SESSION_SENTINEL
                  ? '请先选择模型再开始对话，或前往配置'
                  : '当前 session 未绑定模型，请选择或'}
                <a href="/settings/providers" className="underline font-medium ml-1" onClick={(e) => { e.preventDefault(); window.location.href = '/settings/providers'; }}>
                  前往配置
                </a>
              </div>
            )}
            <EmptyChatView />
          </div>
        ) : isLoadingMessages ? (
          <LoadingChatView />
        ) : (
          <div className="flex flex-col h-full justify-between items-center gap-3 w-full pb-4">
            {hasNoModel && (
              <div className="shrink-0 px-4 py-3 w-full bg-warning-50 border-b border-warning-200 text-sm text-warning-700">
                当前 session 未绑定模型，请选择或
                <a href="/settings/providers" className="underline font-medium ml-1" onClick={(e) => { e.preventDefault(); window.location.href = '/settings/providers'; }}>
                  前往配置
                </a>
              </div>
            )}
            <div className="relative flex flex-col flex-1 w-full min-h-0">
              <MessageList
                revealed={entryRevealed}
                messages={messages}
                virtualizer={virtualizer}
                containerRef={messagesContainerRef}
                onRegenerate={handleRegenerate}
              />
              {/* 进入会话门控超过 300ms 时展示的轻量 Loading */}
              {entryLoading && !entryRevealed && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <span className="inline-block w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
                </div>
              )}
            </div>
            {/* Background job progress (async send mode)：置于输入框上方同列宽 */}
            {activeJobId && (
              <div className="w-full max-w-3xl mx-auto px-4">
                <div className="flex items-center gap-2 px-4 py-2 text-sm text-primary-700 bg-primary-50 border border-primary-100 rounded-xl">
                  <span className="inline-block w-3.5 h-3.5 border-2 border-primary-500 border-t-transparent rounded-full animate-spin shrink-0" />
                  <span>{jobStatusText}</span>
                </div>
              </div>
            )}
            <Sender />
          </div>
        )}
      </div>
    </div>
  )
}
