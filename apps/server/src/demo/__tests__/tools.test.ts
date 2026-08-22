// apps/server/src/demo/__tests__/tools.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { filterDemoTools, DEMO_ALLOWED_TOOLS } from '../tools.js';
import type { Tool } from '@my-copilot/shared';

function builtinTool(name: string): Tool {
  return {
    id: `t-${name}`,
    name,
    description: '',
    inputSchema: { fields: [] },
    type: 'built-in',
    safetyLevel: 'safe',
    sourceMcpId: null,
    policyVersion: 'v1',
    enabled: true,
    createdAt: 0,
    updatedAt: 0,
  };
}

function mcpTool(name: string): Tool {
  return { ...builtinTool(name), type: 'mcp-provided', safetyLevel: 'restricted', sourceMcpId: 'm1' };
}

afterEach(() => {
  delete process.env.DEMO_MODE;
});

describe('DEMO_ALLOWED_TOOLS', () => {
  it('contains only non-network safe built-ins', () => {
    expect(DEMO_ALLOWED_TOOLS.has('calculator')).toBe(true);
    expect(DEMO_ALLOWED_TOOLS.has('current_datetime')).toBe(true);
    expect(DEMO_ALLOWED_TOOLS.has('http_fetch')).toBe(false);
    expect(DEMO_ALLOWED_TOOLS.has('web_search')).toBe(false);
  });

  it('has exactly 7 entries (pin against accidental additions)', () => {
    expect(DEMO_ALLOWED_TOOLS.size).toBe(7);
  });
});

describe('filterDemoTools', () => {
  it('passes everything through when DEMO_MODE unset', () => {
    const tools = [builtinTool('http_fetch'), builtinTool('calculator'), mcpTool('x')];
    expect(filterDemoTools(tools)).toEqual(tools);
  });

  it('keeps only whitelisted built-ins in demo mode', () => {
    process.env.DEMO_MODE = '1';
    const tools = [
      builtinTool('calculator'),
      builtinTool('http_fetch'),
      builtinTool('web_search'),
      mcpTool('anything'),
    ];
    expect(filterDemoTools(tools)).toEqual([builtinTool('calculator')]);
  });

  it('drops all mcp-provided tools in demo mode', () => {
    process.env.DEMO_MODE = '1';
    expect(filterDemoTools([mcpTool('a'), mcpTool('b')])).toEqual([]);
  });
});
