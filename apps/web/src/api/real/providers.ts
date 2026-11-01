// 提供商与模型域 API：provider/model CRUD、连通测试与视觉能力管理

import type { Provider, CreateProviderParams, Model, CreateModelParams, ProbeVisionResponse } from '@my-copilot/shared';
import { enhancedFetch } from '../request';

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

/**
 * Probe model vision capability with a tiny real image request
 * POST /api/models/:id/probe-vision
 *
 * 服务端探测超时 20s，客户端放宽到 45s 容纳排队与代理。
 */
export async function probeModelVision(id: string): Promise<ProbeVisionResponse> {
    const response = await enhancedFetch<{ data: ProbeVisionResponse }>(`/api/models/${id}/probe-vision`, {
        method: 'POST',
        timeout: 45000,
    });
    return response.data;
}

/**
 * Manually set / clear model vision capability (writes the source=manual lock)
 * PATCH /api/models/:id/capabilities — vision: 'yes' | 'no' | null（null = 清除，回到 unknown）
 */
export async function setModelVision(id: string, vision: 'yes' | 'no' | null): Promise<Model> {
    const response = await enhancedFetch<{ data: Model }>(`/api/models/${id}/capabilities`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vision }),
        timeout: 30000,
    });
    return response.data;
}
