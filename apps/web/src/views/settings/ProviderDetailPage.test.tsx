import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { Model, Provider } from '@my-copilot/shared';
import { ProviderDetailPage } from './ProviderDetailPage';

vi.mock('../../api', () => ({
  api: {
    fetchProvider: vi.fn(),
    fetchModelsByProvider: vi.fn(),
    createModel: vi.fn(),
    updateModel: vi.fn(),
    deleteModel: vi.fn(),
    probeModelVision: vi.fn(),
    setModelVision: vi.fn(),
  },
}));
vi.mock('../../components/common/Alert/alertUtils', () => ({
  showMessageAlert: { success: vi.fn(), error: vi.fn() },
}));

import { api } from '../../api';
import { showMessageAlert } from '../../components/common/Alert/alertUtils';

const provider: Provider = {
  id: 'p1',
  name: 'DeepSeek',
  type: 'openai',
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: 'sk-x',
  enabled: true,
  createdAt: 1,
  updatedAt: 1,
};

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

function renderPage(models: Model[]) {
  vi.mocked(api.fetchProvider).mockResolvedValue(provider);
  vi.mocked(api.fetchModelsByProvider).mockResolvedValue(models);
  return render(
    <MemoryRouter initialEntries={['/providers/p1']}>
      <Routes>
        <Route path="/providers/:id" element={<ProviderDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ProviderDetailPage vision capability UI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    cleanup();
  });

  it('renders the vision badge with state and source label', async () => {
    renderPage([
      makeModel({ capabilities: { vision: 'yes', sources: { vision: 'probe' } } }),
    ]);
    expect(await screen.findByText('图片 支持·探测')).toBeTruthy();
  });

  it('renders 未知 badge for models without capability records', async () => {
    renderPage([makeModel()]);
    expect(await screen.findByText('图片 未知')).toBeTruthy();
  });

  it('probe button calls api.probeModelVision and refreshes the row', async () => {
    renderPage([makeModel()]);
    const probed = makeModel({
      capabilities: { vision: 'yes', sources: { vision: 'probe' }, probedAt: 2 },
    });
    vi.mocked(api.probeModelVision).mockResolvedValue({
      model: probed,
      probe: { method: 'chat', vision: 'yes', source: 'probe' },
    });

    fireEvent.click(await screen.findByText('测试图片输入'));

    await waitFor(() => {
      expect(api.probeModelVision).toHaveBeenCalledWith('m1');
      expect(screen.getByText('图片 支持·探测')).toBeTruthy();
    });
    expect(showMessageAlert.success).toHaveBeenCalledWith('探测成功：该模型支持图片输入');
  });

  it('probe result locked=true explains the manual lock', async () => {
    renderPage([
      makeModel({ capabilities: { vision: 'no', sources: { vision: 'manual' } } }),
    ]);
    vi.mocked(api.probeModelVision).mockResolvedValue({
      model: makeModel({ capabilities: { vision: 'no', sources: { vision: 'manual' } } }),
      probe: { method: 'skipped', vision: 'no', source: 'manual', locked: true },
    });

    fireEvent.click(await screen.findByText('测试图片输入'));

    await waitFor(() => {
      expect(showMessageAlert.error).toHaveBeenCalledWith(
        expect.stringContaining('手动锁定'),
      );
    });
  });

  it('selecting 支持 writes manual capability via api.setModelVision', async () => {
    renderPage([makeModel()]);
    vi.mocked(api.setModelVision).mockResolvedValue(
      makeModel({ capabilities: { vision: 'yes', sources: { vision: 'manual' } } }),
    );

    const select = await screen.findByLabelText('deepseek-flash 图片输入能力');
    fireEvent.change(select, { target: { value: 'yes' } });

    await waitFor(() => {
      expect(api.setModelVision).toHaveBeenCalledWith('m1', 'yes');
      expect(screen.getByText('图片 支持·手动')).toBeTruthy();
    });
  });

  it('selecting 未知 clears the manual lock (null)', async () => {
    renderPage([
      makeModel({ capabilities: { vision: 'no', sources: { vision: 'manual' } } }),
    ]);
    vi.mocked(api.setModelVision).mockResolvedValue(makeModel());

    const select = await screen.findByLabelText('deepseek-flash 图片输入能力');
    fireEvent.change(select, { target: { value: 'unknown' } });

    await waitFor(() => {
      expect(api.setModelVision).toHaveBeenCalledWith('m1', null);
      expect(screen.getByText('图片 未知')).toBeTruthy();
    });
  });
});
