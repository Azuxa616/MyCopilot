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

/** 打开某模型行的编辑弹窗。 */
async function openEditModal() {
  fireEvent.click(await screen.findByText('编辑'));
  await screen.findByText('能力');
}

describe('ProviderDetailPage 模型行（正向能力 tag 形态）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    cleanup();
  });

  it('vision=yes → 模型名下方第二行显示「视觉」tag（tooltip 含来源）', async () => {
    renderPage([
      makeModel({ capabilities: { vision: 'yes', sources: { vision: 'probe' }, probedAt: Date.now() } }),
    ]);
    const tag = await screen.findByText('视觉');
    expect(tag.getAttribute('title')).toContain('支持·探测');
  });

  it('vision=no / unknown → 行内不显示任何能力标记（只标"有什么"）', async () => {
    renderPage([
      makeModel({ capabilities: { vision: 'no', sources: { vision: 'probe' } } }),
      makeModel({ id: 'm2', name: 'other-model' }),
    ]);
    await screen.findByText('deepseek-flash');
    expect(screen.queryByText('视觉')).toBeNull();
    expect(screen.queryByText(/^图片 /)).toBeNull();
  });

  it('行内不再有探测按钮与能力下拉（收进编辑弹窗）', async () => {
    renderPage([makeModel()]);
    await screen.findByText('deepseek-flash');
    expect(screen.queryByText('测试图片输入')).toBeNull();
    expect(screen.queryByLabelText('deepseek-flash 图片输入能力')).toBeNull();
  });
});

describe('编辑弹窗内的能力区块', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    cleanup();
  });

  it('探测成功 → api 调用 + onModelUpdated 驱动行内「视觉」tag 出现', async () => {
    renderPage([makeModel()]);
    await openEditModal();

    const probed = makeModel({
      capabilities: { vision: 'yes', sources: { vision: 'probe' }, probedAt: Date.now() },
    });
    vi.mocked(api.probeModelVision).mockResolvedValue({
      model: probed,
      probe: { method: 'chat', vision: 'yes', source: 'probe' },
    });

    fireEvent.click(screen.getByText('测试图片输入'));

    await waitFor(() => {
      expect(api.probeModelVision).toHaveBeenCalledWith('m1');
      expect(screen.getByText('视觉')).toBeTruthy();
    });
    expect(showMessageAlert.success).toHaveBeenCalledWith('探测成功：该模型支持图片输入');
  });

  it('探测 locked=true → 提示手动锁定', async () => {
    renderPage([
      makeModel({ capabilities: { vision: 'no', sources: { vision: 'manual' } } }),
    ]);
    await openEditModal();
    vi.mocked(api.probeModelVision).mockResolvedValue({
      model: makeModel({ capabilities: { vision: 'no', sources: { vision: 'manual' } } }),
      probe: { method: 'skipped', vision: 'no', source: 'manual', locked: true },
    });

    fireEvent.click(screen.getByText('测试图片输入'));

    await waitFor(() => {
      expect(showMessageAlert.error).toHaveBeenCalledWith(expect.stringContaining('手动锁定'));
    });
  });

  it('弹窗内选「支持」→ api.setModelVision 写手动锁并刷新 tag', async () => {
    renderPage([makeModel()]);
    await openEditModal();
    vi.mocked(api.setModelVision).mockResolvedValue(
      makeModel({ capabilities: { vision: 'yes', sources: { vision: 'manual' } } }),
    );

    const select = screen.getByLabelText('deepseek-flash 图片输入能力');
    fireEvent.change(select, { target: { value: 'yes' } });

    await waitFor(() => {
      expect(api.setModelVision).toHaveBeenCalledWith('m1', 'yes');
      expect(screen.getByText('视觉')).toBeTruthy();
    });
  });

  it('弹窗内选「自动」→ 清除手动锁（null）', async () => {
    renderPage([
      makeModel({ capabilities: { vision: 'no', sources: { vision: 'manual' } } }),
    ]);
    await openEditModal();
    vi.mocked(api.setModelVision).mockResolvedValue(makeModel());

    const select = screen.getByLabelText('deepseek-flash 图片输入能力');
    fireEvent.change(select, { target: { value: 'unknown' } });

    await waitFor(() => {
      expect(api.setModelVision).toHaveBeenCalledWith('m1', null);
      expect(screen.queryByText('视觉')).toBeNull();
    });
  });
});
