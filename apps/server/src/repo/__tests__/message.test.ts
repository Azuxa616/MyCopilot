import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initDatabase, getDb } from '../../db/index.js';
import { createSession } from '../session.js';
import {
  createMessage,
  getMessage,
  listMessagesBySession,
  updateMessage,
  updateMessageContent,
  deleteMessage,
} from '../message.js';

describe('MessageRepo', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'my-copilot-test-'));
    initDatabase(testDir);
  });

  afterEach(() => {
    try {
      getDb().close();
    } catch {
      // ignore
    }
    if (testDir) {
      try {
        rmSync(testDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  });

  it('createMessage → getMessage → verify fields', () => {
    const session = createSession({ title: 'Test' });
    const message = createMessage({
      sessionId: session.id,
      role: 'user',
      content: 'Hello',
      status: 'sending',
    });

    expect(message.id).toBeDefined();
    expect(message.sessionId).toBe(session.id);
    expect(message.role).toBe('user');
    expect(message.content).toBe('Hello');
    expect(message.status).toBe('sending');
    expect(message.attachments).toEqual([]);
    expect(message.createdAt).toBeDefined();

    const fetched = getMessage(message.id);
    expect(fetched).toEqual(message);
  });

  it('createMessage with attachments', () => {
    const session = createSession({ title: 'Test' });
    const attachments = [
      { name: 'file.txt', type: 'text/plain', size: 100, textExcerpt: 'hello' },
    ];
    const message = createMessage({
      sessionId: session.id,
      role: 'user',
      content: 'Hello',
      attachments,
      status: 'sent',
    });

    const fetched = getMessage(message.id);
    expect(fetched!.attachments).toEqual(attachments);
  });

  it('listMessagesBySession returns messages in created_at ASC order', () => {
    const session = createSession({ title: 'Test' });
    const m1 = createMessage({
      sessionId: session.id,
      role: 'user',
      content: 'First',
      status: 'sent',
    });
    const m2 = createMessage({
      sessionId: session.id,
      role: 'assistant',
      content: 'Second',
      status: 'sent',
    });

    const list = listMessagesBySession(session.id);
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe(m1.id);
    expect(list[1].id).toBe(m2.id);
  });

  it('updateMessage status to aborted → listMessagesBySession returns correct status', () => {
    const session = createSession({ title: 'Test' });
    const message = createMessage({
      sessionId: session.id,
      role: 'user',
      content: 'Hello',
      status: 'sending',
    });

    const updated = updateMessage(message.id, { status: 'aborted' });
    expect(updated).toBeDefined();
    expect(updated!.status).toBe('aborted');

    const list = listMessagesBySession(session.id);
    expect(list[0].status).toBe('aborted');
  });

  it('updateMessageContent updates only content', () => {
    const session = createSession({ title: 'Test' });
    const message = createMessage({
      sessionId: session.id,
      role: 'assistant',
      content: 'Hel',
      status: 'sending',
    });

    updateMessageContent(message.id, 'Hello World');

    const fetched = getMessage(message.id);
    expect(fetched!.content).toBe('Hello World');
    expect(fetched!.status).toBe('sending');
  });

  it('deleteMessage removes message', () => {
    const session = createSession({ title: 'Test' });
    const message = createMessage({
      sessionId: session.id,
      role: 'user',
      content: 'Hello',
      status: 'sent',
    });

    expect(getMessage(message.id)).toBeDefined();

    const deleted = deleteMessage(message.id);
    expect(deleted).toBe(true);
    expect(getMessage(message.id)).toBeUndefined();
  });

  it('createMessage with reasoning roundtrips through getMessage (纯文本直存)', () => {
    const session = createSession({ title: 'Reasoning' });
    const message = createMessage({
      sessionId: session.id,
      role: 'assistant',
      content: '答案是 5',
      reasoning: '先分析问题，再拆解步骤',
      status: 'sent',
    });

    expect(message.reasoning).toBe('先分析问题，再拆解步骤');

    const fetched = getMessage(message.id);
    expect(fetched).toBeDefined();
    expect(fetched!.reasoning).toBe('先分析问题，再拆解步骤');
    expect(fetched!.content).toBe('答案是 5');
  });

  it('createMessage without reasoning stores NULL (旧消息形状)', () => {
    const session = createSession({ title: 'NoReasoning' });
    const message = createMessage({
      sessionId: session.id,
      role: 'assistant',
      content: 'hi',
      status: 'sent',
    });

    expect(message.reasoning).toBeUndefined();

    const row = getDb()
      .prepare('SELECT reasoning FROM messages WHERE id = ?')
      .get(message.id) as { reasoning: string | null };
    expect(row.reasoning).toBeNull();
  });

  it('updateMessage writes reasoning and unrelated updates do not clobber it', () => {
    const session = createSession({ title: 'UpdateReasoning' });
    const message = createMessage({
      sessionId: session.id,
      role: 'assistant',
      content: '',
      reasoning: '初始推理',
      status: 'sending',
    });

    const updated = updateMessage(message.id, {
      content: '答案',
      status: 'sent',
      reasoning: '初始推理继续深入',
    });
    expect(updated!.reasoning).toBe('初始推理继续深入');
    expect(getMessage(message.id)!.reasoning).toBe('初始推理继续深入');

    updateMessage(message.id, { status: 'sent' });
    expect(getMessage(message.id)!.reasoning).toBe('初始推理继续深入');

    const cleared = updateMessage(message.id, { reasoning: null });
    expect(cleared!.reasoning).toBeUndefined();
    const row = getDb()
      .prepare('SELECT reasoning FROM messages WHERE id = ?')
      .get(message.id) as { reasoning: string | null };
    expect(row.reasoning).toBeNull();
  });
});
