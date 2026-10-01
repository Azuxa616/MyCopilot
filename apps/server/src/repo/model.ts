import type {
  Model,
  CreateModelParams,
  UpdateModelParams,
  ModelCapabilities,
  CapabilitySource,
  CapabilityState,
} from '@my-copilot/shared';
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
  capabilities: string;
}

/** fail-soft 解析 capabilities JSON；'{}'/坏数据按无记录处理（= 全 unknown）。 */
function parseCapabilities(raw: string): ModelCapabilities | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return undefined;
    }
    const caps = parsed as ModelCapabilities;
    if (caps.vision === undefined && caps.sources === undefined && caps.probedAt === undefined) {
      return undefined; // '{}' 及空对象视为无记录（= unknown）
    }
    return caps;
  } catch {
    return undefined;
  }
}

function rowToModel(row: ModelRow): Model {
  return {
    id: row.id,
    providerId: row.provider_id,
    name: row.name,
    displayName: row.display_name ?? undefined,
    enabled: Boolean(row.enabled),
    capabilities: parseCapabilities(row.capabilities),
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
    capabilities: parseCapabilities(existing.capabilities),
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

/**
 * 写入 vision 能力判定（解析链 / 探测 / 学习闭环 / 手动设置的唯一写入口）。
 *
 * manual 锁：现存 source=manual 且本次来源非 manual 时拒绝写入并原样返回
 * （手动是最终仲裁，永不被自动反写覆盖——设计决策）。
 * 幂等：值与来源均未变化时不写库（避免学习闭环每次请求都 touch updated_at）。
 */
export function setModelVisionCapability(
  id: string,
  state: Exclude<CapabilityState, 'unknown'>,
  source: CapabilitySource,
): Model | undefined {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM models WHERE id = ?').get(id) as ModelRow | undefined;
  if (!existing) return undefined;

  const caps = parseCapabilities(existing.capabilities) ?? {};
  if (caps.sources?.vision === 'manual' && source !== 'manual') {
    return rowToModel(existing); // manual 锁：不覆盖
  }
  if (caps.vision === state && caps.sources?.vision === source) {
    return rowToModel(existing); // 幂等：无变化不写
  }

  const ts = now();
  const next: ModelCapabilities = {
    ...caps,
    vision: state,
    sources: { ...caps.sources, vision: source },
    ...(source === 'probe' ? { probedAt: ts } : {}),
  };
  db.prepare('UPDATE models SET capabilities = ?, updated_at = ? WHERE id = ?').run(
    JSON.stringify(next),
    ts,
    id,
  );
  return getModel(id);
}

/** 清除 vision 能力记录（回到 unknown；主要供设置页解除手动锁定）。 */
export function clearModelVisionCapability(id: string): Model | undefined {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM models WHERE id = ?').get(id) as ModelRow | undefined;
  if (!existing) return undefined;

  const caps = parseCapabilities(existing.capabilities);
  if (!caps || (caps.vision === undefined && caps.sources?.vision === undefined)) {
    return rowToModel(existing); // 已无记录
  }

  // 只摘除 vision 相关键（capabilities 结构为其他能力预留扩展位，不整体清空）
  const next: ModelCapabilities = { ...caps };
  delete next.vision;
  delete next.probedAt;
  if (next.sources) {
    const sources = { ...next.sources };
    delete sources.vision;
    if (Object.keys(sources).length === 0) {
      delete next.sources;
    } else {
      next.sources = sources;
    }
  }

  const ts = now();
  // 摘除后无任何键 → 写 '{}'（parseCapabilities 对空对象返回 undefined，语义 = 全 unknown）
  const json = Object.keys(next).length === 0 ? '{}' : JSON.stringify(next);
  db.prepare('UPDATE models SET capabilities = ?, updated_at = ? WHERE id = ?').run(json, ts, id);
  return getModel(id);
}
