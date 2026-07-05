import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { errorMiddleware } from '../../middleware/error.js';
import { sessionsApp } from '../sessions.js';

vi.mock('../../repo/session.js', () => ({
  listSessions: vi.fn(),
  getSession: vi.fn(),
  createSession: vi.fn(),
  updateSession: vi.fn(),
  deleteSession: vi.fn(),
}));

vi.mock('../../repo/message.js', () => ({
  listMessagesBySession: vi.fn(),
}));

import { listSessions, getSession, createSession, updateSession, deleteSession } from '../../repo/session.js';
import { listMessagesBySession } from '../../repo/message.js';

function createTestApp() {
  const app = new Hono();
  app.onError(errorMiddleware());
  app.route('/', sessionsApp);
  return app;
}

describe('sessions route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET / returns list of sessions', async () => {
    const mockSessions = [{ id: 's1', title: 'Test', modelId: null, messageCount: 0, createdAt: 1, updatedAt: 1 }];
    vi.mocked(listSessions).mockReturnValue(mockSessions);

    const app = createTestApp();
    const res = await app.request('/');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body).toEqual({ code: 0, msg: 'ok', data: mockSessions });
  });

  it('POST / creates session', async () => {
    const mockSession = { id: 's1', title: 'New Session', modelId: null, createdAt: 1, updatedAt: 1 };
    vi.mocked(createSession).mockReturnValue(mockSession);

    const app = createTestApp();
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'New Session' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.data).toEqual(mockSession);
  });

  it('GET /:id returns session when found', async () => {
    const mockSession = { id: 's1', title: 'Test', modelId: null, createdAt: 1, updatedAt: 1 };
    vi.mocked(getSession).mockReturnValue(mockSession);

    const app = createTestApp();
    const res = await app.request('/s1');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data).toEqual(mockSession);
  });

  it('GET /:id returns 404 when not found', async () => {
    vi.mocked(getSession).mockReturnValue(undefined);

    const app = createTestApp();
    const res = await app.request('/s1');
    expect(res.status).toBe(404);
    const body = await res.json() as any;
    expect(body.code).toBe(404);
  });

  it('PATCH /:id updates session', async () => {
    const updated = { id: 's1', title: 'Updated', modelId: 'm1', createdAt: 1, updatedAt: 2 };
    vi.mocked(updateSession).mockReturnValue(updated);

    const app = createTestApp();
    const res = await app.request('/s1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Updated' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data).toEqual(updated);
  });

  it('PATCH /:id returns 404 when not found', async () => {
    vi.mocked(updateSession).mockReturnValue(undefined);

    const app = createTestApp();
    const res = await app.request('/s1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Updated' }),
    });
    expect(res.status).toBe(404);
    const body = await res.json() as any;
    expect(body.code).toBe(404);
  });

  it('DELETE /:id deletes session', async () => {
    vi.mocked(deleteSession).mockReturnValue(true);

    const app = createTestApp();
    const res = await app.request('/s1', { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.deleted).toBe(true);
  });

  it('DELETE /:id returns 404 when not found', async () => {
    vi.mocked(deleteSession).mockReturnValue(false);

    const app = createTestApp();
    const res = await app.request('/s1', { method: 'DELETE' });
    expect(res.status).toBe(404);
    const body = await res.json() as any;
    expect(body.code).toBe(404);
  });

  it('GET /:id/messages returns messages for session', async () => {
    const mockMessages = [{ id: 'msg1', sessionId: 's1', role: 'user' as const, content: 'hi', attachments: [], status: 'sent' as const, createdAt: 1 }];
    vi.mocked(listMessagesBySession).mockReturnValue(mockMessages);

    const app = createTestApp();
    const res = await app.request('/s1/messages');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body).toEqual({ code: 0, msg: 'ok', data: mockMessages });
  });
});
