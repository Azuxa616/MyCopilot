import type {
  SkillMeta,
  SkillDetail,
  CreateSkillParams,
  UpdateSkillParams,
  SkillSource,
  SkillFileMeta,
  SkillFileInput,
} from '@my-copilot/shared';
import { getDb } from '../db/index.js';
import { generateId, now } from './base.js';

interface SkillRow {
  id: string;
  name: string;
  description: string;
  body: string;
  source: string;
  file_path: string | null;
  enabled: number;
  created_at: number;
  updated_at: number;
  triggers: string;
}

interface SkillFileRow {
  id: string;
  skill_id: string;
  path: string;
  content: string;
  created_at: number;
  updated_at: number;
}

export interface ListSkillsFilter {
  enabled?: boolean;
  source?: SkillSource;
}

function parseTriggers(raw: string): string[] | undefined {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((t) => typeof t === 'string') && parsed.length > 0) {
      return parsed;
    }
  } catch {
    // fallthrough: 坏数据按"无 triggers"处理
  }
  return undefined;
}

/** 全量替换某 skill 的附属文件（DELETE + INSERT）。 */
function replaceSkillFiles(skillId: string, files: SkillFileInput[]): void {
  const db = getDb();
  const ts = now();
  db.prepare('DELETE FROM skill_files WHERE skill_id = ?').run(skillId);
  const insert = db.prepare(
    `INSERT INTO skill_files (id, skill_id, path, content, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const f of files) {
    insert.run(generateId(), skillId, f.path, f.content, ts, ts);
  }
}

function listSkillFileRows(skillId: string): SkillFileRow[] {
  return getDb()
    .prepare('SELECT * FROM skill_files WHERE skill_id = ? ORDER BY path')
    .all(skillId) as SkillFileRow[];
}

function rowToMeta(row: SkillRow, fileCount = 0): SkillMeta {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    enabled: Boolean(row.enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    source: row.source as SkillSource,
    filePath: row.file_path ?? undefined,
    triggers: parseTriggers(row.triggers),
    fileCount,
  };
}

function rowToDetail(row: SkillRow): SkillDetail {
  const fileRows = listSkillFileRows(row.id);
  return {
    ...rowToMeta(row, fileRows.length),
    content: row.body,
    files: fileRows.map((f) => ({ path: f.path, size: f.content.length })),
  };
}

export function listSkills(filter?: ListSkillsFilter): SkillMeta[] {
  const db = getDb();
  const clauses: string[] = [];
  const params: (string | number)[] = [];

  if (filter?.enabled !== undefined) {
    clauses.push('enabled = ?');
    params.push(filter.enabled ? 1 : 0);
  }
  if (filter?.source !== undefined) {
    clauses.push('source = ?');
    params.push(filter.source);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db
    .prepare(`SELECT * FROM skills ${where} ORDER BY created_at DESC`)
    .all(...params) as SkillRow[];

  const counts = new Map(
    (
      db
        .prepare('SELECT skill_id, COUNT(*) as n FROM skill_files GROUP BY skill_id')
        .all() as Array<{ skill_id: string; n: number }>
    ).map((r) => [r.skill_id, r.n]),
  );
  return rows.map((row) => rowToMeta(row, counts.get(row.id) ?? 0));
}

export function listEnabledSkills(): SkillMeta[] {
  return listSkills({ enabled: true });
}

export function listSkillsBySource(source: SkillSource): SkillMeta[] {
  return listSkills({ source });
}

/** 按插件 id + name 查找该插件贡献的 Skill 行（插件 skills 桥幂等 upsert 用）。 */
export function findSkillByPluginAndName(
  pluginId: string,
  name: string,
): SkillMeta | undefined {
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM skills WHERE source_plugin_id = ? AND name = ?')
    .get(pluginId, name) as SkillRow | undefined;
  return row ? rowToMeta(row) : undefined;
}

export function getSkill(id: string): SkillDetail | undefined {
  const db = getDb();
  const row = db.prepare('SELECT * FROM skills WHERE id = ?').get(id) as SkillRow | undefined;
  return row ? rowToDetail(row) : undefined;
}

export function getSkillMeta(id: string): SkillMeta | undefined {
  const db = getDb();
  const row = db.prepare('SELECT * FROM skills WHERE id = ?').get(id) as SkillRow | undefined;
  return row ? rowToMeta(row) : undefined;
}

export function findByFilePath(filePath: string): SkillDetail | undefined {
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM skills WHERE file_path = ? AND source = ?')
    .get(filePath, 'directory') as SkillRow | undefined;
  return row ? rowToDetail(row) : undefined;
}

/**
 * 入参在 CreateSkillParams 基础上扩展可选 sourcePluginId（插件 provides.skills
 * 桥接写入，DB 列见迁移 0005_plugins.sql）；普通调用方不传即写 NULL。
 */
export function createSkill(
  params: CreateSkillParams & { sourcePluginId?: string },
): SkillDetail {
  const db = getDb();
  const id = generateId();
  const ts = now();
  const enabled = params.enabled ?? true;
  const source: SkillSource = params.source;
  const filePath = params.filePath ?? null;
  const sourcePluginId = params.sourcePluginId ?? null;

  db.prepare(
    `INSERT INTO skills (id, name, description, body, source, file_path, source_plugin_id, enabled, triggers, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    params.name,
    params.description,
    params.body,
    source,
    filePath,
    sourcePluginId,
    enabled ? 1 : 0,
    params.triggers ? JSON.stringify(params.triggers) : '[]',
    ts,
    ts,
  );

  if (params.files && params.files.length > 0) {
    replaceSkillFiles(id, params.files);
  }

  return getSkill(id)!;
}

export function updateSkill(
  id: string,
  params: UpdateSkillParams,
): SkillDetail | undefined {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM skills WHERE id = ?').get(id) as SkillRow | undefined;
  if (!existing) return undefined;

  const name = params.name ?? existing.name;
  const description = params.description ?? existing.description;
  const body = params.body ?? existing.body;
  const enabled =
    params.enabled !== undefined ? params.enabled : Boolean(existing.enabled);
  const triggersRaw =
    params.triggers !== undefined ? JSON.stringify(params.triggers) : existing.triggers;
  const ts = now();

  db.prepare(
    `UPDATE skills
     SET name = ?, description = ?, body = ?, enabled = ?, triggers = ?, updated_at = ?
     WHERE id = ?`,
  ).run(name, description, body, enabled ? 1 : 0, triggersRaw, ts, id);

  if (params.files !== undefined) {
    replaceSkillFiles(id, params.files);
  }

  return getSkill(id);
}

export function deleteSkill(id: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM skills WHERE id = ?').run(id);
  return result.changes > 0;
}

/** 删除某插件贡献的全部 Skill 行（uninstall 用）；返回删除的行数。 */
export function deleteSkillsByPlugin(pluginId: string): number {
  const db = getDb();
  const result = db.prepare('DELETE FROM skills WHERE source_plugin_id = ?').run(pluginId);
  return result.changes;
}

export function listSkillFiles(skillId: string): SkillFileMeta[] {
  return listSkillFileRows(skillId).map((f) => ({ path: f.path, size: f.content.length }));
}

export function getSkillFile(
  skillId: string,
  path: string,
): { path: string; content: string } | undefined {
  const row = getDb()
    .prepare('SELECT * FROM skill_files WHERE skill_id = ? AND path = ?')
    .get(skillId, path) as SkillFileRow | undefined;
  return row ? { path: row.path, content: row.content } : undefined;
}
