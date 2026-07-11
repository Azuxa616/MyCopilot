import { describe, it, expect } from 'vitest';
import type { ToolType, SafetyLevel, ToolInputSchemaField, ToolInputSchema, Tool } from '../tool.js';

describe('Tool types', () => {
  it('ToolType should be built-in or mcp-provided', () => {
    const builtIn: ToolType = 'built-in';
    const mcp: ToolType = 'mcp-provided';
    expect(builtIn).toBe('built-in');
    expect(mcp).toBe('mcp-provided');
  });

  it('SafetyLevel should be safe, restricted, or danger', () => {
    const safe: SafetyLevel = 'safe';
    const restricted: SafetyLevel = 'restricted';
    const danger: SafetyLevel = 'danger';
    expect(safe).toBe('safe');
    expect(restricted).toBe('restricted');
    expect(danger).toBe('danger');
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
      safetyLevel: 'safe',
      enabled: true,
      createdAt: 1000,
      updatedAt: 1000,
    };
    expect(tool.name).toBe('web_search');
    expect(tool.type).toBe('built-in');
  });
});
