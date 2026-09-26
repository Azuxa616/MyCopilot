// bilibili-card 围栏块载荷解析（非组件模块，供 index.tsx 与测试使用）。

/** 单个视频卡片数据（与插件 server/index.ts 的 VideoCard 形状一致）。 */
export interface BilibiliCardData {
  bvid: string
  title: string
  cover: string
  author: string
  play: number
  danmaku: number
  duration: string
  pubdate?: string
  url: string
}

/** 防御上限：一次最多渲染的卡片数（插件侧 MAX_CARDS=10，此处兜底）。 */
export const MAX_RENDER_CARDS = 12

function isCard(value: unknown): value is BilibiliCardData {
  if (typeof value !== 'object' || value === null) return false
  const c = value as Record<string, unknown>
  return (
    typeof c.bvid === 'string' &&
    typeof c.title === 'string' &&
    typeof c.cover === 'string' &&
    typeof c.url === 'string' &&
    typeof c.author === 'string' &&
    typeof c.play === 'number' &&
    typeof c.danmaku === 'number' &&
    typeof c.duration === 'string'
  )
}

/**
 * 从工具调用的原始结果字符串中提取 bilibili-card 围栏块载荷。
 * 结果可能是 MCP content 包装（`[{"type":"text","text":"…"}]` JSON）、
 * 纯文本（内嵌围栏块）或其他 JSON——逐层解包后统一按围栏块正则提取。
 * 找不到返回 null。
 */
export function extractBilibiliCardPayload(raw: string): string | null {
  if (!raw) return null
  let text = raw
  try {
    const parsed: unknown = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      text = parsed
        .map((item) =>
          item && typeof item === 'object' && typeof (item as { text?: unknown }).text === 'string'
            ? (item as { text: string }).text
            : '',
        )
        .join('\n')
    } else if (
      parsed &&
      typeof parsed === 'object' &&
      typeof (parsed as { text?: unknown }).text === 'string'
    ) {
      text = (parsed as { text: string }).text
    }
  } catch {
    // 非 JSON：按纯文本处理
  }
  const match = text.match(/```bilibili-card\s*\n([\s\S]*?)\n\s*```/)
  return match ? match[1].trim() : null
}

/**
 * 解析 bilibili-card 围栏块的 JSON 载荷。
 * 接受 `{cards:[…]}` 或裸数组；任一字段不合法返回 null（调用方回退为普通代码块）。
 */
export function parseBilibiliCards(payload: string): BilibiliCardData[] | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(payload)
  } catch {
    return null
  }
  const raw = Array.isArray(parsed)
    ? parsed
    : typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as { cards?: unknown }).cards)
      ? ((parsed as { cards: unknown[] }).cards)
      : null
  if (raw === null || raw.length === 0) return null
  if (!raw.every(isCard)) return null
  return raw.slice(0, MAX_RENDER_CARDS)
}
