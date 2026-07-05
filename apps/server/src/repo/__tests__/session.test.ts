import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initDatabase, getDb } from '../../db/index.js';
import {
  createSession,
  getSession,
  listSessions,
  updateSession,
  deleteSession,
} from '../session.js';
import { createMessage } from '../message.js';

describe('SessionRepo', () => {
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

  it('createSession → getSession → verify fields', () => {
    const session = createSession({ title: 'Test Session', modelId: null });

    expect(session.id).toBeDefined();
    expect(session.title).toBe('Test Session');
    expect(session.modelId).toBeNull();
    expect(session.createdAt).toBeDefined();
    expect(session.updatedAt).toBeDefined();

    const fetched = getSession(session.id);
    expect(fetched).toEqual(session);
  });

  it('createSession defaults title to 新对话 and modelId to null', () => {
    const session = createSession({});

    expect(session.title).toBe('新对话');
    expect(session.modelId).toBeNull();
  });

  it('createSession + createMessages → listSessions returns correct messageCount', () => {
    const s1 = createSession({ title: 'S1' });
    const s2 = createSession({ title: 'S2' });

    createMessage({ sessionId: s1.id, role: 'user', content: 'Hello', status: 'sent' });
    createMessage({ sessionId: s1.id, role: 'assistant', content: 'Hi', status: 'sent' });
    createMessage({ sessionId: s2.id, role: 'user', content: 'Hey', status: 'sent' });

    const list = listSessions();
    const s1Summary = list.find((s) => s.id === s1.id);
    const s2Summary = list.find((s) => s.id === s2.id);

    expect(s1Summary!.messageCount).toBe(2);
    expect(s2Summary!.messageCount).toBe(1);
  });

  it('updateSession updates only provided fields', () => {
    const session = createSession({ title: 'Original', modelId: null });
    const updated = updateSession(session.id, { title: 'Updated' });

    expect(updated).toBeDefined();
    expect(updated!.title).toBe('Updated');
    expect(updated!.modelId).toBeNull();
  });

  it('deleteSession removes session', () => {
    const session = createSession({ title: 'To Delete' });
    expect(getSession(session.id)).toBeDefined();

    const deleted = deleteSession(session.id);
    expect(deleted).toBe(true);
    expect(getSession(session.id)).toBeUndefined();
  });
});
