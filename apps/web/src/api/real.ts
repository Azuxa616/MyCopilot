/**
 * Real API implementation module
 *
 * All server-backed API calls using enhancedFetch with automatic Authorization.
 */

import type {
  Session, SessionSummary, CreateSessionParams,
  Provider, CreateProviderParams, Model, CreateModelParams,
  Message,
  Tool, CreateToolParams, UpdateToolParams,
  SkillMeta, SkillDetail, CreateSkillParams, UpdateSkillParams,
  Mcp, CreateMcpParams, UpdateMcpParams,
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
 * Body: FormData with `content` field and `files[]` entries.
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
    files?: File[];
}): Promise<SendMessageResult> {
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

// ─── Tools API ───

/**
 * Fetch all tools (optionally filtered by enabled state)
 * GET /api/tools
 */
export async function fetchTools(filter?: { enabled?: boolean }): Promise<Tool[]> {
    const query = filter?.enabled !== undefined ? `?enabled=${filter.enabled}` : '';
    const response = await enhancedFetch<{ data: Tool[] }>(`/api/tools${query}`, {
        method: 'GET',
        timeout: 30000,
    });
    return response.data;
}

/**
 * Create a new tool
 * POST /api/tools
 */
export async function createTool(params: CreateToolParams): Promise<Tool> {
    const response = await enhancedFetch<{ data: Tool }>('/api/tools', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
        timeout: 30000,
    });
    return response.data;
}

/**
 * Update an existing tool
 * PATCH /api/tools/:id
 */
export async function updateTool(id: string, params: UpdateToolParams): Promise<Tool> {
    const response = await enhancedFetch<{ data: Tool }>(`/api/tools/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
        timeout: 30000,
    });
    return response.data;
}

/**
 * Delete a tool
 * DELETE /api/tools/:id
 */
export async function deleteTool(id: string): Promise<void> {
    await enhancedFetch<{ data: unknown }>(`/api/tools/${id}`, {
        method: 'DELETE',
        timeout: 30000,
    });
}

/**
 * Test a tool's configuration / connectivity
 * POST /api/tools/:id/test
 */
export async function testTool(id: string): Promise<{ code: number; msg: string }> {
    const response = await enhancedFetch<{ data: { code: number; msg: string } }>(`/api/tools/${id}/test`, {
        method: 'POST',
        timeout: 60000,
    });
    return response.data;
}

/**
 * Execute a tool by name with the given arguments
 * POST /api/tools/execute
 */
export async function executeTool(params: {
    name: string;
    arguments: Record<string, unknown>;
    sessionId: string;
    id?: string;
}): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
    const response = await enhancedFetch<{ data: unknown }>('/api/tools/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
        timeout: 60000,
    });
    return response.data as { content: Array<{ type: string; text: string }>; isError?: boolean };
}

/**
 * Approve or reject a pending tool call
 * POST /api/tools/confirm/:callId
 */
export async function confirmToolCall(callId: string, approved: boolean): Promise<{ resolved: boolean }> {
    const response = await enhancedFetch<{ data: { resolved: boolean } }>(
        `/api/tools/confirm/${encodeURIComponent(callId)}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ approved }),
            timeout: 30000,
        }
    );
    return response.data;
}

/**
 * Get status of a pending tool call
 * POST /api/tools/calls/:callId
 */
export async function getToolCallStatus(callId: string): Promise<{
    toolCall: { id: string; name: string; arguments: string };
    expiresAt: number;
}> {
    const response = await enhancedFetch<{ data: unknown }>(
        `/api/tools/calls/${encodeURIComponent(callId)}`,
        {
            method: 'POST',
            timeout: 30000,
        }
    );
    return response.data as {
        toolCall: { id: string; name: string; arguments: string };
        expiresAt: number;
    };
}

// ─── Skills API ───

/**
 * List all skills
 * GET /api/skills
 */
export async function fetchSkills(): Promise<SkillMeta[]> {
    const response = await enhancedFetch<{ data: SkillMeta[] }>('/api/skills', {
        method: 'GET',
        timeout: 30000,
    });
    return response.data;
}

