import { describe, expect, it } from 'vitest'
import { isSupportedAttachmentName } from './file'

describe('attachment file validation', () => {
  it('accepts supported attachment extensions case-insensitively', () => {
    expect(isSupportedAttachmentName('notes.md')).toBe(true)
    expect(isSupportedAttachmentName('REPORT.DOCX')).toBe(true)
  })

  it('rejects legacy and unknown document extensions', () => {
    expect(isSupportedAttachmentName('legacy.doc')).toBe(false)
    expect(isSupportedAttachmentName('document.docs')).toBe(false)
  })
})
