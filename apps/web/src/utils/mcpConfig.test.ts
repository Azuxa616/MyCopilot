import { describe, it, expect } from 'vitest'
import { validateConfigJson } from './mcpConfig'

describe('validateConfigJson', () => {
  it('rejects empty input', () => {
    const r = validateConfigJson('')
    expect(r.config).toBeNull()
    expect(r.error).toBe('配置不能为空')
    expect(r.preview).toBeNull()
  })

  it('rejects whitespace-only input', () => {
    const r = validateConfigJson('   \n  \t  ')
    expect(r.error).toBe('配置不能为空')
  })

  it('rejects invalid JSON with a syntax error message', () => {
    const r = validateConfigJson('{ transport: "stdio" }')
    expect(r.config).toBeNull()
    expect(r.error).toMatch(/JSON 语法错误/)
  })

  it('rejects JSON that is an array', () => {
    const r = validateConfigJson('[]')
    expect(r.error).toBe('JSON 必须是一个对象')
  })

  it('rejects JSON that is a primitive', () => {
    const r = validateConfigJson('"hello"')
    expect(r.error).toBe('JSON 必须是一个对象')
  })

  it('rejects missing transport', () => {
    const r = validateConfigJson('{"command": "npx"}')
    expect(r.error).toBe('transport 必须是 stdio / sse / http 之一')
  })

  it('rejects invalid transport value', () => {
    const r = validateConfigJson('{"transport": "ftp", "url": "x"}')
    expect(r.error).toBe('transport 必须是 stdio / sse / http 之一')
  })

  it('rejects stdio without command', () => {
    const r = validateConfigJson('{"transport": "stdio", "args": ["-y"]}')
    expect(r.error).toBe('stdio 传输需要非空 command')
  })

  it('rejects stdio with empty command string', () => {
    const r = validateConfigJson('{"transport": "stdio", "command": "  "}')
    expect(r.error).toBe('stdio 传输需要非空 command')
  })

  it('rejects sse without url', () => {
    const r = validateConfigJson('{"transport": "sse"}')
    expect(r.error).toBe('sse 传输需要非空 url')
  })

  it('rejects http without url', () => {
    const r = validateConfigJson('{"transport": "http"}')
    expect(r.error).toBe('http 传输需要非空 url')
  })

  it('accepts valid stdio config and builds preview', () => {
    const r = validateConfigJson(
      '{"transport":"stdio","command":"npx","args":["-y","@playwright/mcp@latest"],"env":{}}',
    )
    expect(r.error).toBeNull()
    expect(r.config).toEqual({
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@playwright/mcp@latest'],
      env: {},
    })
    expect(r.preview).toBe('stdio · npx -y @playwright/mcp@latest')
  })

  it('accepts valid stdio config without args', () => {
    const r = validateConfigJson('{"transport":"stdio","command":"node"}')
    expect(r.error).toBeNull()
    expect(r.preview).toBe('stdio · node')
  })

  it('accepts valid sse config and builds preview', () => {
    const r = validateConfigJson(
      '{"transport":"sse","url":"https://example.com/sse"}',
    )
    expect(r.error).toBeNull()
    expect(r.config?.transport).toBe('sse')
    expect(r.preview).toBe('sse · https://example.com/sse')
  })

  it('ignores unknown fields (lenient mode)', () => {
    const r = validateConfigJson(
      '{"transport":"stdio","command":"npx","cwd":"/tmp","type":"local"}',
    )
    expect(r.error).toBeNull()
    expect(r.config?.command).toBe('npx')
  })
})