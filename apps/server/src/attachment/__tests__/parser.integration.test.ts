import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { parseAttachment } from '../parser.js'

const require = createRequire(import.meta.url)

describe('parseAttachment DOCX integration', () => {
  it('extracts text from a real DOCX buffer with the Node mammoth entry', async () => {
    const fixturePath = require.resolve('mammoth/test/test-data/single-paragraph.docx')
    const data = await readFile(fixturePath)

    const result = await parseAttachment({
      name: 'single-paragraph.docx',
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      data,
    })

    expect(result.success).toBe(true)
    expect(result.text).toContain('Walking on imported air')
    expect(result.meta?.textExcerpt).toContain('Walking on imported air')
  })
})
