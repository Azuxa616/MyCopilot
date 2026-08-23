import { describe, expect, it } from 'vitest';
import { builtinExecutors } from '../index.js';

describe('builtinExecutors', () => {
  it('contains twelve uniquely named executors with unique descriptors', () => {
    const names = builtinExecutors.map(({ name }) => name);
    const descriptors = builtinExecutors.map(({ executor }) => executor.describe());
    const ids = descriptors.map(({ id }) => id);

    expect(names).toHaveLength(12);
    expect(new Set(names).size).toBe(names.length);
    expect(new Set(ids).size).toBe(ids.length);
    expect(descriptors.map(({ name }) => name)).toEqual(names);
  });

  it('marks local executors as safe code-owned built-ins; network/install tools as restricted', () => {
    // restricted 白名单：http_fetch（外网获取）与 install_skill（持久化
    // prompt 注入必须过审批流，设计决策）
    const RESTRICTED = new Set(['http_fetch', 'install_skill']);
    for (const { name, executor } of builtinExecutors) {
      const tool = executor.describe();
      expect(tool).toMatchObject({
        type: 'built-in',
        sourceMcpId: null,
        enabled: true,
      });
      expect(tool.policyVersion).toMatch(/^builtin:.+:v1$/);
      expect(tool.safetyLevel).toBe(RESTRICTED.has(name) ? 'restricted' : 'safe');
    }
  });
});
