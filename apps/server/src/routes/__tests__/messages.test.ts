import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { errorMiddleware } from '../../middleware/error.js';
import { messagesApp } from '../messages.js';

vi.mock('../../repo/session.js', () => ({
  getSession: vi.fn(),
}));

vi.mock('../../repo/model.js', () => ({
  getModel: vi.fn(),
}));

vi.mock('../../repo/provider.js', () => ({
  getProvider: vi.fn(),
}));

vi.mock('../../repo/message.js', () => ({
  listMessagesBySession: vi.fn(),
  createMessage: vi.fn(),
  deleteMessage: vi.fn(),
}));

vi.mock('../../attachment/index.js', () => ({
  parseAllAttachments: vi.fn(),
}));

vi.mock('../../streaming/lifecycle.js', () => ({
  streamMessageHandler: vi.fn(),
}));

vi.mock('../../streaming/stop.js', () => ({
  stopStreamHandler: vi.fn(),
}));

import { getSession } from '../../repo/session.js';
import { getModel } from '../../repo/model.js';
import { getProvider } from '../../repo/provider.js';
import { listMessagesBySession, deleteMessage } from '../../repo/message.js';
import { parseAllAttachments } from '../../attachment/index.js';
import { streamMessageHandler } from '../../streaming/lifecycle.js';
import { stopStreamHandler } from '../../streaming/stop.js';

function createTestApp() {
  const app = new Hono();
  app.onError(errorMiddleware());
  app.route('/sessions/:sessionId/messages', messagesApp);
  return app;
}

describe('messages route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('POST / returns SSE response', async () => {
    const mockSession = { id: 's1', title: 'Test', modelId: 'm1', createdAt: 1, updatedAt: 1 };
    const mockModel = { id: 'm1', providerId: 'p1', name: 'gpt-4', enabled: true, createdAt: 1, updatedAt: 1 };
    const mockProvider = { id: 'p1', name: 'OpenAI', type: 'openai' as const, baseUrl: 'https://api.openai.com', apiKey: 'sk-test', enabled: true, createdAt: 1, updatedAt: 1 };

    vi.mocked(getSession).mockReturnValue(mockSession);
    vi.mocked(getModel).mockReturnValue(mockModel);
    vi.mocked(getProvider).mockReturnValue(mockProvider);
    vi.mocked(listMessagesBySession).mockReturnValue([]);
    vi.mocked(parseAllAttachments).mockResolvedValue({ results: [], warnings: [] });

    const sseResponse = new Response('sse-stream', { headers: { 'content-type': 'text/event-stream' } });
    vi.mocked(streamMessageHandler).mockReturnValue(sseResponse);

    const app = createTestApp();
    const form = new FormData();
    form.append('content', 'hello');

    const res = await app.request('/sessions/s1/messages', { method: 'POST', body: form });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    expect(streamMessageHandler).toHaveBeenCalled();
  });

  it('POST / returns 404 when session not found', async () => {
    vi.mocked(getSession).mockReturnValue(undefined);

    const app = createTestApp();
    const form = new FormData();
    form.append('content', 'hello');

    const res = await app.request('/sessions/s1/messages', { method: 'POST', body: form });
    expect(res.status).toBe(404);
    const body = await res.json() as any;
    expect(body.code).toBe(404);
  });

  it('POST / returns 400 when no model configured', async () => {
    vi.mocked(getSession).mockReturnValue({ id: 's1', title: 'Test', modelId: null, createdAt: 1, updatedAt: 1 });

    const app = createTestApp();
    const form = new FormData();
    form.append('content', 'hello');

    const res = await app.request('/sessions/s1/messages', { method: 'POST', body: form });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.code).toBe(400);
    expect(body.msg).toContain('No model configured');
  });

  it('POST / returns 400 when model not found', async () => {
    vi.mocked(getSession).mockReturnValue({ id: 's1', title: 'Test', modelId: 'm1', createdAt: 1, updatedAt: 1 });
    vi.mocked(getModel).mockReturnValue(undefined);

    const app = createTestApp();
    const form = new FormData();
    form.append('content', 'hello');

    const res = await app.request('/sessions/s1/messages', { method: 'POST', body: form });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.code).toBe(400);
    expect(body.msg).toContain('Model not found');
  });

  it('POST / returns 400 when provider not found', async () => {
    vi.mocked(getSession).mockReturnValue({ id: 's1', title: 'Test', modelId: 'm1', createdAt: 1, updatedAt: 1 });
    vi.mocked(getModel).mockReturnValue({ id: 'm1', providerId: 'p1', name: 'gpt-4', enabled: true, createdAt: 1, updatedAt: 1 });
    vi.mocked(getProvider).mockReturnValue(undefined);

    const app = createTestApp();
    const form = new FormData();
    form.append('content', 'hello');

    const res = await app.request('/sessions/s1/messages', { method: 'POST', body: form });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.code).toBe(400);
    expect(body.msg).toContain('Provider not found');
  });

  it('POST / returns 400 when provider is disabled', async () => {
    vi.mocked(getSession).mockReturnValue({ id: 's1', title: 'Test', modelId: 'm1', createdAt: 1, updatedAt: 1 });
    vi.mocked(getModel).mockReturnValue({ id: 'm1', providerId: 'p1', name: 'gpt-4', enabled: true, createdAt: 1, updatedAt: 1 });
    vi.mocked(getProvider).mockReturnValue({ id: 'p1', name: 'OpenAI', type: 'openai' as const, baseUrl: 'https://api.openai.com', apiKey: 'sk-test', enabled: false, createdAt: 1, updatedAt: 1 });

    const app = createTestApp();
    const form = new FormData();
    form.append('content', 'hello');

    const res = await app.request('/sessions/s1/messages', { method: 'POST', body: form });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.code).toBe(400);
    expect(body.msg).toContain('Provider is disabled');
  });

  it('POST /stop calls stopStreamHandler', async () => {
    const stopResponse = new Response(JSON.stringify({ code: 0, msg: 'ok', data: { stopped: true } }), {
      headers: { 'content-type': 'application/json' },
    });
    vi.mocked(stopStreamHandler).mockReturnValue(stopResponse);

    const app = createTestApp();
    const res = await app.request('/sessions/s1/messages/stop', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(stopStreamHandler).toHaveBeenCalledWith(expect.anything(), { sessionId: 's1' });
  });

  it('DELETE /:id deletes message', async () => {
    vi.mocked(deleteMessage).mockReturnValue(true);

    const app = createTestApp();
    const res = await app.request('/sessions/s1/messages/msg1', { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.deleted).toBe(true);
  });

  it('DELETE /:id returns 404 when not found', async () => {
    vi.mocked(deleteMessage).mockReturnValue(false);

    const app = createTestApp();
    const res = await app.request('/sessions/s1/messages/msg1', { method: 'DELETE' });
    expect(res.status).toBe(404);
    const body = await res.json() as any;
    expect(body.code).toBe(404);
  });
});
