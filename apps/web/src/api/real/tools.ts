// 工具域 API：工具查询/执行/测试、待审批确认与 ask_user 提问

import type { Tool, UpdateToolParams, QuestionAnswerEntry } from '@my-copilot/shared';
import { enhancedFetch } from '../request';

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
 * Pending approval record returned by GET /api/tools/pending（仅 state='pending'）。
 */
export interface PendingApproval {
    approvalId: string;
    toolCallId: string;
    toolName: string;
    arguments: string;
    safetyLevel: string;
    source: string;
    sourceMcpId: string | null;
    /** 到期时间戳（ms）；0 = 无超时（挂起）。 */
    expiresAt: number;
    createdAt: number;
}

/**
 * Fetch a session's pending tool approvals（含 ask_user 提问）。
 * GET /api/tools/pending?sessionId=<id>
 */
export async function fetchPendingApprovals(sessionId: string): Promise<PendingApproval[]> {
    const response = await enhancedFetch<{ data: { approvals: PendingApproval[] } }>(
        `/api/tools/pending?sessionId=${encodeURIComponent(sessionId)}`,
        {
            method: 'GET',
            timeout: 30000,
        }
    );
    return response.data.approvals;
}

/**
 * Submit a structured ask_user answer（整卡一次提交，status answered/skipped）。
 * POST /api/tools/confirm/:approvalId with `{ answer }`（既有布尔批准不受影响）。
 */
export async function submitQuestionAnswer(
    approvalId: string,
    answer: { status: 'answered' | 'skipped'; answers: QuestionAnswerEntry[] },
): Promise<{ resolved: boolean }> {
    const response = await enhancedFetch<{ data: { resolved: boolean } }>(
        `/api/tools/confirm/${encodeURIComponent(approvalId)}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ answer }),
            timeout: 30000,
        }
    );
    return response.data;
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
