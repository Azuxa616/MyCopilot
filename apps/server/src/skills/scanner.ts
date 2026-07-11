import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { createHash } from 'node:crypto';
import type { ParsedSkill } from '@my-copilot/shared';
import { parseSkillMarkdown } from './parser.js';

export interface DiscoveredSkill {
  filePath: string;
  fileName: string;
  parsed: ParsedSkill;
  hash: string;
}

/**
 * Scan a directory for `*.md` skill files and parse each one.
 *
 * - Missing directory → returns [] (never throws).
 * - Files with empty `name` in frontmatter are skipped (invalid skill).
 * - Unreadable files are skipped (logged via console.warn).
 */
export function scanSkillDirectory(dir: string): DiscoveredSkill[] {
  if (!existsSync(dir)) {
    return [];
  }

  let dirStat;
  try {
    dirStat = statSync(dir);
  } catch {
    return [];
  }
  if (!dirStat.isDirectory()) {
    return [];
  }

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch (err) {
    console.warn(`[skills] failed to read directory ${dir}:`, err);
    return [];
  }

  const results: DiscoveredSkill[] = [];

  for (const entry of entries) {
    if (!entry.toLowerCase().endsWith('.md')) continue;

    const filePath = join(dir, entry);

    let stat;
    try {
      stat = statSync(filePath);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;

    let raw: string;
    try {
      raw = readFileSync(filePath, 'utf-8');
    } catch (err) {
      console.warn(`[skills] failed to read ${filePath}:`, err);
      continue;
    }

    const parsed = parseSkillMarkdown(raw);

    // Skip files without a usable name in frontmatter.
    if (!parsed.frontmatter.name) {
      continue;
    }

    const hash = sha256(raw);

    results.push({
      filePath,
      fileName: basename(filePath),
      parsed,
      hash,
    });
  }

  return results;
}

function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf-8').digest('hex');
}
