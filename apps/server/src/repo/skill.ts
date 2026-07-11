import type {
  SkillMeta,
  SkillDetail,
  CreateSkillParams,
  UpdateSkillParams,
  SkillSource,
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
}

export interface ListSkillsFilter {
  enabled?: boolean;
  source?: SkillSource;
}

function rowToMeta(row: SkillRow): SkillMeta {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    enabled: Boolean(row.enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    source: row.source as SkillSource,
    filePath: row.file_path ?? undefined,
  };
}

function rowToDetail(row: SkillRow): SkillDetail {
  return {
    ...rowToMeta(row),
    content: row.body,
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
  return rows.map(rowToMeta);
}

export function listEnabledSkills(): SkillMeta[] {
  return listSkills({ enabled: true });
}

export function listSkillsBySource(source: SkillSource): SkillMeta[] {
  return listSkills({ source });
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

export function createSkill(params: CreateSkillParams): SkillDetail {
  const db = getDb();
  const id = generateId();
  const ts = now();
  const enabled = params.enabled ?? true;
  const source: SkillSource = params.source;
  const filePath = params.filePath ?? null;

  db.prepare(
    `INSERT INTO skills (id, name, description, body, source, file_path, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    params.name,
    params.description,
    params.body,
    source,
    filePath,
    enabled ? 1 : 0,
    ts,
    ts,
  );

  return {
    id,
    name: params.name,
    description: params.description,
    content: params.body,
    source,
    filePath: filePath ?? undefined,
    enabled,
    createdAt: ts,
    updatedAt: ts,
  };
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
  const ts = now();

  db.prepare(
    `UPDATE skills
     SET name = ?, description = ?, body = ?, enabled = ?, updated_at = ?
     WHERE id = ?`,
  ).run(name, description, body, enabled ? 1 : 0, ts, id);

  return {
    id,
    name,
    description,
    content: body,
    source: existing.source as SkillSource,
    filePath: existing.file_path ?? undefined,
    enabled,
    createdAt: existing.created_at,
    updatedAt: ts,
  };
}

export function deleteSkill(id: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM skills WHERE id = ?').run(id);
  return result.changes > 0;
}
