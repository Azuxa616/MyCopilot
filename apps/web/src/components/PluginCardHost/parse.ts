// 通用卡片载荷提取（插件外部化）：从工具结果/消息文本中提取
// ```<pluginId>:card {...}``` 围栏块。协议归 spec 2026-09-26 §1。

/** 围栏语言形态：`<pluginId>:card`，pluginId 与清单 PluginName 同形。 */
const CARD_LANG = /^([a-z][a-z0-9-]{1,63}):card$/;

/** 围栏块匹配（语言 + 载荷体；允许多行 JSON）。 */
const CARD_FENCE = /```([a-z][a-z0-9-]{1,63}:card)\s*\n([\s\S]*?)\n\s*```/;

export interface CardBlock {
  pluginId: string;
  /** 围栏块内原文（应为 JSON；渲染器负责解释，宿主不校验内容形态）。 */
  payload: string;
}

/**
 * 从任意文本（或 MCP content 包装 JSON）中提取第一个卡片围栏块。
 * 找不到或语言不合法返回 null。
 */
export function extractCardPayload(raw: string): CardBlock | null {
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
  const match = text.match(CARD_FENCE)
  if (!match) return null
  const lang = CARD_LANG.exec(match[1])
  if (!lang) return null
  return { pluginId: lang[1], payload: match[2].trim() }
}
