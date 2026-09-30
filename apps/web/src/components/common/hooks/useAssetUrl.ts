// useAssetUrl - 鉴权拉取资产字节并转为 objectURL
// <img src> 无法携带 Authorization 头（/api/assets/* 受 tokenAuth 保护），
// 故经 fetchWithAuth 取 blob 再 createObjectURL；卸载时 revoke。

import { useEffect, useState } from 'react'
import { fetchWithAuth } from '../../../api'

export function useAssetUrl(assetId: string | undefined): string | undefined {
    const [url, setUrl] = useState<string | undefined>(undefined)

    useEffect(() => {
        if (!assetId) {
            setUrl(undefined)
            return
        }
        let objectUrl: string | undefined
        let cancelled = false
        void (async () => {
            try {
                const res = await fetchWithAuth(`/api/assets/${assetId}/raw`, { method: 'GET' })
                if (!res.ok) return
                const blob = await res.blob()
                if (cancelled) return
                objectUrl = URL.createObjectURL(blob)
                setUrl(objectUrl)
            } catch {
                // fail-soft：加载失败不渲染预览
            }
        })()
        return () => {
            cancelled = true
            if (objectUrl) URL.revokeObjectURL(objectUrl)
        }
    }, [assetId])

    return url
}
