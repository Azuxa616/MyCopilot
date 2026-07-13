import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api', () => ({
  api: {
    sendMessage: vi.fn(),
  },
}))

import { api } from '../api'
import { useSessionStore } from './sessionStore'

describe('sessionStore attachment send failures', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSessionStore.setState({
      messagesCache: { s1: [] },
      selectedSessionId: 's1',
      isSending: false,
      abortController: null,
    })
  })

  it('marks the optimistic user message failed and rethrows the server error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const error = new Error('Attachment parsing failed: broken.docx: Corrupted ZIP archive')
    vi.mocked(api.sendMessage).mockRejectedValue(error)
    const file = new File(['broken'], 'broken.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })

    await expect(useSessionStore.getState().sendMessage({
      sessionId: 's1',
      content: 'read this',
      files: [file],
    })).rejects.toThrow(error.message)

    const [message] = useSessionStore.getState().messagesCache.s1
    expect(message).toMatchObject({
      role: 'user',
      status: 'failed',
      error: error.message,
    })
  })
})
