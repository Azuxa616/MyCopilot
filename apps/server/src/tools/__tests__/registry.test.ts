import { describe, it, expect, beforeEach } from 'vitest';
import type { Tool } from '@my-copilot/shared';
import {
  registerTool,
  getToolExecutor,
  listRegisteredTools,
  clearRegisteredTools,
  type ToolExecutor,
} from '../registry.js';

function makeExecutor(name: string): ToolExecutor {
  return {
    execute: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
    describe: (): Tool => ({
      id: `builtin-${name}`,
      name,
      description: `test tool ${name}`,
      inputSchema: { fields: [] },
      type: 'built-in',
      safetyLevel: 'safe',
      sourceMcpId: null,
      policyVersion: `builtin:${name}:v1`,
      enabled: true,
      createdAt: 0,
      updatedAt: 0,
    }),
  };
}

describe('tool registry advertised 开关', () => {
  beforeEach(() => {
    clearRegisteredTools();
  });

  it('默认注册的工具进入 listRegisteredTools 广告列表', () => {
    const executor = makeExecutor('t1');
    registerTool('t1', executor);
    expect(listRegisteredTools().map((t) => t.name)).toEqual(['t1']);
    expect(getToolExecutor('t1')).toBe(executor);
  });

  it('advertised:false 的工具可执行但不进常驻广告列表（read_session 条件注册机制）', () => {
    const executor = makeExecutor('t2');
    registerTool('t2', executor, { advertised: false });
    expect(listRegisteredTools()).toEqual([]);
    expect(getToolExecutor('t2')).toBe(executor);
  });

  it('重名注册仍然抛错（既有行为不回归）', () => {
    registerTool('t1', makeExecutor('t1'));
    expect(() => registerTool('t1', makeExecutor('t1'))).toThrow(/already registered/);
  });
});
