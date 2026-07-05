/**
 * Real API implementation module
 *
 * All server-backed API calls using enhancedFetch with automatic Authorization.
 */

import type {
  Session, SessionSummary, CreateSessionParams,
  Provider, CreateProviderParams, Model, CreateModelParams,
  Message,
} from '@my-copilot/shared';
import { enhancedFetch, fetchWithAuth } from './request';
import { StreamError } from './errors';

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
 * Send a message and receive SSE stream
 * POST /api/sessions/:sessionId/messages
 *
 * Body: FormData with `content` field and `files[]` entries
 * Returns: ReadableStream from response.body for SSE parsing
 */
export async function sendMessage(params: {
    sessionId: string;
    content: string;
    files?: File[];
}): Promise<ReadableStream<Uint8Array>> {
    const { sessionId, content, files } = params;

    const formData = new FormData();
    formData.append('content', content);
    if (files) {
        for (const file of files) {
            formData.append('files[]', file);
        }
    }

    const response = await fetchWithAuth(`/api/sessions/${sessionId}/messages`, {
        method: 'POST',
        body: formData,
        timeout: 120000,
    });

    if (!response.body) {
        throw new StreamError('Response body is empty');
    }

    return response.body;
}

/**
 * Stop an ongoing stream
 * POST /api/sessions/:sessionId/messages/:msgId/stop
 */
export async function stopStream(sessionId: string, msgId?: string): Promise<void> {
    const url = msgId
        ? `/api/sessions/${sessionId}/messages/${msgId}/stop`
        : `/api/sessions/${sessionId}/messages/stop`;
    await enhancedFetch(url, {
        method: 'POST',
        timeout: 10000,
    });
}

// ─── Provider APIs ───

export async function fetchProviders(): Promise<Provider[]> {
    const response = await enhancedFetch<{ data: Provider[] }>('/api/providers', {
        method: 'GET',
        timeout: 30000,
        retry: true,
        maxRetries: 3,
    });
    return response.data;
}

export async function createProvider(params: CreateProviderParams): Promise<Provider> {
    const response = await enhancedFetch<{ data: Provider }>('/api/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
        timeout: 30000,
    });
    return response.data;
}

export async function updateProvider(id: string, params: Partial<CreateProviderParams>): Promise<Provider> {
    const response = await enhancedFetch<{ data: Provider }>(`/api/providers/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
        timeout: 30000,
    });
    return response.data;
}

export async function deleteProvider(id: string): Promise<void> {
    await enhancedFetch<{ data: { deleted: boolean } }>(`/api/providers/${id}`, {
        method: 'DELETE',
        timeout: 30000,
    });
}

export async function testProvider(id: string): Promise<{ success: boolean; errorClass?: string; message?: string; latencyMs?: number }> {
    const response = await enhancedFetch<{ data: { success: boolean; errorClass?: string; message?: string; latencyMs?: number } }>(`/api/providers/${id}/test`, {
        method: 'POST',
        timeout: 30000,
    });
    return response.data;
}

// ─── Model APIs ───

export async function fetchProvider(id: string): Promise<Provider> {
    const response = await enhancedFetch<{ data: Provider }>(`/api/providers/${id}`, {
        method: 'GET',
        timeout: 30000,
        retry: true,
        maxRetries: 3,
    });
    return response.data;
}

export async function fetchModelsByProvider(providerId: string): Promise<Model[]> {
    const response = await enhancedFetch<{ data: Model[] }>(`/api/providers/${providerId}/models`, {
        method: 'GET',
        timeout: 30000,
        retry: true,
        maxRetries: 3,
    });
    return response.data;
}

export async function fetchAllModels(): Promise<Model[]> {
    const response = await enhancedFetch<{ data: Model[] }>('/api/models', {
        method: 'GET',
        timeout: 30000,
        retry: true,
        maxRetries: 3,
    });
    return response.data;
}

export async function createModel(providerId: string, params: CreateModelParams): Promise<Model> {
    const response = await enhancedFetch<{ data: Model }>(`/api/providers/${providerId}/models`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
        timeout: 30000,
    });
    return response.data;
}

export async function updateModel(id: string, params: Partial<CreateModelParams>): Promise<Model> {
    const response = await enhancedFetch<{ data: Model }>(`/api/models/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
        timeout: 30000,
    });
    return response.data;
}

export async function deleteModel(id: string): Promise<void> {
    await enhancedFetch<{ data: { deleted: boolean } }>(`/api/models/${id}`, {
        method: 'DELETE',
        timeout: 30000,
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
