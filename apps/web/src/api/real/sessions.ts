// 会话域 API：会话 CRUD、消息发送/停止流、事件流恢复

import type { Session, SessionSummary, CreateSessionParams, Message } from '@my-copilot/shared';
import { enhancedFetch, fetchWithAuth } from '../request';
import { StreamError } from '../errors';

/**
 * Fetch session summaries
 * GET /api/sessions
 */
export async function fetchSessionSummaries(): Promise<SessionSummary[]> {
    const response = await enhancedFetch<{ data: SessionSummary[] }>('/api/sessions', {
        method: 'GET',
        timeout: 30000,
        retry: true,
        maxRetries: 3,
    });
    return response.data;
}

/**
 * Fetch messages for a session
 * GET /api/sessions/:id/messages
 */
export async function fetchSessionMessages(sessionId: string): Promise<Message[]> {
    const response = await enhancedFetch<{ data: Message[] }>(
        `/api/sessions/${sessionId}/messages`,
        {
            method: 'GET',
            timeout: 30000,
            retry: true,
            maxRetries: 3,
        }
    );
    return response.data;
}

/**
 * Create a new session
 * POST /api/sessions
 */
export async function createSession(params?: CreateSessionParams): Promise<Session> {
    const response = await enhancedFetch<{ data: Session }>('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params || {}),
        timeout: 30000,
    });
    return response.data;
}

/**
 * Result of sending a message. The server either streams the assistant reply
 * back immediately (sync mode, `text/event-stream`) or accepts it as a
 * background job and replies with JSON `{ data: { jobId } }` (async mode).
 */
export type SendMessageResult =
    | { mode: 'stream'; stream: ReadableStream<Uint8Array> }
    | { mode: 'async'; jobId: string };

/**
 * Send a message and receive either an SSE stream or a background job id.
 * POST /api/sessions/:sessionId/messages
 *
 * Body: JSON `{ content, assetIds? }` — attachments are referenced by
 * pre-uploaded asset ids (see {@link uploadAsset}); the server resolves
 * text kinds into context injection and image kinds into multimodal parts.
 *
 * Sync mode: returns `{ mode: 'stream', stream }` — an SSE stream to parse.
 * Async mode: returns `{ mode: 'async', jobId }` — the server deferred
 * generation to a background job; subscribe via `useJobStream` (GET /api/jobs/stream).
 *
 * Mode is decided by the response `Content-Type` header (JSON → async) BEFORE the
 * body is consumed, so an SSE stream is never mis-parsed as JSON (and vice versa).
 */
export async function sendMessage(params: {
    sessionId: string;
    content: string;
    assetIds?: string[];
    /** / 命令携带的手动激活 skill 名（chip 载荷，服务端 always 语义注入）。 */
    enforcedSkillIds?: string[];
    /** @会话 引用携带的目标会话 id（chip 载荷，服务端注入摘要块 + 按轮注册 read_session）。 */
    referencedSessionIds?: string[];
}): Promise<SendMessageResult> {
    const { sessionId, content, assetIds, enforcedSkillIds, referencedSessionIds } = params;

    const response = await fetchWithAuth(`/api/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            content,
            ...(assetIds && assetIds.length > 0 ? { assetIds } : {}),
            ...(enforcedSkillIds && enforcedSkillIds.length > 0 ? { enforcedSkillIds } : {}),
            ...(referencedSessionIds && referencedSessionIds.length > 0 ? { referencedSessionIds } : {}),
        }),
        timeout: 120000,
    });

    // Async mode: JSON `{ data: { jobId } }` instead of an SSE stream.
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
        const parsed = (await response.json()) as { data?: { jobId?: string } };
        const jobId = parsed?.data?.jobId;
        if (jobId) {
            return { mode: 'async', jobId };
        }
        throw new StreamError('Unexpected JSON response without jobId');
    }

    if (!response.body) {
        throw new StreamError('Response body is empty');
    }

    return { mode: 'stream', stream: response.body };
}

/**
 * Stop an ongoing stream
 * POST /api/sessions/:sessionId/messages/:msgId/stop
 */export async function stopStream(sessionId: string, msgId?: string): Promise<void> {
    const url = msgId
        ? `/api/sessions/${sessionId}/messages/${msgId}/stop`
        : `/api/sessions/${sessionId}/messages/stop`;
    await enhancedFetch(url, {
        method: 'POST',
        timeout: 10000,
    });
}

// ─── Session update API ───

export async function updateSession(id: string, params: Partial<CreateSessionParams>): Promise<Session> {
    const response = await enhancedFetch<{ data: Session }>(`/api/sessions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
        timeout: 30000,
    });
    return response.data;
}

/**
 * Attach to a live run's buffered SSE event stream（刷新恢复路径）。
 * GET /api/sessions/:id/events — 服务端先重放缓冲帧再实时推送，
 * 无活动 Run 时发 `event: idle` 后关闭；终态事件后关闭。
 * 返回原始 Response 供 parseSSEStream 消费。
 */
export async function attachSessionEvents(sessionId: string): Promise<Response> {
    const response = await fetchWithAuth(`/api/sessions/${encodeURIComponent(sessionId)}/events`);
    return response;
}
