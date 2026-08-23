import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { createHash } from 'node:crypto';
import type { ParsedSkill } from '@my-copilot/shared';
import { parseSkillMarkdown } from './parser.js';
import {
  SKILL_FILE_MAX_BYTES,
  SKILL_MAX_FILES,
  SKILL_FILES_TOTAL_MAX_BYTES,
  isSkillTextFile,
} from './limits.js';

export interface DiscoveredSkillFile {
  /** 相对 skill 根目录的 posix 风格路径（如 'references/api.md'）。 */
  path: string;
  content: string;
}

export interface DiscoveredSkill {
  filePath: string;
  fileName: string;
  parsed: ParsedSkill;
  hash: string;
  /** 目录包附属文件（平铺形态恒为空数组）。 */
  files: DiscoveredSkillFile[];
}

function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf-8').digest('hex');
}

/**
 * 递归收集 skill 目录包的附属文件。
 * 跳过：SKILL.md 本身、scripts/ 目录、非白名单扩展名、超限文件；
 * 数量/总量到达上限后停止收集。永不 throw，读不出的文件跳过并 warn。
 */
function collectPackFiles(packDir: string): DiscoveredSkillFile[] {
  const results: DiscoveredSkillFile[] = [];
  let totalBytes = 0;

  const walk = (currentDir: string, relDir: string): void => {
    if (results.length >= SKILL_MAX_FILES) return;

    let entries: string[];
    try {
      entries = readdirSync(currentDir);
    } catch (err) {
      console.warn(`[skills] failed to read directory ${currentDir}:`, err);
      return;
    }

    // Process directories first, then files, each sorted alphabetically
    const dirs: string[] = [];
    const files: string[] = [];

    for (const entry of entries.sort()) {
      if (entry === 'SKILL.md' || entry === 'scripts') continue;

      const fullPath = join(currentDir, entry);
      let stat;
      try {
        stat = statSync(fullPath);
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        dirs.push(entry);
      } else if (stat.isFile() && isSkillTextFile(entry)) {
        files.push(entry);
      }
    }

    // Walk directories first
    for (const entry of dirs) {
      if (results.length >= SKILL_MAX_FILES) break;
      const fullPath = join(currentDir, entry);
      const relPath = relDir ? `${relDir}/${entry}` : entry;
      walk(fullPath, relPath);
    }

    // Then process files
    for (const entry of files) {
      if (results.length >= SKILL_MAX_FILES) break;
      if (entry === 'SKILL.md' || entry === 'scripts') continue;

      const fullPath = join(currentDir, entry);
      const relPath = relDir ? `${relDir}/${entry}` : entry;

      let stat;
      try {
        stat = statSync(fullPath);
      } catch {
        continue;
      }

      if (stat.size > SKILL_FILE_MAX_BYTES) {
        console.warn(`[skills] skipped oversized file ${fullPath} (${stat.size} bytes)`);
        continue;
      }
      if (totalBytes + stat.size > SKILL_FILES_TOTAL_MAX_BYTES) {
        console.warn(`[skills] skipped ${fullPath}: total size limit reached`);
        continue;
      }

      try {
        const content = readFileSync(fullPath, 'utf-8');
        results.push({ path: relPath, content });
        totalBytes += stat.size;
      } catch (err) {
        console.warn(`[skills] failed to read ${fullPath}:`, err);
      }
    }
  };

  walk(packDir, '');
  return results;
}

/**
 * Scan a directory for skills. Two layouts are recognized (设计文档支柱一):
 *
 * 1. 目录包：`<dir>/<skill-name>/SKILL.md`（+ 附属文件，递归收集）
 * 2. 平铺（旧形态，行为不变）：`<dir>/*.md`
 *
 * - Missing directory → returns [] (never throws).
 * - Entry files/packs without a usable frontmatter `name` are skipped.
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

  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    console.warn(`[skills] failed to read directory ${dir}:`, err);
    return [];
  }

  const results: DiscoveredSkill[] = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      // 目录包形态：<name>/SKILL.md
      const packDir = join(dir, entry.name);
      const skillMdPath = join(packDir, 'SKILL.md');
      if (!existsSync(skillMdPath)) continue;

      let raw: string;
      try {
        raw = readFileSync(skillMdPath, 'utf-8');
      } catch (err) {
        console.warn(`[skills] failed to read ${skillMdPath}:`, err);
        continue;
      }

      const parsed = parseSkillMarkdown(raw);
      if (!parsed.frontmatter.name) continue;

      results.push({
        filePath: skillMdPath,
        fileName: 'SKILL.md',
        parsed,
        hash: sha256(raw),
        files: collectPackFiles(packDir),
      });
      continue;
    }

    if (!entry.isFile()) continue;
    if (!entry.name.toLowerCase().endsWith('.md')) continue;

    // 平铺形态（旧行为，files 恒为空）
    const filePath = join(dir, entry.name);

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
    if (!parsed.frontmatter.name) {
      continue;
    }

    results.push({
      filePath,
      fileName: basename(filePath),
      parsed,
      hash: sha256(raw),
      files: [],
    });
  }

  return results;
}