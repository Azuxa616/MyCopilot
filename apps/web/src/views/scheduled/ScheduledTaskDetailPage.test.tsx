import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScheduledTask } from '@my-copilot/shared';
import { ScheduledTaskDetailPage } from './ScheduledTaskDetailPage';
import { api } from '../../api';

vi.mock('../../api', () => ({ api: {
  getScheduledTask: vi.fn(), fetchScheduledTaskRuns: vi.fn(), deleteScheduledTask: vi.fn(),
  runScheduledTaskNow: vi.fn(), pauseScheduledTask: vi.fn(), resumeScheduledTask: vi.fn(), markScheduledTaskRunRead: vi.fn(),
} }));
const task: ScheduledTask = { id: 'task-1', name: '任务', prompt: '执行', scheduleType: 'once', runAt: 100, cronExpression: null, timezone: 'Asia/Hong_Kong', targetType: 'new_session', targetSessionId: null, modelId: 'model-1', enforcedSkillIds: [], status: 'active', nextRunAt: 100, deletedAt: null, createdAt: 1, updatedAt: 1 };
describe('ScheduledTaskDetailPage', () => {
  beforeEach(() => { vi.mocked(api.getScheduledTask).mockResolvedValue(task); vi.mocked(api.fetchScheduledTaskRuns).mockResolvedValue([]); vi.mocked(api.deleteScheduledTask).mockResolvedValue(); vi.spyOn(window, 'confirm').mockReturnValue(true); });
  afterEach(() => { cleanup(); vi.clearAllMocks(); });
  it('打开详情后将已完成的未读运行标记为已读', async () => {
    const run = { id: 'run-1', taskId: 'task-1', scheduledFor: null, triggerType: 'manual' as const, jobId: 'job-1', sessionId: 'session-1', userMessageId: null, assistantMessageId: null, dispatchStatus: 'dispatched' as const, skippedReason: null, dispatchError: null, readAt: null, createdAt: 1, status: 'done' as const };
    vi.mocked(api.fetchScheduledTaskRuns).mockResolvedValue([run]);
    vi.mocked(api.markScheduledTaskRunRead).mockResolvedValue({ ...run, readAt: 2 });
    render(<MemoryRouter initialEntries={['/scheduled/task-1']}><Routes><Route path="/scheduled/:id" element={<ScheduledTaskDetailPage />} /></Routes></MemoryRouter>);
    await waitFor(() => expect(api.markScheduledTaskRunRead).toHaveBeenCalledWith('run-1'));
  });

  it('确认后删除任务并返回列表', async () => {
    render(<MemoryRouter initialEntries={['/scheduled/task-1']}><Routes><Route path="/scheduled/:id" element={<ScheduledTaskDetailPage />} /><Route path="/scheduled" element={<div>任务列表</div>} /></Routes></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: '删除' }));
    await waitFor(() => expect(api.deleteScheduledTask).toHaveBeenCalledWith('task-1'));
    expect(await screen.findByText('任务列表')).toBeTruthy();
  });
});
