// 附件资产域 API：资产上传与列表

import type { Asset } from '@my-copilot/shared';
import { enhancedFetch, fetchWithAuth } from '../request';

// ─── Assets API（附件资产层） ───

/**
 * Upload a file as a persistent asset.
 * POST /api/assets (multipart/form-data)
 */
export async function uploadAsset(file: File): Promise<Asset> {
    const formData = new FormData();
    formData.append('file', file);
    const response = await fetchWithAuth('/api/assets', {
        method: 'POST',
        body: formData,
    });
    if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { msg?: string } | null;
        throw new Error(body?.msg ?? `上传失败（HTTP ${response.status}）`);
    }
    const body = (await response.json()) as { data: Asset };
    return body.data;
}

/**
 * List recent assets (candidate source for @file picker & asset library).
 * GET /api/assets?name=&limit=
 */
export async function fetchAssets(params?: {
    name?: string;
    limit?: number;
}): Promise<Asset[]> {
    const search = new URLSearchParams();
    if (params?.name) search.set('name', params.name);
    if (params?.limit) search.set('limit', String(params.limit));
    const qs = search.toString();
    const response = await enhancedFetch<{ data: Asset[] }>(
        `/api/assets${qs ? `?${qs}` : ''}`,
        { method: 'GET', timeout: 30000, retry: true, maxRetries: 2 },
    );
    return response.data;
}
