import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TransitionResult } from '@my-copilot/shared';
import { initDatabase, getDb } from '../../db/index.js';
import { recordEvent, listEventsByPlugin } from '../plugin-lifecycle.js';

const success: TransitionResult = { status: 'success' };
const failure: TransitionResult = {
  status: 'failed',
  errorCode: 'signature_invalid',
  errorMessage: 'digest mismatch',
};

describe('PluginLifecycleRepo', () => {
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

  it('recordEvent stores the row and round-trips result JSON', () => {
    const event = recordEvent({
      pluginId: 'demo-plugin',
      fromState: null,
      toState: 'discovered',
      type: 'discovered',
      trigger: 'user',
      version: '1.2.3',
      result: failure,
      payload: { registry: 'community-registry' },
    });

    expect(event.eventId).toBeDefined();
    expect(event.pluginId).toBe('demo-plugin');
    expect(event.fromState).toBeNull();
    expect(event.toState).toBe('discovered');
    expect(event.type).toBe('discovered');
    expect(event.trigger).toBe('user');
    expect(event.version).toBe('1.2.3');
    // TransitionResult JSON survives the round-trip field by field.
    expect(event.result).toEqual(failure);
    expect(event.payload).toEqual({ registry: 'community-registry' });

    const listed = listEventsByPlugin('demo-plugin');
    expect(listed).toHaveLength(1);
    expect(listed[0]).toEqual(event);
  });

  it('success result without optional fields round-trips', () => {
    const event = recordEvent({
      pluginId: 'demo-plugin',
      fromState: 'discovered',
      toState: 'downloaded',
      type: 'downloaded',
      trigger: 'system',
      version: '1.2.3',
      result: success,
    });

    expect(event.result).toEqual({ status: 'success' });
    expect(event.payload).toBeUndefined();

    // Column-level check: payload stored as NULL, result is JSON text.
    const db = getDb();
    const row = db
      .prepare('SELECT result, payload FROM plugin_lifecycle_events WHERE id = ?')
      .get(event.eventId) as { result: string; payload: string | null };
    expect(JSON.parse(row.result)).toEqual({ status: 'success' });
    expect(row.payload).toBeNull();
  });

  it('listEventsByPlugin returns events newest-first and scoped to the plugin', () => {
    const first = recordEvent({
      pluginId: 'demo-plugin',
      fromState: null,
      toState: 'discovered',
      type: 'discovered',
      trigger: 'user',
      version: '1.2.3',
      result: success,
    });
    // Pin an older timestamp so the DESC assertion is deterministic even at
    // millisecond clock granularity.
    const db = getDb();
    db.prepare('UPDATE plugin_lifecycle_events SET created_at = 0 WHERE id = ?').run(
      first.eventId,
    );

    const second = recordEvent({
      pluginId: 'demo-plugin',
      fromState: 'discovered',
      toState: 'downloaded',
      type: 'downloaded',
      trigger: 'system',
      version: '1.2.3',
      result: success,
    });
    recordEvent({
      pluginId: 'other-plugin',
      fromState: null,
      toState: 'discovered',
      type: 'discovered',
      trigger: 'user',
      version: '0.0.1',
      result: success,
    });

    const listed = listEventsByPlugin('demo-plugin');
    expect(listed.map((e) => e.eventId)).toEqual([second.eventId, first.eventId]);
    expect(listEventsByPlugin('other-plugin')).toHaveLength(1);
    expect(listEventsByPlugin('plugin-never')).toEqual([]);
  });
});
