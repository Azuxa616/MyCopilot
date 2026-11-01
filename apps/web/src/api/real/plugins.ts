// 插件域 API：安装、启停、卸载、生命周期事件与前端入口

import type { PluginRecord, PluginLifecycleEvent } from '@my-copilot/shared';
import { enhancedFetch } from '../request';

// ─── Plugins API ───

/**
 * List all plugins
 * GET /api/plugins
 */
export async function fetchPlugins(): Promise<PluginRecord[]> {
    const response = await enhancedFetch<{ data: PluginRecord[] }>('/api/plugins', {
        method: 'GET',
        timeout: 30000,
        retry: true,
        maxRetries: 3,
    });
    return response.data;
}

/**
 * Install a plugin from a directory
 * POST /api/plugins/install
 */
export async function installPlugin(params: { directory: string }): Promise<PluginRecord> {
    const response = await enhancedFetch<{ data: PluginRecord }>('/api/plugins/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
        timeout: 60000,
    });
    return response.data;
}

/**
 * Enable a plugin
 * PATCH /api/plugins/:id/enable
 */
export async function enablePlugin(id: string): Promise<PluginRecord> {
    const response = await enhancedFetch<{ data: PluginRecord }>(`/api/plugins/${id}/enable`, {
        method: 'PATCH',
        timeout: 30000,
    });
    return response.data;
}

/**
 * Disable a plugin
 * PATCH /api/plugins/:id/disable
 */
export async function disablePlugin(id: string): Promise<PluginRecord> {
    const response = await enhancedFetch<{ data: PluginRecord }>(`/api/plugins/${id}/disable`, {
        method: 'PATCH',
        timeout: 30000,
    });
    return response.data;
}

/**
 * Uninstall a plugin
 * DELETE /api/plugins/:id
 */
export async function uninstallPlugin(id: string): Promise<void> {
    await enhancedFetch<{ data: unknown }>(`/api/plugins/${id}`, {
        method: 'DELETE',
        timeout: 30000,
    });
}

/**
 * Fetch lifecycle events for a plugin
 * GET /api/plugins/:id/events
 */
export async function fetchPluginEvents(id: string): Promise<PluginLifecycleEvent[]> {
    const response = await enhancedFetch<{ data: PluginLifecycleEvent[] }>(`/api/plugins/${id}/events`, {
        method: 'GET',
        timeout: 30000,
        retry: true,
        maxRetries: 3,
    });
    return response.data;
}

/**
 * Fetch a plugin's card renderer entry HTML (enabled plugins with frontendEntry only)
 * GET /api/plugins/:id/frontend
 */
export async function fetchPluginFrontend(id: string): Promise<string> {
    const response = await enhancedFetch<{ data: string }>(`/api/plugins/${id}/frontend`, {
        method: 'GET',
        timeout: 30000,
    });
    return response.data;
}

/**
 * Upload a plugin ZIP and install it
 * POST /api/plugins/upload
 */
export async function uploadPlugin(file: File): Promise<PluginRecord> {
    const form = new FormData();
    form.append('file', file);
    const response = await enhancedFetch<{ data: PluginRecord }>('/api/plugins/upload', {
        method: 'POST',
        body: form,
        timeout: 120000,
    });
    return response.data;
}
