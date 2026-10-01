import { describe, it, expect } from 'vitest';
import type { ModelCapabilities } from '@my-copilot/shared';
import { describeVisionCapability, VISION_SOURCE_LABELS, VISION_STATE_LABELS } from './capability';

describe('describeVisionCapability', () => {
  it('defaults to unknown with no source label', () => {
    expect(describeVisionCapability(undefined)).toEqual({ vision: 'unknown', source: undefined, label: '未知' });
    expect(describeVisionCapability({})).toEqual({ vision: 'unknown', source: undefined, label: '未知' });
  });

  it('combines state and source labels', () => {
    const caps: ModelCapabilities = { vision: 'yes', sources: { vision: 'probe' } };
    expect(describeVisionCapability(caps)).toEqual({
      vision: 'yes',
      source: 'probe',
      label: '支持·探测',
    });
  });

  it('covers every source with a Chinese label', () => {
    expect(describeVisionCapability({ vision: 'yes', sources: { vision: 'manual' } }).label).toBe('支持·手动');
    expect(describeVisionCapability({ vision: 'yes', sources: { vision: 'catalog' } }).label).toBe('支持·目录');
    expect(describeVisionCapability({ vision: 'yes', sources: { vision: 'provider' } }).label).toBe('支持·服务方');
    expect(describeVisionCapability({ vision: 'no', sources: { vision: 'probe' } }).label).toBe('不支持·探测');
  });

  it('exposes complete label maps', () => {
    expect(VISION_STATE_LABELS).toEqual({ yes: '支持', no: '不支持', unknown: '未知' });
    expect(VISION_SOURCE_LABELS).toEqual({ manual: '手动', probe: '探测', catalog: '目录', provider: '服务方' });
  });
});
