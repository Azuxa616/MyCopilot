import type { Model, CreateModelParams, UpdateModelParams } from '@my-copilot/shared';
import { getDb } from '../db/index.js';
import { generateId, now } from './base.js';

interface ModelRow {
  id: string;
  provider_id: string;
  name: string;
  display_name: string | null;
  enabled: number;
  created_at: number;
  updated_at: number;
}

function rowToModel(row: ModelRow): Model {
  return {
    id: row.id,
    providerId: row.provider_id,
    name: row.name,
    displayName: row.display_name ?? undefined,
    enabled: Boolean(row.enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listModelsByProvider(providerId: string): Model[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM models WHERE provider_id = ? ORDER BY created_at DESC')
    .all(providerId) as ModelRow[];
  return rows.map(rowToModel);
}

export function getModel(id: string): Model | undefined {
  const db = getDb();
  const row = db.prepare('SELECT * FROM models WHERE id = ?').get(id) as ModelRow | undefined;
  return row ? rowToModel(row) : undefined;
}

export function createModel(providerId: string, params: Omit<CreateModelParams, 'providerId'>): Model {
  const db = getDb();
  const id = generateId();
  const ts = now();
  const enabled = params.enabled ?? true;
  const displayName = params.displayName ?? null;

  db.prepare(
    `INSERT INTO models (id, provider_id, name, display_name, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, providerId, params.name, displayName, enabled ? 1 : 0, ts, ts);

  return {
    id,
    providerId,
    name: params.name,
    displayName: params.displayName,
    enabled,
    createdAt: ts,
    updatedAt: ts,
  };
}

export function updateModel(id: string, params: UpdateModelParams): Model | undefined {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM models WHERE id = ?').get(id) as ModelRow | undefined;
  if (!existing) return undefined;

  const name = params.name ?? existing.name;
  const displayName = params.displayName !== undefined ? (params.displayName ?? null) : existing.display_name;
  const enabled = params.enabled ?? Boolean(existing.enabled);
  const ts = now();

  db.prepare(
    `UPDATE models SET name = ?, display_name = ?, enabled = ?, updated_at = ? WHERE id = ?`,
  ).run(name, displayName, enabled ? 1 : 0, ts, id);

  return {
    id,
    providerId: existing.provider_id,
    name,
    displayName: displayName ?? undefined,
    enabled,
    createdAt: existing.created_at,
    updatedAt: ts,
  };
}

export function deleteModel(id: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM models WHERE id = ?').run(id);
  return result.changes > 0;
}

export function listAllEnabledModels(): Model[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM models WHERE enabled = 1 ORDER BY created_at DESC')
    .all() as ModelRow[];
  return rows.map(rowToModel);
}
