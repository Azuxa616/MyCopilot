import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initDatabase, getDb } from '../../db/index.js';
import {
  createMcp,
  getMcp,
  getMcpById,
  listMcps,
  listEnabledMcps,
  updateMcp,
  deleteMcp,
} from '../mcp.js';
import type { CreateMcpParams } from '@my-copilot/shared';

describe('McpRepo', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'my-copilot-test-'));
    initDatabase(testDir);
  });

  afterEach(() => {
    try {
      getDb().close();
    } catch {
      // ignore
    }
    if (testDir) {
      try {
        rmSync(testDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  });

  const stdioParams: CreateMcpParams = {
    name: 'filesystem',
    description: 'Local filesystem MCP',
    config: {
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
      env: { NODE_ENV: 'production' },
    },
    enabled: true,
  };

  it('createMcp -> getMcp round-trips stdio config', () => {
    const mcp = createMcp(stdioParams);

    expect(mcp.id).toBeDefined();
    expect(mcp.name).toBe('filesystem');
    expect(mcp.description).toBe('Local filesystem MCP');
    expect(mcp.config.transport).toBe('stdio');
    expect(mcp.config.command).toBe('npx');
    expect(mcp.config.args).toEqual(['-y', '@modelcontextprotocol/server-filesystem', '/tmp']);
    expect(mcp.config.env).toEqual({ NODE_ENV: 'production' });
    expect(mcp.enabled).toBe(true);
    expect(mcp.lastConnectedAt).toBeUndefined();
    expect(mcp.createdAt).toBeDefined();
    expect(mcp.updatedAt).toBe(mcp.createdAt);

    const fetched = getMcp(mcp.id);
    expect(fetched).toEqual(mcp);
  });

  it('createMcp with http transport stores url without command', () => {
    const mcp = createMcp({
      name: 'remote',
      description: 'Remote HTTP MCP',
      config: { transport: 'http', url: 'https://example.com/mcp' },
    });

    expect(mcp.config.transport).toBe('http');
    expect(mcp.config.url).toBe('https://example.com/mcp');
    expect(mcp.config.command).toBeUndefined();
    expect(mcp.config.args).toBeUndefined();

    const fetched = getMcp(mcp.id);
    expect(fetched).toEqual(mcp);
  });

  it('createMcp defaults enabled to true', () => {
    const mcp = createMcp({
      name: 'default-on',
      description: 'd',
      config: { transport: 'stdio', command: 'run' },
    });
    expect(mcp.enabled).toBe(true);
  });

  it('updateMcp updates only provided fields and preserves config when omitted', () => {
    const mcp = createMcp(stdioParams);

    const updated = updateMcp(mcp.id, { name: 'renamed', enabled: false });
    expect(updated).toBeDefined();
    expect(updated!.name).toBe('renamed');
    expect(updated!.enabled).toBe(false);
    expect(updated!.description).toBe(stdioParams.description);
    expect(updated!.config).toEqual(stdioParams.config);
    expect(updated!.createdAt).toBe(mcp.createdAt);
    expect(updated!.updatedAt).toBeGreaterThanOrEqual(mcp.updatedAt);
  });

  it('updateMcp replaces whole config object when provided', () => {
    const mcp = createMcp(stdioParams);

    const updated = updateMcp(mcp.id, {
      config: { transport: 'sse', url: 'https://example.com/sse' },
    });
    expect(updated).toBeDefined();
    expect(updated!.config.transport).toBe('sse');
    expect(updated!.config.url).toBe('https://example.com/sse');
    expect(updated!.config.command).toBeUndefined();
  });

  it('updateMcp does not touch last_connected_at', () => {
    const mcp = createMcp(stdioParams);
    const updated = updateMcp(mcp.id, { name: 'still-no-connect' });
    expect(updated).toBeDefined();
    expect(updated!.lastConnectedAt).toBeUndefined();
  });

  it('updateMcp returns undefined for unknown id', () => {
    expect(updateMcp('does-not-exist', { name: 'x' })).toBeUndefined();
  });

  it('getMcpById is an alias for getMcp', () => {
    const mcp = createMcp(stdioParams);
    expect(getMcpById(mcp.id)).toEqual(getMcp(mcp.id));
    expect(getMcpById('missing')).toBeUndefined();
  });

  it('listMcps returns all rows', () => {
    const m1 = createMcp(stdioParams);
    const m2 = createMcp({
      name: 'remote',
      description: 'd',
      config: { transport: 'http', url: 'https://example.com' },
    });

    const list = listMcps();
    expect(list).toHaveLength(2);
    // created_at uses ms granularity; ties make strict order non-deterministic,
    // so only assert membership (same approach as provider.test.ts).
    const ids = list.map((m) => m.id);
    expect(ids).toContain(m1.id);
    expect(ids).toContain(m2.id);
  });

  it('listMcps filters by enabled flag', () => {
    createMcp(stdioParams);
    createMcp({
      name: 'disabled',
      description: 'd',
      config: { transport: 'stdio', command: 'run' },
      enabled: false,
    });

    expect(listMcps()).toHaveLength(2);
    expect(listMcps({ enabled: true })).toHaveLength(1);
    expect(listMcps({ enabled: false })).toHaveLength(1);
    expect(listMcps({ enabled: false })[0].name).toBe('disabled');
  });

  it('listEnabledMcps returns only enabled mcps', () => {
    createMcp(stdioParams);
    createMcp({
      name: 'disabled',
      description: 'd',
      config: { transport: 'stdio', command: 'run' },
      enabled: false,
    });

    const enabled = listEnabledMcps();
    expect(enabled).toHaveLength(1);
    expect(enabled[0].name).toBe('filesystem');
  });

  it('deleteMcp removes the row and returns true', () => {
    const mcp = createMcp(stdioParams);
    expect(deleteMcp(mcp.id)).toBe(true);
    expect(getMcp(mcp.id)).toBeUndefined();
  });

  it('deleteMcp returns false for unknown id', () => {
    expect(deleteMcp('nope')).toBe(false);
  });
});
