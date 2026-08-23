import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, existsSync, unlinkSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initDatabase, getDb } from '../../db/index.js';
import { syncDirectorySkills } from '../sync.js';
import {
  listSkills,
  listSkillsBySource,
  getSkill,
  createSkill,
  listSkillFiles,
  getSkillFile,
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

  it('syncs directory-pack skills with side files and reports file counts', () => {
    const packDir = join(dir, 'pack-a');
    mkdirSync(join(packDir, 'references'), { recursive: true });
    writeFileSync(
      join(packDir, 'SKILL.md'),
      `---
name: PackA
description: d
---
body-a`,
    );
    writeFileSync(join(packDir, 'references', 'api.md'), 'api-v1');

    let result = syncDirectorySkills(getDb(), dir);
    expect(result.created).toBe(1);
    expect(result.filesCreated).toBe(1);

    const created = listSkillsBySource('directory').find((s) => s.name === 'PackA');
    expect(created).toBeDefined();
    expect(listSkillFiles(created!.id)).toEqual([{ path: 'references/api.md', size: 6 }]);

    // 附属文件内容变化 → 主文件未变也要 update files
    writeFileSync(join(packDir, 'references', 'api.md'), 'api-v2');
    result = syncDirectorySkills(getDb(), dir);
    expect(result.updated).toBe(1);
    expect(result.filesUpdated).toBe(1);
    expect(getSkillFile(created!.id, 'references/api.md')?.content).toBe('api-v2');

    // 附属文件删除 → filesDeleted
    rmSync(join(packDir, 'references', 'api.md'));
    result = syncDirectorySkills(getDb(), dir);
    expect(result.filesDeleted).toBe(1);
    expect(listSkillFiles(created!.id)).toEqual([]);
  });

  it('persists frontmatter triggers for directory skills', () => {
    writeFileSync(
      join(dir, 'trig.md'),
      `---
name: Trig
description: d
triggers:
  - review
  - 评审
---
body`,
    );

    syncDirectorySkills(getDb(), dir);
    const skill = listSkillsBySource('directory').find((s) => s.name === 'Trig');
    expect(skill?.triggers).toEqual(['review', '评审']);
  });

  it('detects triggers-only changes on rescan (C1 regression)', () => {
    const skillFile = join(dir, 'trig-only.md');
    writeFileSync(
      skillFile,
      `---\nname: TrigOnly\ndescription: d\n---\nbody`,
    );
    syncDirectorySkills(getDb(), dir);

    // 仅修改 frontmatter triggers，其余字段不变
    writeFileSync(
      skillFile,
      `---\nname: TrigOnly\ndescription: d\ntriggers:\n  - new-trigger\n---\nbody`,
    );
    const result = syncDirectorySkills(getDb(), dir);
    expect(result.updated).toBe(1);
    expect(result.skipped).toBe(0);

    const skill = listSkillsBySource('directory').find((s) => s.name === 'TrigOnly');
    expect(skill?.triggers).toEqual(['new-trigger']);
  });

  it('syncs frontmatter always flag and detects always-only changes', () => {
    const f = join(dir, 'al.md');
    writeFileSync(
      f,
      `---
name: Al
description: d
always: true
---
body`,
    );
    syncDirectorySkills(getDb(), dir);
    const skill = listSkillsBySource('directory').find((s) => s.name === 'Al');
    expect(skill?.always).toBe(true);

    writeFileSync(
      f,
      `---
name: Al
description: d
---
body`,
    ); // 仅去掉 always
    const result = syncDirectorySkills(getDb(), dir);
    expect(result.updated).toBe(1);
    expect(listSkillsBySource('directory').find((s) => s.name === 'Al')?.always).toBe(false);
  });
});
