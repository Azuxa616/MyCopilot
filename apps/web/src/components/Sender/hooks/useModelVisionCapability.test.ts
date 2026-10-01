import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { Model } from '@my-copilot/shared';
import { useModelVisionCapability } from './useModelVisionCapability';

vi.mock('../../../api', () => ({
  api: {
    probeModelVision: vi.fn(),
    setModelVision: vi.fn(),
  },
}));

import { api } from '../../../api';

function makeModel(over: Partial<Model> = {}): Model {
  return {
    id: 'm1',
    providerId: 'p1',
    name: 'deepseek-flash',
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
}

describe('useModelVisionCapability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('derives unknown for models without records', () => {
    const { result } = renderHook(() => useModelVisionCapability(makeModel()));
    expect(result.current.vision).toBe('unknown');
    expect(result.current.source).toBeUndefined();
    expect(result.current.label).toBe('未知');
  });

  it('derives state and source labels from stored capabilities', () => {
    const { result } = renderHook(() =>
      useModelVisionCapability(
        makeModel({ capabilities: { vision: 'no', sources: { vision: 'manual' } } }),
      ),
    );
    expect(result.current.vision).toBe('no');
    expect(result.current.source).toBe('manual');
    expect(result.current.label).toBe('不支持·手动');
  });

  it('probe() snapshots the server-returned model and tracks pending state', async () => {
    const { result } = renderHook(() => useModelVisionCapability(makeModel()));
    const probed = makeModel({
      capabilities: { vision: 'yes', sources: { vision: 'probe' }, probedAt: 5 },
    });
    let resolveProbe: (value: {
      model: Model;
      probe: { method: 'chat'; vision: 'yes'; source: 'probe' };
    }) => void = () => {};
    vi.mocked(api.probeModelVision).mockReturnValue(
      new Promise((resolve) => {
        resolveProbe = resolve;
      }) as ReturnType<typeof api.probeModelVision>,
    );

    let pending: Promise<unknown> | undefined;
    act(() => {
      pending = result.current.probe();
    });
    expect(result.current.isProbing).toBe(true);

    await act(async () => {
      resolveProbe({ model: probed, probe: { method: 'chat', vision: 'yes', source: 'probe' } });
      await pending;
    });

    expect(result.current.isProbing).toBe(false);
    expect(result.current.vision).toBe('yes');
    expect(result.current.source).toBe('probe');
    expect(result.current.label).toBe('支持·探测');
  });

  it('setVision() snapshots the manually-set model', async () => {
    const { result } = renderHook(() => useModelVisionCapability(makeModel()));
    vi.mocked(api.setModelVision).mockResolvedValue(
      makeModel({ capabilities: { vision: 'no', sources: { vision: 'manual' } } }),
    );

    await act(async () => {
      await result.current.setVision('no');
    });

    expect(api.setModelVision).toHaveBeenCalledWith('m1', 'no');
    expect(result.current.vision).toBe('no');
    expect(result.current.source).toBe('manual');
  });

  it('switching to another model discards the stale snapshot', async () => {
    const initial = makeModel();
    const { result, rerender } = renderHook(({ model }) => useModelVisionCapability(model), {
      initialProps: { model: initial },
    });

    // 先产生一份探测快照
    const probed = makeModel({
      capabilities: { vision: 'yes', sources: { vision: 'probe' } },
    });
    vi.mocked(api.probeModelVision).mockResolvedValue({
      model: probed,
      probe: { method: 'chat', vision: 'yes', source: 'probe' },
    });
    await act(async () => {
      await result.current.probe();
    });
    expect(result.current.vision).toBe('yes');

    // 切换模型（id 变化）→ 快照失效，回到新模型自身的记录
    const other = makeModel({ id: 'm2', name: 'other-model' });
    rerender({ model: other });

    expect(result.current.model?.id).toBe('m2');
    expect(result.current.vision).toBe('unknown');
  });
});
