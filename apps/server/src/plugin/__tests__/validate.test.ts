import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateLifecycleEvent, validateManifest } from '../validate.js';

/** RFC §3 官方示例（acme-tools），含 type 字段（B1 修正后 schema 必须接受）。 */
function acmeManifest(): Record<string, unknown> {
  return {
    name: 'acme-tools',
    version: '1.2.0',
    description: 'Acme code review + private HTTP tool',
    author: { name: 'Acme', url: 'https://acme.example' },
    license: 'Apache-2.0',
    engineCompatibility: { minVersion: '0.4.0' },
    source: 'community',
    permissions: {
      tools: true,
      network: true,
      filesystem: { read: ['cache/*'], write: ['cache/*'] },
      childProcess: false,
      envVars: ['ACME_API_KEY'],
    },
    provides: {
      mcpServers: [{ id: 'acme-mcp', transport: 'stdio', command: 'node', args: ['mcp.js'] }],
      skills: [{ path: 'skills/code-review.md' }],
      rules: [{ path: 'rules/no-pii.md' }],
    },
    dependencies: [{ name: 'acme-core', versionRange: '^1.0.0' }],
    lifecycleHooks: { onInstall: { command: 'node setup.js', timeoutMs: 5000 } },
    type: 'frontend-response',
  };
}

describe('validateManifest', () => {
  it('accepts the RFC section 3 acme-tools example including type', () => {
    const result = validateManifest(acmeManifest());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects a manifest missing required name', () => {
    const raw = acmeManifest();
    delete raw.name;
    const result = validateManifest(raw);
    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('name');
  });

  it('rejects a manifest missing required version', () => {
    const raw = acmeManifest();
    delete raw.version;
    const result = validateManifest(raw);
    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('version');
  });

  it('rejects a manifest whose provides blocks are all empty (oneOf non-empty constraint)', () => {
    const raw = acmeManifest();
    raw.provides = { mcpServers: [], skills: [], rules: [] };
    const result = validateManifest(raw);
    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('provides');
  });

  it('rejects an illegal source enum value', () => {
    const raw = acmeManifest();
    raw.source = 'third-party';
    const result = validateManifest(raw);
    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('source');
  });

  it('rejects a non-semver version', () => {
    const raw = acmeManifest();
    raw.version = '1.0';
    const result = validateManifest(raw);
    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('version');
  });
});

describe('validateLifecycleEvent', () => {
  it('accepts a valid discovered event', () => {
    const result = validateLifecycleEvent({
      eventId: '0195c0de-0000-4000-8000-000000000001',
      type: 'discovered',
      pluginId: 'acme-tools',
      version: '1.2.0',
      timestamp: 1760000000000,
      fromState: null,
      toState: 'discovered',
      trigger: 'user',
      result: { status: 'success' },
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects an illegal toState enum value', () => {
    const result = validateLifecycleEvent({
      eventId: '0195c0de-0000-4000-8000-000000000002',
      type: 'installed',
      pluginId: 'acme-tools',
      version: '1.2.0',
      timestamp: 1760000000000,
      fromState: 'verified',
      toState: 'active',
      trigger: 'user',
      result: { status: 'success' },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('toState');
  });
});

describe('schema 拷贝件与 docs 原件同步', () => {
  const testDir = dirname(fileURLToPath(import.meta.url));
  // testDir = apps/server/src/plugin/__tests__，向上 5 级到仓库根
  const repoRoot = resolve(testDir, '..', '..', '..', '..', '..');

  it.each([
    'plugin.manifest.schema.json',
    'plugin.lifecycle-event.schema.json',
  ])('%s 拷贝件与 docs/rfc/schemas 原件逐字节一致', (fileName) => {
    const copy = readFileSync(join(testDir, '..', 'schemas', fileName));
    const original = readFileSync(join(repoRoot, 'docs', 'rfc', 'schemas', fileName));
    expect(copy.length).toBe(original.length);
    expect(copy.equals(original)).toBe(true);
  });
});
