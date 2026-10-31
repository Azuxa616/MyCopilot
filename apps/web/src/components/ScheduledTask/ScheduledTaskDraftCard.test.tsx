import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Model, ScheduledTaskDraft, SessionSummary, SkillMeta } from '@my-copilot/shared';
import { ScheduledTaskDraftCard } from './ScheduledTaskDraftCard';
import { api } from '../../api';

vi.mock('../../api', () => ({ api: {
  confirmScheduledTaskDraft: vi.fn(), cancelScheduledTaskDraft: vi.fn(), createScheduledTask: vi.fn(), previewScheduledTask: vi.fn(),
} }));
const input = { name: '原任务', prompt: '执行', scheduleType: 'cron' as const, runAt: null, cronExpression: '0 9 * * *', timezone: 'Asia/Hong_Kong', targetType: 'existing_session' as const, targetSessionId: 'session-1', modelId: 'model-1', enforcedSkillIds: [] };
const draft: ScheduledTaskDraft = { id: 'draft-1', sourceSessionId: 'session-1', sourceJobId: null, proposedPayload: input, status: 'pending', confirmedTaskId: null, createdAt: 1, updatedAt: 1 };
const sessions: SessionSummary[] = [{ id: 'session-1', title: '当前对话', modelId: 'model-1', messageCount: 1, createdAt: 1, updatedAt: 1 }];
const models: Model[] = [{ id: 'model-1', providerId: 'p1', name: 'gpt', enabled: true, createdAt: 1, updatedAt: 1 }];
const skills: SkillMeta[] = [];
describe('ScheduledTaskDraftCard', () => {
  beforeEach(() => {
    vi.mocked(api.previewScheduledTask).mockResolvedValue(Date.now() + 1000);
    vi.mocked(api.confirmScheduledTaskDraft).mockResolvedValue({ draft: { ...draft, status: 'confirmed', confirmedTaskId: 'task-1' }, task: { id: 'task-1' } as never });
    vi.mocked(api.cancelScheduledTaskDraft).mockResolvedValue({ ...draft, status: 'cancelled' });
  });
  afterEach(() => { cleanup(); vi.clearAllMocks(); });
  function renderCard() { return render(<MemoryRouter><ScheduledTaskDraftCard draft={draft} sessions={sessions} models={models} skills={skills} /></MemoryRouter>); }

  it('确认前不创建，编辑后双击只确认一次', async () => {
    renderCard();
    expect(api.confirmScheduledTaskDraft).not.toHaveBeenCalled();
    expect(api.createScheduledTask).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('任务名称'), { target: { value: '修改后的任务' } });
    const button = screen.getByRole('button', { name: '确认创建' });
    fireEvent.click(button); fireEvent.click(button);
    await waitFor(() => expect(api.confirmScheduledTaskDraft).toHaveBeenCalledTimes(1));
    expect(api.confirmScheduledTaskDraft).toHaveBeenCalledWith('draft-1', expect.objectContaining({ name: '修改后的任务' }));
    expect(api.createScheduledTask).not.toHaveBeenCalled();
  });

  it('取消草稿', async () => {
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() => expect(api.cancelScheduledTaskDraft).toHaveBeenCalledWith('draft-1'));
  });
});
