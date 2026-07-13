import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Tool } from '@my-copilot/shared';
import { getDb, initDatabase } from '../../db/index.js';
import { syncMcpTools, updateTool } from '../tool.js';

function discoveredTool(name: string, description: string): Tool {
  return {
    id: `discovered-${name}`,
    name,
    description,
    inputSchema: { fields: [] },
    type: 'mcp-provided',
    safetyLevel: 'restricted',
    sourceMcpId: 'mcp-1',
    policyVersion: `remote:${name}`,
    enabled: true,
    createdAt: 0,
    updatedAt: 0,
  };
}

describe('syncMcpTools', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'my-copilot-tool-sync-'));
    initDatabase(testDir);
  });

  afterEach(() => {
    getDb().close();
    rmSync(testDir, { recursive: true, force: true });
  });

  it('creates, updates, and disables tools for one MCP source', () => {
    const first = syncMcpTools('mcp-1', [
      discoveredTool('clock', 'first'),
      discoveredTool('weather', 'weather'),
    ]);
    expect(first).toMatchObject({ created: 2, updated: 0, disabled: 0 });
    expect(first.tools.every((tool) => tool.safetyLevel === 'restricted')).toBe(true);

    const second = syncMcpTools('mcp-1', [discoveredTool('clock', 'updated')]);
    expect(second).toMatchObject({ created: 0, updated: 1, disabled: 1 });
    expect(second.tools.find((tool) => tool.name === 'clock')).toMatchObject({
      description: 'updated',
      enabled: true,
    });
    expect(second.tools.find((tool) => tool.name === 'weather')?.enabled).toBe(false);

    const third = syncMcpTools('mcp-1', [
      discoveredTool('clock', 'updated again'),
      discoveredTool('weather', 'returned'),
    ]);
    expect(third.tools.find((tool) => tool.name === 'weather')?.enabled).toBe(false);
  });

  it('preserves a danger override during resynchronization', () => {
    const initial = syncMcpTools('mcp-1', [discoveredTool('delete', 'delete')]);
    const tool = initial.tools[0]!;
    updateTool(tool.id, { safetyLevel: 'danger' });

    const next = syncMcpTools('mcp-1', [discoveredTool('delete', 'updated')]);
    expect(next.tools[0]?.safetyLevel).toBe('danger');
  });
});
