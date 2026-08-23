import { describe, it, expect } from 'vitest';
import type {
  McpTransport,
  McpConfig,
  Mcp,
  TestMcpConfigParams,
  TestMcpConfigResult,
} from '../mcp.js';

describe('MCP types', () => {
  it('McpTransport should be stdio, sse, or http', () => {
    const stdio: McpTransport = 'stdio';
    const sse: McpTransport = 'sse';
    const http: McpTransport = 'http';
    expect(stdio).toBe('stdio');
    expect(sse).toBe('sse');
    expect(http).toBe('http');
  });

  it('should create a valid McpConfig with stdio transport', () => {
    const config: McpConfig = {
      transport: 'stdio',
      command: 'node',
      args: ['server.js'],
    };
    expect(config.transport).toBe('stdio');
    expect(config.command).toBe('node');
  });

  it('should create a valid McpConfig with sse transport', () => {
    const config: McpConfig = {
      transport: 'sse',
      url: 'https://example.com/sse',
    };
    expect(config.url).toBe('https://example.com/sse');
  });

  it('should create a valid Mcp object', () => {
    const mcp: Mcp = {
      id: 'mcp-1',
      name: 'Filesystem',
      description: 'Filesystem access',
      config: {
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem'],
      },
      enabled: true,
      createdAt: 1000,
      updatedAt: 1000,
    };
    expect(mcp.name).toBe('Filesystem');
    expect(mcp.config.transport).toBe('stdio');
  });

  it('TestMcpConfigParams carries a McpConfig', () => {
    const params: TestMcpConfigParams = {
      config: { transport: 'stdio', command: 'npx' },
    };
    expect(params.config.transport).toBe('stdio');
  });

  it('TestMcpConfigResult success shape with tool names', () => {
    const ok: TestMcpConfigResult = {
      success: true,
      tools: ['browser_navigate', 'browser_click'],
    };
    expect(ok.success).toBe(true);
    expect(ok.tools).toHaveLength(2);
  });

  it('TestMcpConfigResult failure shape with error', () => {
    const fail: TestMcpConfigResult = {
      success: false,
      error: 'connection refused',
    };
    expect(fail.success).toBe(false);
    expect(fail.error).toBe('connection refused');
  });
});
