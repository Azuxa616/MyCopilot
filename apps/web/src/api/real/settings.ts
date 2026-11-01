// 设置域 API：ask_user 等待超时设置

import { enhancedFetch } from '../request';

/**
 * Fetch the ask_user wait timeout setting（null = 不超时）。
 * GET /api/settings/ask-user
 */
export async function fetchAskUserSettings(): Promise<{ timeoutMs: number | null }> {
    const response = await enhancedFetch<{ data: { timeoutMs: number | null } }>(
        '/api/settings/ask-user',
        {
            method: 'GET',
            timeout: 30000,
        }
    );
    return response.data;
}

/**
 * Save the ask_user wait timeout setting（null/0 = 关闭超时）。
 * PUT /api/settings/ask-user
 */
export async function saveAskUserSettings(timeoutMs: number | null): Promise<{ timeoutMs: number | null }> {
    const response = await enhancedFetch<{ data: { timeoutMs: number | null } }>(
        '/api/settings/ask-user',
        {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ timeoutMs }),
            timeout: 30000,
        }
    );
    return response.data;
}
