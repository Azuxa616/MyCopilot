import { describe, it, expect } from 'vitest';
import type { ToolType, DangerLevel, ToolInputSchemaField, ToolInputSchema, Tool } from '../tool.js';

describe('Tool types', () => {
  it('ToolType should be built-in or mcp-provided', () => {
    const builtIn: ToolType = 'built-in';
    const mcp: ToolType = 'mcp-provided';
    expect(builtIn).toBe('built-in');
    expect(mcp).toBe('mcp-provided');
  });

  it('DangerLevel should be low, medium, or high', () => {
    const low: DangerLevel = 'low';
    const medium: DangerLevel = 'medium';
    const high: DangerLevel = 'high';
    expect(low).toBe('low');
    expect(medium).toBe('medium');
    expect(high).toBe('high');
  });

  it('should create a valid ToolInputSchemaField', () => {
    const field: ToolInputSchemaField = {
      name: 'query',
      type: 'string',
      description: 'Search query',
      required: true,
    };
    expect(field.name).toBe('query');
    expect(field.required).toBe(true);
  });

  it('should create a valid ToolInputSchema', () => {
    const schema: ToolInputSchema = {
      fields: [
        { name: 'query', type: 'string', description: 'Search query', required: true },
      ],
    };
    expect(schema.fields).toHaveLength(1);
  });

  it('should create a valid Tool object', () => {
    const tool: Tool = {
      id: 'tool-1',
      name: 'web_search',
      description: 'Search the web',
      inputSchema: { fields: [] },
      type: 'built-in',
      dangerLevel: 'low',
      enabled: true,
      createdAt: 1000,
      updatedAt: 1000,
    };
    expect(tool.name).toBe('web_search');
    expect(tool.type).toBe('built-in');
  });
});
