import { describe, expect, it } from 'vitest';
import { builtinExecutors } from '../index.js';

describe('builtinExecutors', () => {
  it('contains nine uniquely named executors with unique descriptors', () => {
    const names = builtinExecutors.map(({ name }) => name);
    const descriptors = builtinExecutors.map(({ executor }) => executor.describe());
    const ids = descriptors.map(({ id }) => id);

    expect(names).toHaveLength(9);
    expect(new Set(names).size).toBe(names.length);
    expect(new Set(ids).size).toBe(ids.length);
    expect(descriptors.map(({ name }) => name)).toEqual(names);
  });

  it('marks every new local executor as a safe code-owned built-in', () => {
    for (const { executor } of builtinExecutors.slice(2)) {
      expect(executor.describe()).toMatchObject({
        type: 'built-in',
        safetyLevel: 'safe',
        sourceMcpId: null,
        enabled: true,
      });
      expect(executor.describe().policyVersion).toMatch(/^builtin:.+:v1$/);
    }
  });
});
