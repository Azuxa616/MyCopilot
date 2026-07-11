import type { Tool, CreateToolParams, UpdateToolParams } from '@my-copilot/shared';
import { getDb } from '../db/index.js';
import { generateId, now } from './base.js';

interface ToolRow {
  id: string;
  name: string;
  description: string;
  input_schema: string;
  type: string;
  danger_level: string;
  source_mcp_id: string | null;
  enabled: number;
  created_at: number;
  updated_at: number;
}

function rowToTool(row: ToolRow): Tool {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    inputSchema: JSON.parse(row.input_schema) as Tool['inputSchema'],
    type: row.type as Tool['type'],
    dangerLevel: row.danger_level as Tool['dangerLevel'],
    enabled: Boolean(row.enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listTools(): Tool[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM tools ORDER BY created_at DESC')
    .all() as ToolRow[];
  return rows.map(rowToTool);
}

export function listEnabledTools(): Tool[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM tools WHERE enabled = 1 ORDER BY created_at DESC')
    .all() as ToolRow[];
  return rows.map(rowToTool);
}

export function getTool(id: string): Tool | undefined {
  const db = getDb();
  const row = db.prepare('SELECT * FROM tools WHERE id = ?').get(id) as ToolRow | undefined;
  return row ? rowToTool(row) : undefined;
}

export function createTool(params: CreateToolParams): Tool {
  const db = getDb();
  const id = generateId();
  const ts = now();
  const enabled = params.enabled ?? true;

  db.prepare(
    `INSERT INTO tools (id, name, description, input_schema, type, danger_level, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    params.name,
    params.description,
    JSON.stringify(params.inputSchema),
    params.type,
    params.dangerLevel,
    enabled ? 1 : 0,
    ts,
    ts,
  );

  return {
    id,
    name: params.name,
    description: params.description,
    inputSchema: params.inputSchema,
    type: params.type,
    dangerLevel: params.dangerLevel,
    enabled,
    createdAt: ts,
    updatedAt: ts,
  };
}

export function updateTool(id: string, params: UpdateToolParams): Tool | undefined {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM tools WHERE id = ?').get(id) as ToolRow | undefined;
  if (!existing) return undefined;

  const name = params.name ?? existing.name;
  const description = params.description ?? existing.description;
  const inputSchema =
    params.inputSchema ?? (JSON.parse(existing.input_schema) as Tool['inputSchema']);
  const type = params.type ?? existing.type;
  const dangerLevel = params.dangerLevel ?? existing.danger_level;
  const enabled = params.enabled ?? Boolean(existing.enabled);
  const ts = now();

  db.prepare(
    `UPDATE tools
     SET name = ?, description = ?, input_schema = ?, type = ?, danger_level = ?, enabled = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    name,
    description,
    JSON.stringify(inputSchema),
    type,
    dangerLevel,
    enabled ? 1 : 0,
    ts,
    id,
  );

  return {
    id,
    name,
    description,
    inputSchema,
    type: type as Tool['type'],
    dangerLevel: dangerLevel as Tool['dangerLevel'],
    enabled,
    createdAt: existing.created_at,
    updatedAt: ts,
  };
}

export function deleteTool(id: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM tools WHERE id = ?').run(id);
  return result.changes > 0;
}
