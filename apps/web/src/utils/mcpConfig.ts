import type { McpConfig } from '@my-copilot/shared'

export interface ConfigValidation {
  /** 解析成功且结构合法时为对象，否则 null */
  config: McpConfig | null
  /** 错误信息，通过校验时为 null */
  error: string | null
  /** 校验通过时的摘要预览，否则 null */
  preview: string | null
}

const VALID_TRANSPORTS = new Set(['stdio', 'sse', 'http'])

/**
 * 校验 MCP 配置 JSON 文本：语法层（JSON.parse）+ 结构层（镜像后端
 * validateMcpConfig 的 transport/command/url 规则）。供 McpFormModal
 * 做实时校验与保存门禁。
 */
export function validateConfigJson(text: string): ConfigValidation {
  const trimmed = text.trim()
  if (trimmed.length === 0) {
    return { config: null, error: '配置不能为空', preview: null }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch (err) {
    const msg = err instanceof Error ? err.message : '解析失败'
    return { config: null, error: `JSON 语法错误：${msg}`, preview: null }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { config: null, error: 'JSON 必须是一个对象', preview: null }
  }

  const obj = parsed as Record<string, unknown>
  const transport = obj.transport
  if (
    typeof transport !== 'string' ||
    !VALID_TRANSPORTS.has(transport)
  ) {
    return {
      config: null,
      error: 'transport 必须是 stdio / sse / http 之一',
      preview: null,
    }
  }

  if (transport === 'stdio') {
    if (
      typeof obj.command !== 'string' ||
      obj.command.trim().length === 0
    ) {
      return {
        config: null,
        error: 'stdio 传输需要非空 command',
        preview: null,
      }
    }
  } else {
    if (typeof obj.url !== 'string' || obj.url.trim().length === 0) {
      return {
        config: null,
        error: `${transport} 传输需要非空 url`,
        preview: null,
      }
    }
  }

  const config = parsed as McpConfig
  return { config, error: null, preview: buildPreview(config) }
}

function buildPreview(config: McpConfig): string {
  if (config.transport === 'stdio') {
    const parts = [config.command ?? '']
    if (config.args && config.args.length > 0) {
      parts.push(config.args.join(' '))
    }
    return `stdio · ${parts.join(' ').trim()}`
  }
  return `${config.transport} · ${config.url ?? ''}`
}