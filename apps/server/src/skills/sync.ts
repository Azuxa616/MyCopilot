import type Database from 'better-sqlite3';
import { scanSkillDirectory, type DiscoveredSkill } from './scanner.js';
import {
  findByFilePath,
  createSkill,
  updateSkill,
  deleteSkill,
  listSkillsBySource,
  listSkillFiles,
  getSkillFile,
} from '../repo/skill.js';

export interface SyncResult {
  created: number;
  updated: number;
  skipped: number;
  deleted: number;
  filesCreated: number;
  filesUpdated: number;
  filesDeleted: number;
}

/** 比较磁盘发现的附属文件与 DB 现状，产出计数（不执行写入）。 */
function diffSkillFiles(
  skillId: string,
  discovered: DiscoveredSkill['files'],
): { changed: boolean; created: number; updated: number; deleted: number } {
  const existing = listSkillFiles(skillId);
  const existingPaths = new Set(existing.map((f) => f.path));
  const discoveredPaths = new Set(discovered.map((f) => f.path));

  let created = 0;
  let updated = 0;
  for (const file of discovered) {
    if (!existingPaths.has(file.path)) {
      created += 1;
      continue;
    }
    const row = getSkillFile(skillId, file.path);
    if (!row || row.content !== file.content) updated += 1;
  }
  const deleted = existing.filter((f) => !discoveredPaths.has(f.path)).length;

  return { changed: created + updated + deleted > 0, created, updated, deleted };
}

/**
 * Synchronize skills from a directory into the database.
 *
 * - New files (file_path not in DB) → create with source='directory'.
 * - Existing files where name/description/body changed → update.
 * - Existing files unchanged → skip.
 * - DB directory-skills whose file no longer exists → delete.
 *
 * Never throws — broken files are filtered out by the scanner. If the
 * directory is missing, all directory-skills are removed.
 */
export function syncDirectorySkills(
  db: Database.Database,
  dir: string,
): SyncResult {
  // Touch db so callers must pass it (consistent with repo pattern); we still
  // route reads/writes through the global repo functions to honor getDb().
  void db;

  const discovered = scanSkillDirectory(dir);
  const discoveredByPath = new Map<string, DiscoveredSkill>();
  for (const d of discovered) discoveredByPath.set(d.filePath, d);

  const existing = listSkillsBySource('directory');
  const existingByPath = new Map<string, (typeof existing)[number]>();
  for (const e of existing) {
    if (e.filePath) existingByPath.set(e.filePath, e);
  }

  const result: SyncResult = { created: 0, updated: 0, skipped: 0, deleted: 0, filesCreated: 0, filesUpdated: 0, filesDeleted: 0 };

  // Process discovered files: create or update.
  for (const disc of discovered) {
    const current = disc.parsed.frontmatter.name ? existingByPath.get(disc.filePath) : undefined;

    if (!current) {
      createSkill({
        name: disc.parsed.frontmatter.name,
        description: disc.parsed.frontmatter.description,
        body: disc.parsed.body,
        source: 'directory',
        filePath: disc.filePath,
        triggers: disc.parsed.frontmatter.triggers,
        files: disc.files,
      });
      result.created += 1;
      result.filesCreated += disc.files.length;
      continue;
    }

    const detail = findByFilePath(disc.filePath);
    const fileDiff = diffSkillFiles(current.id, disc.files);
    // triggers 数组按值比较（引用比较恒不等）；缺省与空数组视为相同。
    const triggersChanged =
      JSON.stringify(detail?.triggers ?? []) !==
      JSON.stringify(disc.parsed.frontmatter.triggers ?? []);
    const contentChanged =
      !detail ||
      detail.name !== disc.parsed.frontmatter.name ||
      detail.description !== disc.parsed.frontmatter.description ||
      detail.content !== disc.parsed.body ||
      triggersChanged ||
      fileDiff.changed;

    if (!contentChanged) {
      result.skipped += 1;
      continue;
    }

    updateSkill(current.id, {
      name: disc.parsed.frontmatter.name,
      description: disc.parsed.frontmatter.description,
      body: disc.parsed.body,
      triggers: disc.parsed.frontmatter.triggers ?? [],
      files: disc.files,
    });
    result.updated += 1;
    result.filesCreated += fileDiff.created;
    result.filesUpdated += fileDiff.updated;
    result.filesDeleted += fileDiff.deleted;
  }

  // Remove DB directory-skills whose file is gone.
  for (const [filePath, row] of existingByPath) {
    if (!discoveredByPath.has(filePath)) {
      const ok = deleteSkill(row.id);
      if (ok) result.deleted += 1;
    }
  }

  return result;
}
