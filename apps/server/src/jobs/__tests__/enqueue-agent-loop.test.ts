import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Message } from '@my-copilot/shared';
import { getDb, initDatabase } from '../../db/index.js';
import { createProvider } from '../../repo/provider.js';
import { createModel } from '../../repo/model.js';
import { createSession } from '../../repo/session.js';
import { listJobsBySession } from '../../repo/job.js';
import { listMessagesBySession } from '../../repo/message.js';
import { enqueueAgentLoop } from '../enqueue-agent-loop.js';

describe('enqueueAgentLoop', () => {
  let testDir: string;
  beforeEach(() => { testDir = mkdtempSync(join(tmpdir(), 'enqueue-agent-loop-')); initDatabase(testDir); });
  afterEach(() => { try { getDb().close(); } catch { /* ignore */ } if (testDir && existsSync(testDir)) rmSync(testDir, { recursive: true, force: true }); });

  it('保存消息并创建保留执行意图的 agent-loop Job', () => {
    const provider = createProvider({ name: 'P', type: 'openai', baseUrl: 'https://example.com', apiKey: 'secret' });
    const model = createModel(provider.id, { name: 'gpt-test' });
    const session = createSession({ title: '会话', modelId: model.id });
    const userMessage: Message = {
      id: 'input-id', sessionId: session.id, role: 'user', content: '执行任务', status: 'sent',
      attachments: [], parts: [{ type: 'text', text: '执行任务' }], createdAt: 1,
    };
    const result = enqueueAgentLoop({
      sessionId: session.id, userMessage, provider, model, history: [],
      attachments: [{ name: 'a.txt', content: '附件' }], enforcedSkillIds: ['skill-a'],
      referencedSessionIds: ['session-ref'],
    });
    const messages = listMessagesBySession(session.id);
    expect(messages.map((message) => message.role)).toEqual(['user', 'assistant']);
    expect(messages[1]?.status).toBe('sending');
    expect(result.job.payload).toEqual(expect.objectContaining({
      sessionId: session.id, userMessageId: result.assistantMessage.id,
      userContent: '执行任务', enforcedSkillIds: ['skill-a'], referencedSessionIds: ['session-ref'],
      currentUserParts: [{ type: 'text', text: '执行任务' }],
      adapterConfig: { baseUrl: provider.baseUrl, apiKey: 'secret', model: model.name },
    }));
    expect(listJobsBySession(session.id)).toHaveLength(1);
  });
});
