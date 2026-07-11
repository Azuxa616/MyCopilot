import type Database from 'better-sqlite3';
import { scanSkillDirectory, type DiscoveredSkill } from './scanner.js';
import {
  findByFilePath,
  createSkill,
  updateSkill,
  deleteSkill,
  listSkillsBySource,
} from '../repo/skill.js';

export interface SyncResult {
  created: number;
  updated: number;
  skipped: number;
  deleted: number;
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

  const result: SyncResult = { created: 0, updated: 0, skipped: 0, deleted: 0 };

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
      });
      result.created += 1;
      continue;
    }

    const detail = findByFilePath(disc.filePath);
    const contentChanged =
      !detail ||
      detail.name !== disc.parsed.frontmatter.name ||
      detail.description !== disc.parsed.frontmatter.description ||
      detail.content !== disc.parsed.body;

    if (!contentChanged) {
      result.skipped += 1;
      continue;
    }

    updateSkill(current.id, {
      name: disc.parsed.frontmatter.name,
      description: disc.parsed.frontmatter.description,
      body: disc.parsed.body,
    });
    result.updated += 1;
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
