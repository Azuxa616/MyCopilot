import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initDatabase, getDb } from '../../db/index.js';
import { syncDirectorySkills } from '../sync.js';
import {
  listSkills,
  listSkillsBySource,
  getSkill,
  createSkill,
} from '../../repo/skill.js';

describe('syncDirectorySkills', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'skill-sync-'));
    initDatabase(dir);
  });

  afterEach(() => {
    try {
      getDb().close();
    } catch {
      // ignore
    }
    if (dir && existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('creates DB rows for new files in the directory', () => {
    writeFileSync(
      join(dir, 'a.md'),
      `---
name: SkillA
description: alpha
---
body A`,
    );
    writeFileSync(
      join(dir, 'b.md'),
      `---
name: SkillB
description: beta
---
body B`,
    );

    const result = syncDirectorySkills(getDb(), dir);
    expect(result.created).toBe(2);
    expect(result.updated).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.deleted).toBe(0);

    const rows = listSkillsBySource('directory');
    expect(rows).toHaveLength(2);
    const names = rows.map((r) => r.name).sort();
    expect(names).toEqual(['SkillA', 'SkillB']);
  });

  it('skips unchanged files on a second sync', () => {
    writeFileSync(
      join(dir, 'a.md'),
      `---
name: SkillA
description: alpha
---
body A`,
    );

    syncDirectorySkills(getDb(), dir);
    const result = syncDirectorySkills(getDb(), dir);
    expect(result.created).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.updated).toBe(0);
  });

  it('updates DB rows when file content changes', () => {
    const file = join(dir, 'a.md');
    writeFileSync(file, `---
name: SkillA
description: alpha
---
body A`);

    syncDirectorySkills(getDb(), dir);
    const before = listSkills({ source: 'directory' });
    expect(before).toHaveLength(1);
    const firstId = before[0]!.id;

    // Rewrite file with new description and body.
    writeFileSync(file, `---
name: SkillA
description: alpha-renamed
---
new body content`);

    const result = syncDirectorySkills(getDb(), dir);
    expect(result.updated).toBe(1);
    expect(result.created).toBe(0);

    const after = getSkill(firstId);
    expect(after).toBeDefined();
    expect(after!.description).toBe('alpha-renamed');
    expect(after!.content).toBe('new body content');
  });

  it('deletes DB rows when the source file is removed', () => {
    const file = join(dir, 'a.md');
    writeFileSync(file, `---
name: SkillA
description: alpha
---
body A`);

    syncDirectorySkills(getDb(), dir);
    expect(listSkillsBySource('directory')).toHaveLength(1);

    unlinkSync(file);
    const result = syncDirectorySkills(getDb(), dir);
    expect(result.deleted).toBe(1);
    expect(listSkillsBySource('directory')).toEqual([]);
  });

  it('does not touch upload-sourced skills', () => {
    createSkill({
      name: 'Uploaded',
      description: 'up',
      body: 'up body',
      source: 'upload',
    });

    writeFileSync(
      join(dir, 'dir.md'),
      `---
name: Dir
description: from fs
---
dir body`,
    );

    syncDirectorySkills(getDb(), dir);

    const all = listSkills();
    expect(all).toHaveLength(2);
    const upload = listSkillsBySource('upload');
    expect(upload).toHaveLength(1);
    expect(upload[0]!.name).toBe('Uploaded');
  });

  it('returns empty result for a missing directory without throwing', () => {
    const result = syncDirectorySkills(getDb(), join(dir, 'nope'));
    expect(result.created).toBe(0);
    expect(result.deleted).toBe(0);
    expect(result.updated).toBe(0);
    expect(result.skipped).toBe(0);
  });
});
