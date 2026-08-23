/**
 * Plugin lifecycle repository —— 生命周期事件审计日志（插件系统 T3）。
 *
 * `plugin_lifecycle_events` 每行记录一次状态转换尝试：`from_state` 为
 * NULL 表示首次转换，`result` 是 TransitionResult 对象的 JSON
 * （{status, errorCode?, errorMessage?}），`type` 与 `to_state` 1:1
 * （lifecycle-event schema required 字段）。
 *
 * 表结构见迁移 `0005_plugins.sql`。
 */
import type {
  LifecycleState,
  LifecycleTrigger,
  PluginLifecycleEvent,
  TransitionResult,
} from '@my-copilot/shared';
import { getDb } from '../db/index.js';
import { generateId, now } from './base.js';

interface LifecycleEventRow {
  id: string;
  plugin_id: string;
  from_state: string | null;
  to_state: string;
  type: string;
  trigger: string;
  version: string;
  result: string;
  payload: string | null;
  created_at: number;
}

function rowToEvent(row: LifecycleEventRow): PluginLifecycleEvent {
  const event: PluginLifecycleEvent = {
    eventId: row.id,
    type: row.type as LifecycleState,
    pluginId: row.plugin_id,
    version: row.version,
    timestamp: row.created_at,
    fromState: row.from_state as LifecycleState | null,
    toState: row.to_state as LifecycleState,
    trigger: row.trigger as LifecycleTrigger,
    result: JSON.parse(row.result) as TransitionResult,
  };
  if (row.payload !== null) {
    event.payload = JSON.parse(row.payload) as Record<string, unknown>;
  }
  return event;
}

export interface RecordEventParams {
  pluginId: string;
  /** 转换前状态；首次转换为 null。 */
  fromState: LifecycleState | null;
  toState: LifecycleState;
  /** 事件类型，与 toState 1:1。 */
  type: LifecycleState;
  trigger: LifecycleTrigger;
  version: string;
  result: TransitionResult;
  payload?: Record<string, unknown>;
}

/** 追加一条生命周期事件并返回落库后的完整记录。 */
export function recordEvent(params: RecordEventParams): PluginLifecycleEvent {
  const db = getDb();
  const id = generateId();
  const ts = now();

  db.prepare(
    `INSERT INTO plugin_lifecycle_events
       (id, plugin_id, from_state, to_state, type, trigger, version, result, payload, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    params.pluginId,
    params.fromState,
    params.toState,
    params.type,
    params.trigger,
    params.version,
    JSON.stringify(params.result),
    params.payload !== undefined ? JSON.stringify(params.payload) : null,
    ts,
  );

  const row = db
    .prepare('SELECT * FROM plugin_lifecycle_events WHERE id = ?')
    .get(id) as LifecycleEventRow;
  return rowToEvent(row);
}

/** 列出某插件的全部事件，按 created_at 倒序（最新在前）。 */
export function listEventsByPlugin(pluginId: string): PluginLifecycleEvent[] {
  const db = getDb();
  const rows = db
    .prepare(
      'SELECT * FROM plugin_lifecycle_events WHERE plugin_id = ? ORDER BY created_at DESC',
    )
    .all(pluginId) as LifecycleEventRow[];
  return rows.map(rowToEvent);
}
