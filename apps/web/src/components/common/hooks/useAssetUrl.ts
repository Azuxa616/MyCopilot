// useAssetUrl - 鉴权拉取资产字节并转为 objectURL
// <img src> 无法携带 Authorization 头（/api/assets/* 受 tokenAuth 保护），
// 故经 fetchWithAuth 取 blob 再 createObjectURL；卸载时 revoke。

import { useEffect, useState } from 'react'
import { fetchWithAuth } from '../../../api'

export function useAssetUrl(assetId: string | undefined): string | undefined {
    const [state, setState] = useState<{ id: string; url: string } | null>(null)

    useEffect(() => {
        if (!assetId) return
        let objectUrl: string | undefined
        let cancelled = false
        void (async () => {
            try {
                const res = await fetchWithAuth(`/api/assets/${assetId}/raw`, { method: 'GET' })
                if (!res.ok) return
                const blob = await res.blob()
                if (cancelled) return
                objectUrl = URL.createObjectURL(blob)
                setState({ id: assetId, url: objectUrl })
            } catch {
                // fail-soft：加载失败不渲染预览
            }
        })()
        return () => {
            cancelled = true
            if (objectUrl) URL.revokeObjectURL(objectUrl)
        }
    }, [assetId])

    // id 配对返回：assetId 缺失/切换时立即回退 undefined（旧 state 不外泄）
    return state && state.id === assetId ? state.url : undefined
}
