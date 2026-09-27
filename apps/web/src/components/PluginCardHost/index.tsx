// PluginCardHost - 通用插件卡片渲染宿主（插件外部化 §2，RFC B7 最小实现）。
//
// 加载「已启用插件」自带的 frontend/index.html（经认证 API 拉取，srcdoc 注入
// iframe），以 postMessage 驱动 render/rendered 协议；渲染器运行在
// sandbox="allow-scripts"（无 same-origin）的 null origin 中，拿不到宿主
// cookie/token/DOM。超时或渲染器报错 → 兜底卡片（含可折叠原始 JSON）。
// 宿主不含任何插件特化逻辑——卡片长什么样完全由插件渲染器决定。

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { api } from '../../api'

/** 渲染握手超时（ms），对齐 RFC B7 renderTimeoutMs 默认值。 */
const RENDER_TIMEOUT_MS = 10_000

/** 高度更新阈值：小于该差值不更新样式，避免视觉跳动。 */
const HEIGHT_EPSILON = 8

/** 渲染器入口 HTML 的模块级缓存（插件 id → html）。 */
const htmlCache = new Map<string, string>()

/** 兜底卡片高度（px）。 */
const FALLBACK_HEIGHT = 160

interface OpenRequest {
  type: 'open'
  requestId: string
  url: string
}

type RendererMessage =
  | { type: 'rendered'; requestId: string; height?: number }
  | { type: 'error'; requestId: string; message?: string }
  | OpenRequest

export interface PluginCardHostProps {
  /** 插件 id（围栏块语言前缀）。 */
  pluginId: string
  /** 围栏块载荷原文（渲染器自行 JSON.parse 并解释）。 */
  payload: string
}

export default function PluginCardHost({ pluginId, payload }: PluginCardHostProps) {
  const [html, setHtml] = useState<string | null>(htmlCache.get(pluginId) ?? null)
  const [failed, setFailed] = useState(false)
  const [height, setHeight] = useState(FALLBACK_HEIGHT)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  // 惰性初始化：整个挂载周期稳定不变（既是 data 属性也是消息协议标识）
  const [requestId] = useState(() => `pch-${crypto.randomUUID()}`)
  const [loadedFor, setLoadedFor] = useState(pluginId)

  // 复用组件实例切换插件时在渲染期重置派生状态（react-docs「render-time
  // state adjust」模式，规避 effect 内同步 setState 的级联渲染）。
  if (loadedFor !== pluginId) {
    setLoadedFor(pluginId)
    setHtml(htmlCache.get(pluginId) ?? null)
    setFailed(false)
    setHeight(FALLBACK_HEIGHT)
  }

  // 拉取渲染器入口（缓存命中时 html 非 null，effect 直接跳过；失败 → 兜底）
  useEffect(() => {
    if (html !== null) return
    let cancelled = false
    api
      .fetchPluginFrontend(pluginId)
      .then((entry) => {
        if (cancelled) return
        htmlCache.set(pluginId, entry)
        setHtml(entry)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [pluginId, html])

  // postMessage 握手：render → rendered/error/open；超时兜底
  useEffect(() => {
    if (!html || failed) return
    let handshakeDone = false

    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return
      const data = event.data as RendererMessage
      if (!data || typeof data !== 'object' || data.requestId !== requestId) return
      if (data.type === 'rendered') {
        handshakeDone = true
        const next = typeof data.height === 'number' && data.height > 0 ? data.height : null
        if (next !== null) {
          setHeight((prev) => (Math.abs(next - prev) > HEIGHT_EPSILON ? next : prev))
        }
      } else if (data.type === 'error') {
        setFailed(true)
      } else if (data.type === 'open') {
        // 沙箱内无 allow-popups：跳转由宿主代为执行（仅放行 https，防任意协议）
        if (typeof data.url === 'string' && data.url.startsWith('https://')) {
          window.open(data.url, '_blank', 'noopener,noreferrer')
        }
      }
    }
    window.addEventListener('message', onMessage)
    const timer = setTimeout(() => {
      if (!handshakeDone) setFailed(true)
    }, RENDER_TIMEOUT_MS)

    return () => {
      window.removeEventListener('message', onMessage)
      clearTimeout(timer)
    }
  }, [html, failed, requestId])

  const sendRender = useCallback(
    (frame: HTMLIFrameElement | null) => {
      iframeRef.current = frame
      frame?.contentWindow?.postMessage({ type: 'render', requestId, payload }, '*')
    },
    [requestId, payload],
  )

  if (failed) {
    return (
      <div
        className="my-3 flex flex-col gap-2 rounded-xl border border-border-base bg-bg-secondary p-4"
        data-testid="plugin-card-fallback"
      >
        <div className="flex items-center gap-2 text-[13px] text-text-secondary">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" aria-hidden />
          <span>
            插件「{pluginId}」渲染器不可用（未启用、未声明 frontendEntry 或渲染失败）
          </span>
        </div>
        <details className="text-[11px] text-text-tertiary">
          <summary className="cursor-pointer select-none">原始数据</summary>
          <pre className="m-0 mt-1 max-h-[200px] overflow-auto font-mono">{payload}</pre>
        </details>
      </div>
    )
  }

  return (
    <div
      className="my-3"
      data-testid="plugin-card-host"
      data-plugin-id={pluginId}
      data-request-id={requestId}
      aria-label={`插件卡片 · ${pluginId}`}
    >
      {html ? (
        <iframe
          ref={sendRender}
          title={`插件卡片 ${pluginId}`}
          sandbox="allow-scripts"
          srcDoc={html}
          style={{ height: `${height}px` }}
          className="w-full border-0"
        />
      ) : (
        <div className="flex h-10 items-center justify-center rounded-xl border border-border-base bg-bg-secondary text-[12px] text-text-tertiary">
          正在加载插件「{pluginId}」渲染器…
        </div>
      )}
    </div>
  )
}
