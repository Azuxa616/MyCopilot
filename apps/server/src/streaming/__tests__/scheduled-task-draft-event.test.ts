import { describe, expect, it, vi } from 'vitest';
import type { ScheduledTaskDraft } from '@my-copilot/shared';
import { handleAgentEvent } from '../lifecycle.js';

describe('scheduled task draft SSE event', () => {
  it('输出 scheduled_task_draft 与 draftId', async () => {
    const writeSSE = vi.fn(async () => {});
    const draft = { id: 'draft-1' } as ScheduledTaskDraft;
    await handleAgentEvent({ type: 'scheduled_task_draft', draft }, { stream: { writeSSE }, assistantMsgId: 'message-1', onContent: vi.fn() });
    expect(writeSSE).toHaveBeenCalledWith({ event: 'scheduled_task_draft', data: JSON.stringify({ draftId: 'draft-1' }) });
  });
});
