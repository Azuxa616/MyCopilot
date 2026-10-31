import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScheduledTaskListItem } from '@my-copilot/shared';
import { ScheduledTasksPage } from './ScheduledTasksPage';
import { api } from '../../api';

vi.mock('../../api', () => ({ api: {
  fetchScheduledTasks: vi.fn(), fetchScheduledTaskRunUnreadCount: vi.fn(),
  pauseScheduledTask: vi.fn(), resumeScheduledTask: vi.fn(), runScheduledTaskNow: vi.fn(),
} }));

const task: ScheduledTaskListItem = {
  id: 'task-1', name: '每日摘要', prompt: '生成摘要', scheduleType: 'cron', runAt: null,
  cronExpression: '0 9 * * *', timezone: 'Asia/Hong_Kong', targetType: 'new_session',
  targetSessionId: null, modelId: 'model-1', enforcedSkillIds: [], status: 'active',
  nextRunAt: 100, deletedAt: null, createdAt: 1, updatedAt: 1,
  targetSessionTitle: '原对话', lastRunStatus: 'done', lastRunAt: 50, hasUnread: true,
};

describe('ScheduledTasksPage', () => {
  beforeEach(() => {
    vi.mocked(api.fetchScheduledTasks).mockResolvedValue([task]);
    vi.mocked(api.fetchScheduledTaskRunUnreadCount).mockResolvedValue(0);
    vi.mocked(api.pauseScheduledTask).mockResolvedValue({ ...task, status: 'paused' });
    vi.mocked(api.runScheduledTaskNow).mockResolvedValue({} as never);
  });
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it('展示任务并支持暂停', async () => {
    render(<MemoryRouter><ScheduledTasksPage /></MemoryRouter>);
    expect(await screen.findByText('每日摘要')).toBeTruthy();
    expect(screen.getByText(/下次执行/)).toBeTruthy();
    expect(screen.getByText('最近：done')).toBeTruthy();
    expect(screen.getByText('未读')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '暂停' }));
    await waitFor(() => expect(api.pauseScheduledTask).toHaveBeenCalledWith('task-1'));
  });

  it('支持立即运行', async () => {
    render(<MemoryRouter><ScheduledTasksPage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: '立即运行' }));
    await waitFor(() => expect(api.runScheduledTaskNow).toHaveBeenCalledWith('task-1'));
  });
});
