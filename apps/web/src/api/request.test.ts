import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useConfigStore } from '../store/configStore'
import { fetchWithAuth } from './request'

describe('fetchWithAuth', () => {
  beforeEach(() => {
    useConfigStore.setState({ authToken: 'test-token' })
    vi.restoreAllMocks()
  })

  it('preserves the server error message and response body', async () => {
    const responseBody = {
      code: 422,
      msg: 'Attachment parsing failed: legacy.doc: Unsupported file type: .doc',
      data: null,
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(responseBody), {
      status: 422,
      headers: { 'content-type': 'application/json' },
    })))

    await expect(fetchWithAuth('/api/sessions/s1/messages', { method: 'POST' })).rejects.toMatchObject({
      status: 422,
      message: responseBody.msg,
      responseBody,
    })
  })
})
