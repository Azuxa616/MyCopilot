// ChatShell - Chat interface
// Contains message input area and conversation display area

import { useEffect, useRef, useState, useCallback } from 'react'
// Components
import Sender from '../Sender'
import EmptyChatView from './EmptyChatView'
import LoadingChatView from './LoadingChatView'
import MessageList from './MessageList'
// Hooks
import { useMessageVirtualizer } from './hooks/useMessageVirtualizer'
import { useAutoScroll } from './hooks/useAutoScroll'
import { useMessageRegenerate } from './hooks/useMessageRegenerate'
// Store
import { useSessionStore } from '../../store/sessionStore'
import { NEW_SESSION_SENTINEL } from '../../store/sessionStore'
// API
import { api } from '../../api'
import type { Model, Provider } from '@my-copilot/shared'
import { showMessageAlert } from '../common/Alert/alertUtils'

export default function ChatShell() {
  const selectedSessionId = useSessionStore((state) => state.selectedSessionId)
  const currentSession = useSessionStore((state) => state.currentSession)
  const messagesCache = useSessionStore((state) => state.messagesCache)
  const isLoadingMessages = useSessionStore((state) => state.isLoadingMessages)
  const loadSessionMessages = useSessionStore((state) => state.loadSessionMessages)
  const updateSession = useSessionStore((state) => state.updateSession)
  const pendingModelId = useSessionStore((state) => state.pendingModelId)
  const setPendingModelId = useSessionStore((state) => state.setPendingModelId)

  // Get messages for current session from cache
  const messages = selectedSessionId ? (messagesCache[selectedSessionId] || []) : []

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

  // Message regeneration logic
  const { handleRegenerate } = useMessageRegenerate()

  // Model selector state
  const [allModels, setAllModels] = useState<Model[]>([])
  const [providersMap, setProvidersMap] = useState<Record<string, Provider>>({})
  const [isLoadingModels, setIsLoadingModels] = useState(false)

  const loadModels = useCallback(async () => {
    setIsLoadingModels(true)
    try {
      const [models, providers] = await Promise.all([
        api.fetchAllModels(),
        api.fetchProviders(),
      ])
      setAllModels(models)
      const map: Record<string, Provider> = {}
      for (const p of providers) {
        map[p.id] = p
      }
      setProvidersMap(map)
    } catch (error) {
      console.error('Failed to load models:', error)
    } finally {
      setIsLoadingModels(false)
    }
  }, [])

  useEffect(() => {
    loadModels()
  }, [loadModels])

  // Auto-select first model when models load and no model is selected
  useEffect(() => {
    if (allModels.length > 0 && !currentSession?.modelId && !pendingModelId) {
      const firstModelId = allModels[0].id
      if (selectedSessionId === NEW_SESSION_SENTINEL) {
        setPendingModelId(firstModelId)
      } else if (selectedSessionId) {
        updateSession(selectedSessionId, { modelId: firstModelId })
      }
    }
  }, [allModels, currentSession?.modelId, pendingModelId, selectedSessionId, setPendingModelId, updateSession])

  // Effective model ID: pending for new session, bound model for existing session
  const effectiveModelId = selectedSessionId === NEW_SESSION_SENTINEL
    ? pendingModelId
    : currentSession?.modelId

  const handleModelChange = async (modelId: string) => {
    try {
      if (selectedSessionId === NEW_SESSION_SENTINEL) {
        setPendingModelId(modelId || null)
      } else if (selectedSessionId) {
        await updateSession(selectedSessionId, { modelId: modelId || null })
      }
    } catch (error) {
      console.error('Failed to update session model:', error)
      showMessageAlert.error('切换模型失败')
    }
  }

  // Load messages when selected session changes (skip pending session)
  useEffect(() => {
    if (selectedSessionId && selectedSessionId !== NEW_SESSION_SENTINEL && !currentSession) {
      loadSessionMessages(selectedSessionId)
    }
  }, [selectedSessionId, currentSession, loadSessionMessages])

  const hasNoModel = selectedSessionId === NEW_SESSION_SENTINEL
    ? !pendingModelId
    : !!currentSession && currentSession.modelId === null

  return (
    <div className="flex flex-col h-full w-full">
      {/* Model selector bar */}
      <div className="shrink-0 px-4 py-2 border-b border-border-base bg-bg-elevated flex items-center gap-3">
        <span className="text-sm text-text-secondary shrink-0">模型</span>
        {isLoadingModels ? (
          <span className="text-sm text-text-tertiary">加载中...</span>
        ) : (
          <select
            value={effectiveModelId || ''}
            onChange={(e) => handleModelChange(e.target.value)}
            className="flex-1 min-w-0 max-w-xs px-3 py-1.5 text-sm text-text-primary bg-bg-primary border border-border-base rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all"
          >
            <option value="">请选择模型</option>
            {allModels.map((model) => {
              const provider = providersMap[model.providerId]
              const label = provider
                ? `${provider.name} / ${model.displayName || model.name}`
                : model.displayName || model.name
              return (
                <option key={model.id} value={model.id}>
                  {label}
                </option>
              )
            })}
          </select>
        )}
      </div>

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
          <div className="flex flex-col h-full justify-between items-center gap-6 w-full pb-6">
            {hasNoModel && (
              <div className="shrink-0 px-4 py-3 w-full bg-warning-50 border-b border-warning-200 text-sm text-warning-700">
                当前 session 未绑定模型，请选择或
                <a href="/settings/providers" className="underline font-medium ml-1" onClick={(e) => { e.preventDefault(); window.location.href = '/settings/providers'; }}>
                  前往配置
                </a>
              </div>
            )}
            <MessageList
              messages={messages}
              virtualizer={virtualizer}
              containerRef={messagesContainerRef}
              onRegenerate={handleRegenerate}
            />
            <Sender />
          </div>
        )}
      </div>
    </div>
  )
}
