import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ScheduledTask, ScheduledTaskInput } from '@my-copilot/shared';
import { createScheduledTask } from './real';
import { useConfigStore } from '../store/configStore';

const input: ScheduledTaskInput = { name: '任务', prompt: '执行', scheduleType: 'once', runAt: 1, cronExpression: null, timezone: 'Asia/Hong_Kong', targetType: 'new_session', targetSessionId: null, modelId: 'model-1', enforcedSkillIds: [] };
describe('scheduled task API requests', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
  it('创建任务显式发送 JSON Content-Type', async () => {
    useConfigStore.setState({ authToken: 'token' });
    const task = { id: 'task-1', ...input } as ScheduledTask;
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: task }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    await createScheduledTask(input);
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual(expect.objectContaining({ 'Content-Type': 'application/json' }));
  });
});
