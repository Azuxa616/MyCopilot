// useModelOptions - 模型列表加载与选择 Hook
// 供 Sender 内的模型选择器使用（原 ChatShell 顶部模型栏的逻辑下沉）

import { useCallback, useEffect, useState } from 'react'
// API
import { api } from '../../../api'
// Store
import { useConfigStore } from '../../../store/configStore'
import { useSessionStore, NEW_SESSION_SENTINEL } from '../../../store/sessionStore'
// Utils
import { showMessageAlert } from '../../common/Alert/alertUtils'
import type { Model, Provider } from '@my-copilot/shared'

interface UseModelOptionsResult {
    allModels: Model[]
    providersMap: Record<string, Provider>
    isLoadingModels: boolean
    /** 当前生效的模型 ID：新会话取 pendingModelId，已有会话取绑定模型 */
    effectiveModelId: string | null | undefined
    handleModelChange: (modelId: string) => Promise<void>
}

/**
 * 模型选项 Hook
 * 负责拉取模型/Provider 列表、默认选中首个模型、切换模型时
 * 写入 pendingModelId（新会话）或会话绑定模型（已有会话）。
 */
export function useModelOptions(): UseModelOptionsResult {
    const selectedSessionId = useSessionStore((state) => state.selectedSessionId)
    const currentSession = useSessionStore((state) => state.currentSession)
    const pendingModelId = useSessionStore((state) => state.pendingModelId)
    const setPendingModelId = useSessionStore((state) => state.setPendingModelId)
    const updateSession = useSessionStore((state) => state.updateSession)
    const authToken = useConfigStore((state) => state.authToken)

    const [allModels, setAllModels] = useState<Model[]>([])
    const [providersMap, setProvidersMap] = useState<Record<string, Provider>>({})
    const [isLoadingModels, setIsLoadingModels] = useState(false)

    const loadModels = useCallback(async () => {
        setIsLoadingModels(true)
        try {
            // demo 角色（DEMO_TOKEN）访问 /api/providers 会返回 403；模型列表是聊天的关键路径，
            // 不能因 providers 拉取失败而整体失败——失败时降级为空列表，下拉框仅显示模型名。
            const [models, providers] = await Promise.all([
                api.fetchAllModels(),
                api.fetchProviders().catch(() => [] as Provider[]),
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

    // Load models when authToken becomes available (same pattern as Layout session loading).
    // On first visit, authToken is null on mount → loadModels would fail. After token entry,
    // this effect re-fires and populates the model dropdown.
    useEffect(() => {
        if (!authToken) return
        loadModels()
    }, [authToken, loadModels])

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

    const handleModelChange = useCallback(async (modelId: string) => {
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
    }, [selectedSessionId, setPendingModelId, updateSession])

    return {
        allModels,
        providersMap,
        isLoadingModels,
        effectiveModelId,
        handleModelChange,
    }
}
