// 后台任务域 API：任务列表、查询与取消

import { enhancedFetch } from '../request';

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
