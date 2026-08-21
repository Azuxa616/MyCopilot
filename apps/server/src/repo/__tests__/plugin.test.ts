import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PluginManifest } from '@my-copilot/shared';
import { initDatabase, getDb } from '../../db/index.js';
import {
  createPlugin,
  getPlugin,
  getState,
  listPlugins,
  updatePluginState,
  deletePlugin,
} from '../plugin.js';
import { deleteMcpsByPlugin } from '../mcp.js';
import { deleteSkillsByPlugin } from '../skill.js';

const manifest: PluginManifest = {
  name: 'demo-plugin',
  version: '1.2.3',
  description: 'A test plugin',
  author: { name: 'Tester', email: 'tester@example.com' },
  license: 'MIT',
  engineCompatibility: { minVersion: '1.0.0' },
  source: 'community',
  permissions: { tools: true, network: false },
  provides: { skills: [{ path: 'skills/greet.md' }] },
  type: 'frontend-response',
};

describe('PluginRepo', () => {
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

  it('createPlugin persists a row and getPlugin round-trips the manifest snapshot', () => {
    const created = createPlugin({
      manifest,
      state: 'discovered',
      directory: 'demo-plugin',
      digest: 'sha256:abc123',
    });

    expect(created.id).toBe('demo-plugin');
    expect(created.version).toBe('1.2.3');
    expect(created.source).toBe('community');
    expect(created.state).toBe('discovered');
    expect(created.type).toBe('frontend-response');
    expect(created.digest).toBe('sha256:abc123');
    expect(created.directory).toBe('demo-plugin');
    expect(created.createdAt).toBe(created.updatedAt);

    const fetched = getPlugin('demo-plugin');
    expect(fetched).toEqual(created);
    // manifest JSON snapshot survives the round-trip byte-for-byte in meaning.
    expect(fetched!.manifest).toEqual(manifest);
  });

  it('manifest is stored as a JSON string column', () => {
    createPlugin({ manifest, state: 'discovered', directory: 'demo-plugin' });

    const db = getDb();
    const row = db
      .prepare('SELECT manifest FROM plugins WHERE id = ?')
      .get('demo-plugin') as { manifest: string };
    expect(JSON.parse(row.manifest)).toEqual(manifest);
  });

  it('updatePluginState writes the new state and error, and clears error when omitted', () => {
    createPlugin({ manifest, state: 'discovered', directory: 'demo-plugin' });

    const failed = updatePluginState('demo-plugin', 'verified', 'signature_invalid: bad digest');
    expect(failed!.state).toBe('verified');
    expect(failed!.error).toBe('signature_invalid: bad digest');

    // Pin updated_at so the refresh assertion below is deterministic.
    const db = getDb();
    db.prepare('UPDATE plugins SET updated_at = 0 WHERE id = ?').run('demo-plugin');

    const ok = updatePluginState('demo-plugin', 'installed');
    expect(ok!.state).toBe('installed');
    expect(ok!.error).toBeUndefined();
    expect(ok!.updatedAt).toBeGreaterThan(0);

    expect(getState('demo-plugin')).toBe('installed');
    // Unknown id is reported as undefined, not an error.
    expect(updatePluginState('nope', 'enabled')).toBeUndefined();
  });

  it('getState and deletePlugin', () => {
    createPlugin({ manifest, state: 'enabled', directory: 'demo-plugin' });

    expect(getState('demo-plugin')).toBe('enabled');
    expect(getState('missing')).toBeUndefined();
    expect(listPlugins()).toHaveLength(1);

    expect(deletePlugin('demo-plugin')).toBe(true);
    expect(getPlugin('demo-plugin')).toBeUndefined();
    expect(getState('demo-plugin')).toBeUndefined();
    // Second delete reports false.
    expect(deletePlugin('demo-plugin')).toBe(false);
  });

  it('deleteMcpsByPlugin removes only rows contributed by the plugin', () => {
    const db = getDb();
    const ts = 0;
    db.prepare(
      `INSERT INTO mcps (id, name, description, transport, args, env, enabled, created_at, updated_at, source_plugin_id)
       VALUES ('mcp-1', 'plugin-mcp', 'from plugin', 'stdio', '[]', '{}', 1, ?, ?, 'demo-plugin')`,
    ).run(ts, ts);
    db.prepare(
      `INSERT INTO mcps (id, name, description, transport, args, env, enabled, created_at, updated_at, source_plugin_id)
       VALUES ('mcp-2', 'other-mcp', 'other plugin', 'stdio', '[]', '{}', 1, ?, ?, 'another-plugin')`,
    ).run(ts, ts);

    expect(deleteMcpsByPlugin('demo-plugin')).toBe(1);

    const remaining = db.prepare('SELECT id FROM mcps').all() as { id: string }[];
    expect(remaining.map((r) => r.id)).toEqual(['mcp-2']);
    expect(deleteMcpsByPlugin('demo-plugin')).toBe(0);
  });

  it('deleteSkillsByPlugin removes only rows contributed by the plugin', () => {
    const db = getDb();
    const ts = 0;
    db.prepare(
      `INSERT INTO skills (id, name, description, body, source, enabled, created_at, updated_at, source_plugin_id)
       VALUES ('sk-1', 'plugin-skill', 'from plugin', 'body', 'plugin', 1, ?, ?, 'demo-plugin')`,
    ).run(ts, ts);
    db.prepare(
      `INSERT INTO skills (id, name, description, body, source, enabled, created_at, updated_at, source_plugin_id)
       VALUES ('sk-2', 'other-skill', 'other plugin', 'body', 'plugin', 1, ?, ?, 'another-plugin')`,
    ).run(ts, ts);

    expect(deleteSkillsByPlugin('demo-plugin')).toBe(1);

    const remaining = db.prepare('SELECT id FROM skills').all() as { id: string }[];
    expect(remaining.map((r) => r.id)).toEqual(['sk-2']);
    expect(deleteSkillsByPlugin('demo-plugin')).toBe(0);
  });
});
