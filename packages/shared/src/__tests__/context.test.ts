import { describe, it, expect } from 'vitest';
import { DEFAULT_BUDGET_CONFIG } from '../context.js';

describe('DEFAULT_BUDGET_CONFIG', () => {
  it('六个桶的百分比之和必须恰好等于 1.0', () => {
    const sum =
      DEFAULT_BUDGET_CONFIG.systemPct! +
      DEFAULT_BUDGET_CONFIG.toolsPct! +
      DEFAULT_BUDGET_CONFIG.historyPct! +
      DEFAULT_BUDGET_CONFIG.toolOutputsPct! +
      DEFAULT_BUDGET_CONFIG.workingPct! +
      DEFAULT_BUDGET_CONFIG.headroomPct!;
    expect(sum).toBe(1);
  });

  it('每个桶的取值都落在 RFC §1 规定的区间内', () => {
    expect(DEFAULT_BUDGET_CONFIG.systemPct).toBeGreaterThanOrEqual(0.05);
    expect(DEFAULT_BUDGET_CONFIG.systemPct).toBeLessThanOrEqual(0.1);
    expect(DEFAULT_BUDGET_CONFIG.toolsPct).toBeGreaterThanOrEqual(0.1);
    expect(DEFAULT_BUDGET_CONFIG.toolsPct).toBeLessThanOrEqual(0.2);
    expect(DEFAULT_BUDGET_CONFIG.historyPct).toBeGreaterThanOrEqual(0.3);
    expect(DEFAULT_BUDGET_CONFIG.historyPct).toBeLessThanOrEqual(0.4);
    expect(DEFAULT_BUDGET_CONFIG.toolOutputsPct).toBeGreaterThanOrEqual(0.25);
    expect(DEFAULT_BUDGET_CONFIG.toolOutputsPct).toBeLessThanOrEqual(0.35);
    expect(DEFAULT_BUDGET_CONFIG.workingPct).toBeGreaterThanOrEqual(0.1);
    expect(DEFAULT_BUDGET_CONFIG.workingPct).toBeLessThanOrEqual(0.15);
    expect(DEFAULT_BUDGET_CONFIG.headroomPct).toBeGreaterThanOrEqual(0.05);
    expect(DEFAULT_BUDGET_CONFIG.headroomPct).toBeLessThanOrEqual(0.1);
  });
});
