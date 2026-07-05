import type { Provider, CreateProviderParams, UpdateProviderParams } from '@my-copilot/shared';
import { getDb } from '../db/index.js';
import { generateId, now } from './base.js';

interface ProviderRow {
  id: string;
  name: string;
  type: string;
  base_url: string;
  api_key: string;
  enabled: number;
  created_at: number;
  updated_at: number;
}

function rowToProvider(row: ProviderRow): Provider {
  return {
    id: row.id,
    name: row.name,
    type: row.type as Provider['type'],
    baseUrl: row.base_url,
    apiKey: row.api_key,
    enabled: Boolean(row.enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listProviders(): Provider[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM providers ORDER BY created_at DESC')
    .all() as ProviderRow[];
  return rows.map(rowToProvider);
}

export function getProvider(id: string): Provider | undefined {
  const db = getDb();
  const row = db.prepare('SELECT * FROM providers WHERE id = ?').get(id) as ProviderRow | undefined;
  return row ? rowToProvider(row) : undefined;
}

export function createProvider(params: CreateProviderParams): Provider {
  const db = getDb();
  const id = generateId();
  const ts = now();
  const enabled = params.enabled ?? true;

  db.prepare(
    `INSERT INTO providers (id, name, type, base_url, api_key, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, params.name, params.type, params.baseUrl, params.apiKey, enabled ? 1 : 0, ts, ts);

  return {
    id,
    name: params.name,
    type: params.type,
    baseUrl: params.baseUrl,
    apiKey: params.apiKey,
    enabled,
    createdAt: ts,
    updatedAt: ts,
  };
}

export function updateProvider(id: string, params: UpdateProviderParams): Provider | undefined {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM providers WHERE id = ?').get(id) as ProviderRow | undefined;
  if (!existing) return undefined;

  const name = params.name ?? existing.name;
  const type = params.type ?? existing.type;
  const baseUrl = params.baseUrl ?? existing.base_url;
  const apiKey = params.apiKey ?? existing.api_key;
  const enabled = params.enabled ?? Boolean(existing.enabled);
  const ts = now();

  db.prepare(
    `UPDATE providers
     SET name = ?, type = ?, base_url = ?, api_key = ?, enabled = ?, updated_at = ?
     WHERE id = ?`,
  ).run(name, type, baseUrl, apiKey, enabled ? 1 : 0, ts, id);

  return {
    id,
    name,
    type: type as Provider['type'],
    baseUrl,
    apiKey,
    enabled,
    createdAt: existing.created_at,
    updatedAt: ts,
  };
}

export function deleteProvider(id: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM providers WHERE id = ?').run(id);
  return result.changes > 0;
}
