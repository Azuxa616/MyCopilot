// 技能域 API：技能 CRUD、重扫描、ZIP 导入与侧文件读取

import type { SkillMeta, SkillDetail, CreateSkillParams, UpdateSkillParams } from '@my-copilot/shared';
import { enhancedFetch, fetchWithAuth } from '../request';

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
 * Fetch the effective skill set for the / command palette
 * GET /api/skills/effective
 */
export async function fetchEffectiveSkills(): Promise<SkillMeta[]> {
    const response = await enhancedFetch<{ data: SkillMeta[] }>('/api/skills/effective', {
        method: 'GET',
        timeout: 30000,
        retry: true,
        maxRetries: 2,
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
