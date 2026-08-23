-- Plugin system: registry, per-plugin data store, lifecycle event log.
-- Spec: docs/rfc/plugin-manifest-lifecycle.md (§6 plugin_data schema, lifecycle-event schema).

-- (a) Plugin registry. id = manifest `name` (stable PluginId), manifest holds
-- the full JSON snapshot at install time.
CREATE TABLE plugins (
  id TEXT PRIMARY KEY,
  version TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('official', 'community')),
  state TEXT NOT NULL CHECK (
    state IN (
      'discovered', 'downloaded', 'verified',
      'installed', 'enabled', 'disabled', 'uninstalled'
    )
  ),
  type TEXT,
  manifest TEXT NOT NULL,
  digest TEXT,
  directory TEXT NOT NULL,
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- (b) Per-plugin key/value store (RFC §6). No FK to plugins — rows survive
-- their plugin row and are scoped by (plugin_id, key).
CREATE TABLE plugin_data (
  plugin_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_plugin_data_id_key ON plugin_data(plugin_id, key);

-- (c) Lifecycle transition audit log. `type` is 1:1 with `to_state`
-- (lifecycle-event schema required fields). `from_state` NULL = first
-- transition. `result` is the JSON of TransitionResult {status, errorCode?,
-- errorMessage?}.
CREATE TABLE plugin_lifecycle_events (
  id TEXT PRIMARY KEY,
  plugin_id TEXT NOT NULL,
  from_state TEXT,
  to_state TEXT NOT NULL,
  type TEXT NOT NULL,
  trigger TEXT NOT NULL,
  version TEXT NOT NULL,
  result TEXT NOT NULL,
  payload TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_plugin_lifecycle_events_plugin ON plugin_lifecycle_events(plugin_id);

-- (d) mcps: track which plugin contributed the MCP server.
ALTER TABLE mcps ADD COLUMN source_plugin_id TEXT;
CREATE INDEX idx_mcps_source_plugin ON mcps(source_plugin_id);

-- (e) skills: CHECK gains 'plugin' + provenance column. SQLite cannot alter
-- a CHECK via ALTER TABLE, so rebuild (0003 pattern). agent_skills has no FK
-- to skills (0001:75-79), so the rebuild is safe. idx_skills_source (0001:50)
-- is dropped with the table and must be recreated.
CREATE TABLE skills_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL CHECK (source IN ('directory', 'upload', 'plugin')),
  file_path TEXT,
  source_plugin_id TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT INTO skills_new (
  id, name, description, body, source, file_path, source_plugin_id,
  enabled, created_at, updated_at
)
SELECT
  id, name, description, body, source, file_path, NULL,
  enabled, created_at, updated_at
FROM skills;

DROP TABLE skills;
ALTER TABLE skills_new RENAME TO skills;
CREATE INDEX idx_skills_source ON skills(source);
CREATE INDEX idx_skills_source_plugin ON skills(source_plugin_id);

-- (f) tools: track which plugin contributed the tool.
ALTER TABLE tools ADD COLUMN source_plugin_id TEXT;