/**
 * Get a single skill (including body content)
 * GET /api/skills/:id
 */
export async function getSkill(id: string): Promise<SkillDetail> {
    const response = await enhancedFetch<{ data: SkillDetail }>(`/api/skills/${id}`, {
        method: 'GET',
        timeout: 30000,
    });
    return response.data;
}

/**
 * Create a new skill
 * POST /api/skills
 */
export async function createSkill(params: CreateSkillParams): Promise<SkillMeta> {
    const response = await enhancedFetch<{ data: SkillMeta }>('/api/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
        timeout: 30000,
    });
    return response.data;
}

/**
 * Update an existing skill
 * PATCH /api/skills/:id
 */
export async function updateSkill(id: string, params: UpdateSkillParams): Promise<SkillMeta> {
    const response = await enhancedFetch<{ data: SkillMeta }>(`/api/skills/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
        timeout: 30000,
    });
    return response.data;
}

/**
 * Delete a skill
 * DELETE /api/skills/:id
 */
export async function deleteSkill(id: string): Promise<void> {
    await enhancedFetch<{ data: unknown }>(`/api/skills/${id}`, {
        method: 'DELETE',
        timeout: 30000,
    });
}

/**
 * Trigger a rescan of skill sources
 * POST /api/skills/rescan
 */
export async function rescanSkills(): Promise<{ scanned: number }> {
    const response = await enhancedFetch<{ data: { scanned: number } }>('/api/skills/rescan', {
        method: 'POST',
        timeout: 60000,
    });
    return response.data;
}

// ─── MCPs API ───

/**
 * List all MCP servers
 * GET /api/mcps
 */
export async function fetchMcps(): Promise<Mcp[]> {
    const response = await enhancedFetch<{ data: Mcp[] }>('/api/mcps', {
        method: 'GET',
        timeout: 30000,
    });
    return response.data;
}

/**
 * Create a new MCP server entry
 * POST /api/mcps
 */
export async function createMcp(params: CreateMcpParams): Promise<Mcp> {
    const response = await enhancedFetch<{ data: Mcp }>('/api/mcps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
        timeout: 30000,
    });
    return response.data;
}

/**
 * Update an MCP server entry
 * PATCH /api/mcps/:id
 */
export async function updateMcp(id: string, params: UpdateMcpParams): Promise<Mcp> {
    const response = await enhancedFetch<{ data: Mcp }>(`/api/mcps/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
        timeout: 30000,
    });
    return response.data;
}

/**
 * Delete an MCP server entry
 * DELETE /api/mcps/:id
 */
export async function deleteMcp(id: string): Promise<void> {
    await enhancedFetch<{ data: unknown }>(`/api/mcps/${id}`, {
        method: 'DELETE',
        timeout: 30000,
    });
}

/**
 * Test an MCP server connection and return its available tool names
 * POST /api/mcps/:id/test
 */
export async function testMcp(id: string): Promise<{ tools: string[] }> {
    const response = await enhancedFetch<{ data: { tools: string[] } }>(`/api/mcps/${id}/test`, {
        method: 'POST',
        timeout: 60000,
    });
    return response.data;
}

// ─── Jobs API (Step B placeholder) ───

/**
 * List background jobs (placeholder until Step B)
 * GET /api/jobs
 */
export async function fetchJobs(): Promise<unknown[]> {
    const response = await enhancedFetch<{ data: unknown[] }>('/api/jobs', {
        method: 'GET',
        timeout: 30000,
    });
    return response.data;
}

/**
 * Get a single background job by id (placeholder until Step B)
 * GET /api/jobs/:id
 */
export async function getJob(id: string): Promise<unknown> {
    const response = await enhancedFetch<{ data: unknown }>(`/api/jobs/${id}`, {
        method: 'GET',
        timeout: 30000,
    });
    return response.data;
}

/**
 * Cancel a background job (placeholder until Step B)
 * POST /api/jobs/:id/cancel
 */
export async function cancelJob(id: string): Promise<unknown> {
    const response = await enhancedFetch<{ data: unknown }>(`/api/jobs/${id}/cancel`, {
        method: 'POST',
        timeout: 30000,
    });
    return response.data;
}
