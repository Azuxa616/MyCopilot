// MCP 域 API：MCP 服务器 CRUD 与连通测试

import type { Tool, Mcp, CreateMcpParams, UpdateMcpParams, McpConfig, TestMcpConfigResult } from '@my-copilot/shared';
import { enhancedFetch } from '../request';

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
