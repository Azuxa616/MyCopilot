/**
 * Real API implementation module
 *
 * All server-backed API calls using enhancedFetch with automatic Authorization.
 */

import type {
  Session, SessionSummary, CreateSessionParams,
  Provider, CreateProviderParams, Model, CreateModelParams,
  Message,
  AuthInfo,
  Tool, UpdateToolParams,
  SkillMeta, SkillDetail, CreateSkillParams, UpdateSkillParams,
  Mcp, CreateMcpParams, UpdateMcpParams, McpConfig, TestMcpConfigResult,
  RunTraceRecord, RunStepRecord,
  EvalSnapshot, EvalRunResult, EvalCategory, EvalMode,
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

// ─── Auth APIs ───

export async function fetchAuthMe(): Promise<AuthInfo> {
    const response = await enhancedFetch<{ data: AuthInfo }>('/api/auth/me', {
        method: 'GET',
        timeout: 30000,
    });
    return response.data;
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
 * Execute a tool with caller-supplied arguments for manual testing.
 * POST /api/tools/:id/test
 *
 * Safe tools return the full execution result (content + isError).
 * Restricted/danger tools return an error indicating confirmation is required.
 */
export async function testTool(id: string, args?: Record<string, unknown>): Promise<{
    content: Array<{ type: string; text: string }>;
    isError?: boolean;
}> {
    const response = await enhancedFetch<{ data: { content: Array<{ type: string; text: string }>; isError?: boolean } }>(`/api/tools/${id}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ arguments: args ?? {} }),
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
 * Approve or reject a pending tool confirmation
 * POST /api/tools/confirm/:approvalId
 */
export async function confirmToolCall(approvalId: string, approved: boolean): Promise<{ resolved: boolean }> {
    const response = await enhancedFetch<{ data: { resolved: boolean } }>(
        `/api/tools/confirm/${encodeURIComponent(approvalId)}`,
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
 * Get status of a pending tool confirmation
 * GET /api/tools/calls/:approvalId
 */
export async function getToolCallStatus(approvalId: string): Promise<{
    toolCall: { id: string; name: string; arguments: string };
    expiresAt: number;
}> {
    const response = await enhancedFetch<{ data: unknown }>(
        `/api/tools/calls/${encodeURIComponent(approvalId)}`,
        {
            method: 'GET',
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

/**
 * Import a skill directory pack from a ZIP file
 * POST /api/skills/import (multipart/form-data)
 */
export async function importSkillZip(file: File): Promise<SkillMeta> {
    const formData = new FormData();
    formData.append('file', file);
    const response = await fetchWithAuth('/api/skills/import', {
        method: 'POST',
        body: formData,
    });
    if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { msg?: string } | null;
        throw new Error(body?.msg ?? `导入失败（HTTP ${response.status}）`);
    }
    const body = (await response.json()) as { data: SkillMeta };
    return body.data;
}

/**
 * Fetch one side file's content
 * GET /api/skills/:id/files/:path（path 经 encodeURIComponent，'/' 编码为 %2F）
 */
export async function getSkillFile(
    id: string,
    path: string,
): Promise<{ path: string; content: string }> {
    const response = await enhancedFetch<{ data: { path: string; content: string } }>(
        `/api/skills/${id}/files/${encodeURIComponent(path)}`,
        { method: 'GET', timeout: 30000 },
    );
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
export async function testMcp(id: string): Promise<{
    success: boolean;
    created: number;
    updated: number;
    disabled: number;
    tools: Tool[];
}> {
    const response = await enhancedFetch<{
        data: {
            success: boolean;
            created: number;
            updated: number;
            disabled: number;
            tools: Tool[];
        };
    }>(`/api/mcps/${id}/test`, {
        method: 'POST',
        timeout: 60000,
    });
    return response.data;
}

/**
 * Test an MCP config WITHOUT persisting — form-internal connectivity check.
 * POST /api/mcps/test-config
 *
 * Unlike `testMcp(id)`, this does not save the MCP first; it connects to the
 * server described by `config`, lists tools, and disconnects. Used by the
 * JSON config form's "测试连通" button.
 */
export async function testMcpConfig(
    config: McpConfig,
): Promise<TestMcpConfigResult> {
    const response = await enhancedFetch<{
        data: TestMcpConfigResult;
    }>('/api/mcps/test-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config }),
        // stdio spawn + initialize handshake can take a while; allow headroom
        // beyond the server's 30s internal timeout.
        timeout: 45000,
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

// ─── Run Trace APIs ───

/** 列表项：Run 轨迹记录 + 该 Run 的步骤计数（GET /api/sessions/:id/runs）。 */
export type RunTraceWithStepCount = RunTraceRecord & { stepCount: number };

/** 单条 Run 详情：Run 记录 + 全部步骤（GET /api/runs/:runId）。 */
export interface RunTraceDetail {
    run: RunTraceRecord;
    steps: RunStepRecord[];
}

/**
 * Fetch the run traces of a session (started_at desc, each with stepCount)
 * GET /api/sessions/:id/runs
 */
export async function fetchSessionRuns(sessionId: string): Promise<RunTraceWithStepCount[]> {
    const response = await enhancedFetch<{ data: RunTraceWithStepCount[] }>(
        `/api/sessions/${sessionId}/runs`,
        {
            method: 'GET',
            timeout: 30000,
        }
    );
    return response.data;
}

/**
 * Fetch a single run with all of its steps
 * GET /api/runs/:runId
 */
export async function fetchRunDetail(runId: string): Promise<RunTraceDetail> {
    const response = await enhancedFetch<{ data: RunTraceDetail }>(`/api/runs/${runId}`, {
        method: 'GET',
        timeout: 30000,
    });
    return response.data;
}

// ─── Eval APIs ───

/** 场景元数据列表项：不含 script 全文与断言细节（GET /api/eval/scenarios）。 */
export interface EvalScenarioMeta {
    id: string;
    name: string;
    description: string;
    category: EvalCategory;
    mode: EvalMode;
    replayable: boolean;
}

/** 现场确定性回放结果（GET /api/eval/scenarios/:id/replay）。 */
export interface EvalReplayResult {
    runTrace: RunTraceRecord;
    steps: RunStepRecord[];
    evalRun: EvalRunResult;
}

/**
 * Fetch the frozen eval report snapshot
 * GET /api/eval/snapshot
 */
export async function fetchEvalSnapshot(): Promise<EvalSnapshot> {
    const response = await enhancedFetch<{ data: EvalSnapshot }>('/api/eval/snapshot', {
        method: 'GET',
        timeout: 30000,
    });
    return response.data;
}

/**
 * Fetch eval scenario metadata (no script bodies, no assertion details)
 * GET /api/eval/scenarios
 */
export async function fetchEvalScenarios(): Promise<EvalScenarioMeta[]> {
    const response = await enhancedFetch<{ data: EvalScenarioMeta[] }>('/api/eval/scenarios', {
        method: 'GET',
        timeout: 30000,
    });
    return response.data;
}

/**
 * Replay a deterministic eval scenario on demand (server-side subprocess)
 * GET /api/eval/scenarios/:id/replay
 */
export async function replayEvalScenario(id: string): Promise<EvalReplayResult> {
    const response = await enhancedFetch<{ data: EvalReplayResult }>(
        `/api/eval/scenarios/${encodeURIComponent(id)}/replay`,
        {
            method: 'GET',
            // 服务端回放子进程最长 60s，客户端超时须留出余量
            timeout: 90000,
        }
    );
    return response.data;
}
