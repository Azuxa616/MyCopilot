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
});
