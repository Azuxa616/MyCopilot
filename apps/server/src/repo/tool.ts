import type {
  Tool,
  CreateToolParams,
  SafetyLevel,
  UpdateToolParams,
} from '@my-copilot/shared';
import { getDb } from '../db/index.js';
import { generateId, now } from './base.js';

interface ToolRow {
  id: string;
  name: string;
  description: string;
  input_schema: string;
  type: string;
  safety_level: string;
  source_mcp_id: string | null;
  policy_version: string;
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
    safetyLevel: row.safety_level as Tool['safetyLevel'],
    sourceMcpId: row.source_mcp_id,
    policyVersion: row.policy_version,
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

export function getToolsByName(name: string): Tool[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM tools WHERE name = ?').all(name) as ToolRow[];
  return rows.map(rowToTool);
}

function assertValidSafetyLevel(type: Tool['type'], level: SafetyLevel): void {
  if (type === 'mcp-provided' && level === 'safe') {
    throw new Error('MCP-provided tools must be restricted or danger');
  }
}

export function createTool(params: CreateToolParams): Tool {
  const db = getDb();
  const id = generateId();
  const ts = now();
  const enabled = params.enabled ?? true;
  assertValidSafetyLevel(params.type, params.safetyLevel);
  const policyVersion = generateId();

  db.prepare(
    `INSERT INTO tools (
       id, name, description, input_schema, type, safety_level,
       source_mcp_id, policy_version, enabled, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    params.name,
    params.description,
    JSON.stringify(params.inputSchema),
    params.type,
    params.safetyLevel,
    params.sourceMcpId ?? null,
    policyVersion,
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
    safetyLevel: params.safetyLevel,
    sourceMcpId: params.sourceMcpId ?? null,
    policyVersion,
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
  const safetyLevel = params.safetyLevel ?? existing.safety_level;
  const sourceMcpId = params.sourceMcpId ?? existing.source_mcp_id;
  const enabled = params.enabled ?? Boolean(existing.enabled);
  const ts = now();
  assertValidSafetyLevel(type as Tool['type'], safetyLevel as SafetyLevel);
  const policyVersion = generateId();

  db.prepare(
    `UPDATE tools
     SET name = ?, description = ?, input_schema = ?, type = ?, safety_level = ?,
         source_mcp_id = ?, policy_version = ?, enabled = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    name,
    description,
    JSON.stringify(inputSchema),
    type,
    safetyLevel,
    sourceMcpId,
    policyVersion,
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
    safetyLevel: safetyLevel as Tool['safetyLevel'],
    sourceMcpId,
    policyVersion,
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

export interface McpToolSyncResult {
  created: number;
  updated: number;
  disabled: number;
  tools: Tool[];
}

export function syncMcpTools(
  mcpId: string,
  discoveredTools: Tool[],
): McpToolSyncResult {
  const db = getDb();
  const timestamp = now();
  const existingRows = db
    .prepare("SELECT * FROM tools WHERE type = 'mcp-provided' AND source_mcp_id = ?")
    .all(mcpId) as ToolRow[];
  const existingByName = new Map(existingRows.map((row) => [row.name, row]));
  const discoveredNames = new Set(discoveredTools.map((tool) => tool.name));
  let created = 0;
  let updated = 0;

  const sync = db.transaction(() => {
    for (const discovered of discoveredTools) {
      const existing = existingByName.get(discovered.name);
      const policyVersion = generateId();
      if (existing) {
        db.prepare(
          `UPDATE tools
           SET description = ?, input_schema = ?, safety_level = ?,
               policy_version = ?, updated_at = ?
           WHERE id = ?`,
        ).run(
          discovered.description,
          JSON.stringify(discovered.inputSchema),
          existing.safety_level === 'danger' ? 'danger' : 'restricted',
          policyVersion,
          timestamp,
          existing.id,
        );
        updated++;
      } else {
        db.prepare(
          `INSERT INTO tools (
             id, name, description, input_schema, type, safety_level,
             source_mcp_id, policy_version, enabled, created_at, updated_at
           ) VALUES (?, ?, ?, ?, 'mcp-provided', 'restricted', ?, ?, 1, ?, ?)`,
        ).run(
          generateId(),
          discovered.name,
          discovered.description,
          JSON.stringify(discovered.inputSchema),
          mcpId,
          policyVersion,
          timestamp,
          timestamp,
        );
        created++;
      }
    }

    const missingIds = existingRows
      .filter((row) => !discoveredNames.has(row.name) && row.enabled === 1)
      .map((row) => row.id);
    for (const id of missingIds) {
      db.prepare(
        'UPDATE tools SET enabled = 0, policy_version = ?, updated_at = ? WHERE id = ?',
      ).run(generateId(), timestamp, id);
    }
    return missingIds.length;
  });

  const disabled = sync();
  return {
    created,
    updated,
    disabled,
    tools: listTools().filter(
      (tool) => tool.type === 'mcp-provided' && tool.sourceMcpId === mcpId,
    ),
  };
}

export function disableToolsByMcp(mcpId: string): number {
  return getDb()
    .prepare(
      `UPDATE tools SET enabled = 0, policy_version = ?, updated_at = ?
       WHERE type = 'mcp-provided' AND source_mcp_id = ? AND enabled = 1`,
    )
    .run(generateId(), now(), mcpId).changes;
}

export function deleteToolsByMcp(mcpId: string): number {
  return getDb()
    .prepare("DELETE FROM tools WHERE type = 'mcp-provided' AND source_mcp_id = ?")
    .run(mcpId).changes;
}
