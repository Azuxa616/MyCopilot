import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initDatabase, getDb } from '../../db/index.js';
import {
  createTool,
  getTool,
  listTools,
  listEnabledTools,
  updateTool,
  deleteTool,
} from '../tool.js';
import type { ToolInputSchema } from '@my-copilot/shared';

const sampleSchema: ToolInputSchema = {
  fields: [
    { name: 'query', type: 'string', description: 'Search query', required: true },
  ],
};

describe('ToolRepo', () => {
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

  it('createTool → getTool → verify fields', () => {
    const tool = createTool({
      name: 'search',
      description: 'Web search tool',
      inputSchema: sampleSchema,
      type: 'built-in',
      safetyLevel: 'safe',
      enabled: true,
    });

    expect(tool.id).toBeDefined();
    expect(tool.name).toBe('search');
    expect(tool.description).toBe('Web search tool');
    expect(tool.type).toBe('built-in');
    expect(tool.safetyLevel).toBe('safe');
    expect(tool.enabled).toBe(true);
    expect(tool.createdAt).toBeDefined();
    expect(tool.updatedAt).toBeDefined();

    const fetched = getTool(tool.id);
    expect(fetched).toEqual(tool);
  });

  it('createTool defaults enabled to true', () => {
    const tool = createTool({
      name: 't',
      description: 'd',
      inputSchema: { fields: [] },
      type: 'built-in',
      safetyLevel: 'safe',
    });
    expect(tool.enabled).toBe(true);
  });

  it('updateTool updates only provided fields', () => {
    const tool = createTool({
      name: 'Original',
      description: 'desc',
      inputSchema: sampleSchema,
      type: 'built-in',
      safetyLevel: 'safe',
    });

    const updated = updateTool(tool.id, { name: 'Updated', enabled: false });
    expect(updated).toBeDefined();
    expect(updated!.name).toBe('Updated');
    expect(updated!.description).toBe('desc');
    expect(updated!.enabled).toBe(false);
    expect(updated!.type).toBe('built-in');

    const fetched = getTool(tool.id);
    expect(fetched!.name).toBe('Updated');
    expect(fetched!.enabled).toBe(false);
  });

  it('updateTool returns undefined when not found', () => {
    const result = updateTool('nonexistent', { name: 'x' });
    expect(result).toBeUndefined();
  });

  it('deleteTool → getTool undefined', () => {
    const tool = createTool({
      name: 't',
      description: 'd',
      inputSchema: { fields: [] },
      type: 'built-in',
      safetyLevel: 'safe',
    });

    const deleted = deleteTool(tool.id);
    expect(deleted).toBe(true);
    expect(getTool(tool.id)).toBeUndefined();
  });

  it('deleteTool returns false when not found', () => {
    expect(deleteTool('nonexistent')).toBe(false);
  });

  it('listTools returns all tools', () => {
    const t1 = createTool({
      name: 'First',
      description: 'd',
      inputSchema: { fields: [] },
      type: 'built-in',
      safetyLevel: 'safe',
    });
    const t2 = createTool({
      name: 'Second',
      description: 'd',
      inputSchema: { fields: [] },
      type: 'built-in',
      safetyLevel: 'safe',
    });

    const list = listTools();
    expect(list).toHaveLength(2);
    const ids = list.map((t) => t.id);
    expect(ids).toContain(t1.id);
    expect(ids).toContain(t2.id);
  });

  it('listEnabledTools returns only enabled tools', () => {
    createTool({
      name: 'Enabled1',
      description: 'd',
      inputSchema: { fields: [] },
      type: 'built-in',
      safetyLevel: 'safe',
      enabled: true,
    });
    createTool({
      name: 'Disabled',
      description: 'd',
      inputSchema: { fields: [] },
      type: 'built-in',
      safetyLevel: 'safe',
      enabled: false,
    });

    const list = listEnabledTools();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('Enabled1');
  });

  it('inputSchema round-trips through JSON serialization', () => {
    const complexSchema: ToolInputSchema = {
      fields: [
        { name: 'a', type: 'string', description: 'param a', required: true },
        { name: 'b', type: 'number', description: 'param b', required: false },
        { name: 'c', type: 'object', description: 'param c', required: true },
      ],
    };
    const tool = createTool({
      name: 'complex',
      description: 'd',
      inputSchema: complexSchema,
      type: 'built-in',
      safetyLevel: 'restricted',
    });

    const fetched = getTool(tool.id);
    expect(fetched!.inputSchema).toEqual(complexSchema);
  });
});
