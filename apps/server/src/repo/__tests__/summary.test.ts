import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initDatabase, getDb } from '../../db/index.js';
import { createSession } from '../session.js';
import { createMessage } from '../message.js';
import {
  createSummary,
  getLatestSummary,
  listSummariesBySession,
  type MessageSummary,
} from '../summary.js';

describe('SummaryRepo', () => {
  let testDir: string;
  let sessionId: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'my-copilot-test-'));
    initDatabase(testDir);
    sessionId = createSession({ title: 'Summary test' }).id;
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

  it('createSummary persists a row and returns it with id + createdAt', () => {
    const created = createSummary({
      sessionId,
      summary: 'User asked about the weather.',
      summarizedUpToMessageId: 'msg-5',
      tokenCount: 1234,
    });

    expect(created.id).toBeDefined();
    expect(created.sessionId).toBe(sessionId);
    expect(created.summary).toBe('User asked about the weather.');
    expect(created.summarizedUpToMessageId).toBe('msg-5');
    expect(created.tokenCount).toBe(1234);
    expect(created.createdAt).toBeGreaterThan(0);
  });

  it('getLatestSummary returns undefined when no summaries exist', () => {
    expect(getLatestSummary(sessionId)).toBeUndefined();
  });

  it('getLatestSummary returns the most recent summary by created_at', () => {
    const first = createSummary({
      sessionId,
      summary: 'First summary',
      summarizedUpToMessageId: 'msg-1',
      tokenCount: 100,
    });
    const second = createSummary({
      sessionId,
      summary: 'Second summary',
      summarizedUpToMessageId: 'msg-5',
      tokenCount: 200,
    });

    // Force deterministic timestamps (Date.now() can collide within 1ms on
    // fast machines, making ORDER BY created_at DESC nondeterministic).
    const db = getDb();
    db.prepare(
      'UPDATE message_summaries SET created_at = ? WHERE id = ?',
    ).run(1000, first.id);
    db.prepare(
      'UPDATE message_summaries SET created_at = ? WHERE id = ?',
    ).run(2000, second.id);

    const latest = getLatestSummary(sessionId);
    expect(latest).toBeDefined();
    expect(latest!.id).toBe(second.id);
    expect(latest!.summary).toBe('Second summary');
  });

  it('listSummariesBySession returns all rows ordered newest-first', () => {
    const a = createSummary({
      sessionId,
      summary: 'A',
      summarizedUpToMessageId: 'm-a',
      tokenCount: 10,
    });
    const b = createSummary({
      sessionId,
      summary: 'B',
      summarizedUpToMessageId: 'm-b',
      tokenCount: 20,
    });
    const c = createSummary({
      sessionId,
      summary: 'C',
      summarizedUpToMessageId: 'm-c',
      tokenCount: 30,
    });

    // Pin deterministic timestamps so newest-first ordering is unambiguous.
    const db = getDb();
    db.prepare(
      'UPDATE message_summaries SET created_at = ? WHERE id = ?',
    ).run(1000, a.id);
    db.prepare(
      'UPDATE message_summaries SET created_at = ? WHERE id = ?',
    ).run(2000, b.id);
    db.prepare(
      'UPDATE message_summaries SET created_at = ? WHERE id = ?',
    ).run(3000, c.id);

    const list = listSummariesBySession(sessionId);
    expect(list).toHaveLength(3);
    // newest first: c, b, a
    expect(list.map((s) => s.id)).toEqual([c.id, b.id, a.id]);
  });

  it('summaries are isolated per session', () => {
    const otherSession = createSession({ title: 'Other' }).id;

    createSummary({
      sessionId,
      summary: 'Session 1 summary',
      summarizedUpToMessageId: 'm-1',
      tokenCount: 50,
    });
    createSummary({
      sessionId: otherSession,
      summary: 'Session 2 summary',
      summarizedUpToMessageId: 'm-2',
      tokenCount: 60,
    });

    expect(listSummariesBySession(sessionId)).toHaveLength(1);
    expect(listSummariesBySession(otherSession)).toHaveLength(1);
    expect(getLatestSummary(sessionId)!.summary).toBe('Session 1 summary');
    expect(getLatestSummary(otherSession)!.summary).toBe('Session 2 summary');
  });

  it('round-trips all fields through the DB without loss (snake_case ↔ camelCase)', () => {
    createSummary({
      sessionId,
      summary: 'Multi-line\nsummary with "quotes" and 中文 characters.',
      summarizedUpToMessageId: 'msg-abc-123',
      tokenCount: 9999,
    });

    const fetched = getLatestSummary(sessionId) as MessageSummary;
    expect(fetched.summary).toBe('Multi-line\nsummary with "quotes" and 中文 characters.');
    expect(fetched.summarizedUpToMessageId).toBe('msg-abc-123');
    expect(fetched.tokenCount).toBe(9999);
    expect(fetched.sessionId).toBe(sessionId);
  });

  it('integration: createSummary can reference a real message id from the same session', () => {
    // Ensures the FK constraint session_id → sessions(id) is satisfied and
    // summarized_up_to_message_id lines up with a real persisted message.
    const msg = createMessage({
      sessionId,
      role: 'user',
      content: 'Hello',
      status: 'sent',
    });

    const summary = createSummary({
      sessionId,
      summary: 'Greeted the assistant.',
      summarizedUpToMessageId: msg.id,
      tokenCount: 5,
    });

    expect(summary.summarizedUpToMessageId).toBe(msg.id);
    expect(getLatestSummary(sessionId)!.summarizedUpToMessageId).toBe(msg.id);
  });
});
