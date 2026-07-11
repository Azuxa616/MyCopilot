import type {
  Mcp,
  McpConfig,
  McpTransport,
  CreateMcpParams,
  UpdateMcpParams,
} from '@my-copilot/shared';
import { getDb } from '../db/index.js';
import { generateId, now } from './base.js';

interface McpRow {
  id: string;
  name: string;
  description: string;
  transport: string;
  command: string | null;
  args: string;
  env: string;
  url: string | null;
  enabled: number;
  last_connected_at: number | null;
  created_at: number;
  updated_at: number;
}

function rowToMcp(row: McpRow): Mcp {
  const config: McpConfig = {
    transport: row.transport as McpTransport,
  };
  if (row.command !== null) config.command = row.command;
  const args = JSON.parse(row.args) as string[];
  if (args.length > 0) config.args = args;
  const env = JSON.parse(row.env) as Record<string, string>;
  if (Object.keys(env).length > 0) config.env = env;
  if (row.url !== null) config.url = row.url;

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    config,
    enabled: Boolean(row.enabled),
    lastConnectedAt: row.last_connected_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function configToColumns(config: McpConfig): {
  transport: McpTransport;
  command: string | null;
  args: string;
  env: string;
  url: string | null;
} {
  return {
    transport: config.transport,
    command: config.command ?? null,
    args: JSON.stringify(config.args ?? []),
    env: JSON.stringify(config.env ?? {}),
    url: config.url ?? null,
  };
}

export function listMcps(filter?: { enabled?: boolean }): Mcp[] {
  const db = getDb();
  if (filter?.enabled !== undefined) {
    const rows = db
      .prepare('SELECT * FROM mcps WHERE enabled = ? ORDER BY created_at DESC')
      .all(filter.enabled ? 1 : 0) as McpRow[];
    return rows.map(rowToMcp);
  }
  const rows = db
    .prepare('SELECT * FROM mcps ORDER BY created_at DESC')
    .all() as McpRow[];
  return rows.map(rowToMcp);
}

export function listEnabledMcps(): Mcp[] {
  return listMcps({ enabled: true });
}

export function getMcp(id: string): Mcp | undefined {
  const db = getDb();
  const row = db.prepare('SELECT * FROM mcps WHERE id = ?').get(id) as McpRow | undefined;
  return row ? rowToMcp(row) : undefined;
}

export const getMcpById = getMcp;

export function createMcp(params: CreateMcpParams): Mcp {
  const db = getDb();
  const id = generateId();
  const ts = now();
  const enabled = params.enabled ?? true;
  const cols = configToColumns(params.config);

  db.prepare(
    `INSERT INTO mcps (id, name, description, transport, command, args, env, url, enabled, last_connected_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
  ).run(
    id,
    params.name,
    params.description,
    cols.transport,
    cols.command,
    cols.args,
    cols.env,
    cols.url,
    enabled ? 1 : 0,
    ts,
    ts,
  );

  return {
    id,
    name: params.name,
    description: params.description,
    config: { ...params.config },
    enabled,
    lastConnectedAt: undefined,
    createdAt: ts,
    updatedAt: ts,
  };
}

export function updateMcp(id: string, params: UpdateMcpParams): Mcp | undefined {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM mcps WHERE id = ?').get(id) as McpRow | undefined;
  if (!existing) return undefined;

  const name = params.name ?? existing.name;
  const description = params.description ?? existing.description;
  const config = params.config ?? rowToMcp(existing).config;
  const enabled = params.enabled ?? Boolean(existing.enabled);
  const ts = now();
  const cols = configToColumns(config);

  db.prepare(
    `UPDATE mcps
     SET name = ?, description = ?, transport = ?, command = ?, args = ?, env = ?, url = ?, enabled = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    name,
    description,
    cols.transport,
    cols.command,
    cols.args,
    cols.env,
    cols.url,
    enabled ? 1 : 0,
    ts,
    id,
  );

  return {
    id,
    name,
    description,
    config,
    enabled,
    lastConnectedAt: existing.last_connected_at ?? undefined,
    createdAt: existing.created_at,
    updatedAt: ts,
  };
}

export function deleteMcp(id: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM mcps WHERE id = ?').run(id);
  return result.changes > 0;
}
