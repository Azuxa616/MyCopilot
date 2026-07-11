import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initDatabase, getDb } from '../../db/index.js';
import {
  listSkills,
  listEnabledSkills,
  listSkillsBySource,
  getSkill,
  getSkillMeta,
  findByFilePath,
  createSkill,
  updateSkill,
  deleteSkill,
} from '../skill.js';

describe('SkillRepo', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'skill-repo-'));
    initDatabase(testDir);
  });

  afterEach(() => {
    try {
      getDb().close();
    } catch {
      // ignore
    }
    if (testDir && existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('createSkill → getSkill round-trips all fields', () => {
    const skill = createSkill({
      name: 'Test',
      description: 'a skill',
      body: '# body',
      source: 'upload',
    });

    expect(skill.id).toBeDefined();
    expect(skill.name).toBe('Test');
    expect(skill.description).toBe('a skill');
    expect(skill.content).toBe('# body');
    expect(skill.source).toBe('upload');
    expect(skill.filePath).toBeUndefined();
    expect(skill.enabled).toBe(true);
    expect(skill.createdAt).toBe(skill.updatedAt);

    const fetched = getSkill(skill.id);
    expect(fetched).toEqual(skill);
  });

  it('createSkill preserves filePath for directory source', () => {
    const skill = createSkill({
      name: 'Dir',
      description: 'from fs',
      body: 'body',
      source: 'directory',
      filePath: '/skills/dir.md',
    });
    expect(skill.source).toBe('directory');
    expect(skill.filePath).toBe('/skills/dir.md');

    const fetched = getSkill(skill.id);
    expect(fetched!.filePath).toBe('/skills/dir.md');
    expect(fetched!.source).toBe('directory');
  });

  it('listSkills filters by enabled and source', () => {
    createSkill({ name: 'A', description: '', body: '', source: 'upload', enabled: true });
    createSkill({ name: 'B', description: '', body: '', source: 'upload', enabled: false });
    createSkill({
      name: 'C',
      description: '',
      body: '',
      source: 'directory',
      filePath: '/x.md',
    });

    expect(listSkills()).toHaveLength(3);
    expect(listSkills({ enabled: true })).toHaveLength(2);
    expect(listSkills({ enabled: false })).toHaveLength(1);
    expect(listSkills({ source: 'upload' })).toHaveLength(2);
    expect(listSkills({ source: 'directory' })).toHaveLength(1);
    expect(listSkills({ enabled: true, source: 'upload' })).toHaveLength(1);
  });

  it('listEnabledSkills and listSkillsBySource helpers work', () => {
    createSkill({ name: 'A', description: '', body: '', source: 'upload', enabled: true });
    createSkill({ name: 'B', description: '', body: '', source: 'upload', enabled: false });
    createSkill({
      name: 'C',
      description: '',
      body: '',
      source: 'directory',
      filePath: '/c.md',
      enabled: true,
    });

    expect(listEnabledSkills()).toHaveLength(2);
    expect(listSkillsBySource('directory')).toHaveLength(1);
    expect(listSkillsBySource('upload')).toHaveLength(2);
  });

  it('updateSkill patches only provided fields', () => {
    const skill = createSkill({
      name: 'Orig',
      description: 'orig desc',
      body: 'orig body',
      source: 'upload',
      enabled: true,
    });

    const updated = updateSkill(skill.id, { name: 'New' });
    expect(updated).toBeDefined();
    expect(updated!.name).toBe('New');
    expect(updated!.description).toBe('orig desc');
    expect(updated!.content).toBe('orig body');
    expect(updated!.enabled).toBe(true);

    const fetched = getSkill(skill.id);
    expect(fetched!.name).toBe('New');
    expect(fetched!.updatedAt).toBeGreaterThanOrEqual(skill.updatedAt);
  });

  it('updateSkill can toggle enabled and replace body', () => {
    const skill = createSkill({
      name: 'S',
      description: 'd',
      body: 'b1',
      source: 'upload',
    });
    const updated = updateSkill(skill.id, { body: 'b2', enabled: false });
    expect(updated!.content).toBe('b2');
    expect(updated!.enabled).toBe(false);
  });

  it('updateSkill returns undefined for unknown id', () => {
    expect(updateSkill('does-not-exist', { name: 'x' })).toBeUndefined();
  });

  it('getSkillMeta returns meta without content', () => {
    const skill = createSkill({
      name: 'M',
      description: 'd',
      body: 'secret body',
      source: 'upload',
    });
    const meta = getSkillMeta(skill.id);
    expect(meta).toBeDefined();
    expect(meta!.name).toBe('M');
    // SkillMeta type has no `content` field; ensure it's not sneakily present.
    expect('content' in meta!).toBe(false);
  });

  it('findByFilePath locates directory skills by path', () => {
    createSkill({
      name: 'Dir',
      description: 'd',
      body: 'b',
      source: 'directory',
      filePath: '/skills/dir.md',
    });
    createSkill({
      name: 'Other',
      description: 'd',
      body: 'b',
      source: 'directory',
      filePath: '/skills/other.md',
    });

    const found = findByFilePath('/skills/dir.md');
    expect(found).toBeDefined();
    expect(found!.name).toBe('Dir');

    expect(findByFilePath('/skills/missing.md')).toBeUndefined();
  });

  it('deleteSkill removes the row and returns true/false appropriately', () => {
    const skill = createSkill({
      name: 'D',
      description: '',
      body: '',
      source: 'upload',
    });
    expect(deleteSkill(skill.id)).toBe(true);
    expect(getSkill(skill.id)).toBeUndefined();
    expect(deleteSkill(skill.id)).toBe(false);
  });
});
