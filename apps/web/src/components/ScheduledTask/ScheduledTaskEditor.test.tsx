import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Model, SessionSummary, SkillMeta } from '@my-copilot/shared';
import { ScheduledTaskEditor } from './ScheduledTaskEditor';
import { api } from '../../api';

vi.mock('../../api', () => ({ api: { previewScheduledTask: vi.fn() } }));

const sessions: SessionSummary[] = [
  { id: 'session-1', title: '原对话', modelId: 'model-1', messageCount: 2, createdAt: 1, updatedAt: 2 },
];
const models: Model[] = [{ id: 'model-1', providerId: 'provider-1', name: 'gpt-test', enabled: true, createdAt: 1, updatedAt: 1 }];
const skills: SkillMeta[] = [{ id: 'skill-1', name: '日报', description: '', enabled: true, createdAt: 1, updatedAt: 1 }];

describe('ScheduledTaskEditor', () => {
  afterEach(cleanup);
  it('Session 下拉框提供新对话和已有对话，并提交所选目标', async () => {
    const onSubmit = vi.fn();
    vi.mocked(api.previewScheduledTask).mockResolvedValue(Date.now() + 1000);
    render(<ScheduledTaskEditor sessions={sessions} models={models} skills={skills} onSubmit={onSubmit} />);
    const target = screen.getByLabelText('依附对话') as HTMLSelectElement;
    expect(target.options[0]?.textContent).toBe('每次运行创建新对话');
    expect(target.options[1]?.textContent).toContain('原对话');
    fireEvent.change(target, { target: { value: 'session-1' } });
    fireEvent.change(screen.getByLabelText('任务名称'), { target: { value: '每日任务' } });
    fireEvent.change(screen.getByLabelText('执行指令'), { target: { value: '生成摘要' } });
    fireEvent.click(screen.getByRole('button', { name: '创建任务' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ targetType: 'existing_session', targetSessionId: 'session-1' }));
    expect(await screen.findByText(/下次执行：/)).toBeTruthy();
  });
});

describe('ScheduledTaskEditor async options', () => {
  afterEach(cleanup);
  it('模型列表后加载时自动选择首个启用模型', async () => {
    const onSubmit = vi.fn();
    vi.mocked(api.previewScheduledTask).mockResolvedValue(Date.now() + 1000);
    const view = render(<ScheduledTaskEditor sessions={sessions} models={[]} skills={skills} onSubmit={onSubmit} />);
    view.rerender(<ScheduledTaskEditor sessions={sessions} models={models} skills={skills} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText('任务名称'), { target: { value: '任务' } });
    fireEvent.change(screen.getByLabelText('执行指令'), { target: { value: '执行' } });
    fireEvent.click(screen.getByRole('button', { name: '创建任务' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ modelId: 'model-1' }));
  });
});
