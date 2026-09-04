# DIY Agent 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用户可创建自定义 Agent（systemPrompt + 模型 + 工具/技能/MCP 白名单），会话级绑定后由现有 agent loop 按白名单执行。

**Architecture:** 复活既有的 `Agent` 类型与三张绑定表（新增 `agents` 主表，迁移 0004）。新增 `resolveAgentContext()` 作为唯一白名单解析点，同步模式（lifecycle）与异步模式（worker）共用。不改 SSE 协议、不改 runner 循环逻辑、不动审批流。

**Tech Stack:** Hono 4 + better-sqlite3（server）、React 19 + Zustand（web）、Vitest（双环境）、`@my-copilot/shared` 类型。

**规格来源:** `docs/2026-08-15-diy-agent-design.md`（已获用户批准）

**关键设计决策（已锁定）:**
- 绑定语义 = 纯白名单：有效工具 = `(绑定的 tool id ∪ 绑定 MCP server 的工具) ∩ 全局启用`
- `agent_tools` 绑定键为 `Tool.id`；内置工具不入 `tools` 表，故 0004 迁移**移除** `tool_id → tools(id)` 外键
- `agent.modelId` 覆盖会话模型；模型不存在 → 回退会话模型 + `console.warn`
- `enabled` 只影响新建会话的选择器；已绑定会话继续可用
- `parameters`（temperature/maxTokens/topP）透传给 adapter 的 `AdapterStreamOptions`
- 顺带补齐现状缺口：skills 注入链路（lifecycle/worker 从未传 `skills` 给 runner）

**命令约定（均在仓库根 `F:\MyProjects\MyCopilot` 执行）:**
- 定向测试：`pnpm --filter server exec vitest run <路径>` / `pnpm --filter web exec vitest run <路径>`
- 全量验证：`pnpm typecheck && pnpm --filter server test && pnpm --filter web test && pnpm lint`

---

### Task 1: Shared 类型 + 迁移 0004

**Files:**
- Modify: `packages/shared/src/session.ts`
- Modify: `packages/shared/src/agent.ts`
- Create: `apps/server/src/migration/sql/0004_diy_agents.sql`
- Test: `apps/server/src/migration/__tests__/0004-diy-agents.test.ts`

- [ ] **Step 1.1: 写失败测试（迁移）**

创建 `apps/server/src/migration/__tests__/0004-diy-agents.test.ts`：

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initDatabase, getDb } from '../../db/index.js';

describe('migration 0004 diy agents', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'migration-0004-'));
    initDatabase(testDir);
  });

  afterEach(() => {
    try {
      getDb().close();
    } catch {
      // ignore
    }
    if (testDir && existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('creates the agents table with expected columns', () => {
    const cols = getDb().prepare('PRAGMA table_info(agents)').all() as Array<{ name: string }>;
    expect(cols.map((c) => c.name)).toEqual(
      expect.arrayContaining([
        'id', 'name', 'description', 'system_prompt', 'model_id',
        'parameters', 'enabled', 'created_at', 'updated_at',
      ]),
    );
  });

  it('adds nullable agent_id to sessions', () => {
    const cols = getDb().prepare('PRAGMA table_info(sessions)').all() as Array<{ name: string }>;
    expect(cols.map((c) => c.name)).toContain('agent_id');
  });

  it('allows binding builtin tools that are not in the tools table', () => {
    const db = getDb();
    db.prepare(
      "INSERT INTO agents (id, name, created_at, updated_at) VALUES ('a1', 'T', 1, 1)",
    ).run();
    // 'calculator' 是内置工具 id，从不存在于 tools 表——旧外键会拒绝此插入
    db.prepare(
      "INSERT INTO agent_tools (agent_id, tool_id, safety_level) VALUES ('a1', 'calculator', 'inherit')",
    ).run();
    const row = db
      .prepare("SELECT safety_level FROM agent_tools WHERE agent_id = 'a1' AND tool_id = 'calculator'")
      .get();
    expect(row).toEqual({ safety_level: 'inherit' });
  });

  it('cascades agent deletion to bindings and nulls session.agent_id', () => {
    const db = getDb();
    db.prepare(
      "INSERT INTO agents (id, name, created_at, updated_at) VALUES ('a1', 'T', 1, 1)",
    ).run();
    db.prepare("INSERT INTO agent_tools (agent_id, tool_id) VALUES ('a1', 'calculator')").run();
    db.prepare(
      "INSERT INTO sessions (id, title, created_at, updated_at) VALUES ('s1', 'x', 1, 1)",
    ).run();
    db.prepare("UPDATE sessions SET agent_id = 'a1' WHERE id = 's1'").run();

    db.prepare("DELETE FROM agents WHERE id = 'a1'").run();

    expect(db.prepare('SELECT COUNT(*) as n FROM agent_tools').get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT agent_id FROM sessions WHERE id = 's1'").get()).toEqual({ agent_id: null });
  });

  it('cascades skill deletion to agent_skills', () => {
    const db = getDb();
    db.prepare(
      "INSERT INTO agents (id, name, created_at, updated_at) VALUES ('a1', 'T', 1, 1)",
    ).run();
    db.prepare(
      "INSERT INTO skills (id, name, description, body, source, enabled, created_at, updated_at) VALUES ('sk1', 'S', '', 'b', 'upload', 1, 1, 1)",
    ).run();
    db.prepare("INSERT INTO agent_skills (agent_id, skill_id) VALUES ('a1', 'sk1')").run();

    db.prepare("DELETE FROM skills WHERE id = 'sk1'").run();

    expect(db.prepare('SELECT COUNT(*) as n FROM agent_skills').get()).toEqual({ n: 0 });
  });
});
```

- [ ] **Step 1.2: 运行确认失败**

Run: `pnpm --filter server exec vitest run src/migration/__tests__/0004-diy-agents.test.ts`
Expected: FAIL — `no such table: agents`

- [ ] **Step 1.3: 写迁移 SQL**

创建 `apps/server/src/migration/sql/0004_diy_agents.sql`：

```sql
-- 0004: DIY Agent 实体（设计文档 docs/2026-08-15-diy-agent-design.md）
-- 1) agents 主表
CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  system_prompt TEXT NOT NULL DEFAULT '',
  model_id TEXT,
  parameters TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 2) sessions.agent_id：agent 删除后会话退回默认行为
ALTER TABLE sessions ADD COLUMN agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL;

-- 3) 重建 agent_tools：
--    - 移除 tool_id → tools(id) 外键（内置工具仅存在于内存注册表，不在 tools 表；
--      保留该外键将使内置工具无法绑定）
--    - 新增 agent_id → agents(id) 级联
--    - 仅保留引用真实 agent 的存量行（此前无写入路径，遗留行均为垃圾数据）
CREATE TABLE agent_tools_new (
  agent_id TEXT NOT NULL,
  tool_id TEXT NOT NULL,
  safety_level TEXT NOT NULL DEFAULT 'inherit'
    CHECK (safety_level IN ('safe', 'restricted', 'danger', 'inherit')),
  PRIMARY KEY (agent_id, tool_id),
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
);
INSERT INTO agent_tools_new (agent_id, tool_id, safety_level)
  SELECT agent_id, tool_id, safety_level FROM agent_tools
  WHERE agent_id IN (SELECT id FROM agents);
DROP TABLE agent_tools;
ALTER TABLE agent_tools_new RENAME TO agent_tools;

-- 4) 重建 agent_skills / agent_mcps，补双向级联外键
CREATE TABLE agent_skills_new (
  agent_id TEXT NOT NULL,
  skill_id TEXT NOT NULL,
  PRIMARY KEY (agent_id, skill_id),
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
  FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
);
INSERT INTO agent_skills_new (agent_id, skill_id)
  SELECT agent_id, skill_id FROM agent_skills
  WHERE agent_id IN (SELECT id FROM agents);
DROP TABLE agent_skills;
ALTER TABLE agent_skills_new RENAME TO agent_skills;

CREATE TABLE agent_mcps_new (
  agent_id TEXT NOT NULL,
  mcp_id TEXT NOT NULL,
  PRIMARY KEY (agent_id, mcp_id),
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
  FOREIGN KEY (mcp_id) REFERENCES mcps(id) ON DELETE CASCADE
);
INSERT INTO agent_mcps_new (agent_id, mcp_id)
  SELECT agent_id, mcp_id FROM agent_mcps
  WHERE agent_id IN (SELECT id FROM agents);
DROP TABLE agent_mcps;
ALTER TABLE agent_mcps_new RENAME TO agent_mcps;
```

- [ ] **Step 1.4: 运行确认通过**

Run: `pnpm --filter server exec vitest run src/migration/__tests__/0004-diy-agents.test.ts`
Expected: PASS（5 个用例）

- [ ] **Step 1.5: 扩展 shared 类型**

`packages/shared/src/session.ts` — `Session` 增加字段、`CreateSessionParams` 增加可选参数：

```ts
export interface Session {
  id: string;
  title: string;
  modelId: string | null;
  /** 绑定的 DIY agent（null = 默认助手） */
  agentId?: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface CreateSessionParams {
  title?: string;
  modelId?: string | null;
  agentId?: string | null;
}
```

`packages/shared/src/agent.ts` — 文件末尾追加：

```ts
export interface CreateAgentParams {
  name: string;
  description?: string;
  systemPrompt?: string;
  modelId?: string | null;
  parameters?: AgentConfig;
  /** 绑定的工具 id 集合（绑定即 'inherit' 安全级别） */
  toolIds?: string[];
  skillIds?: string[];
  mcpIds?: string[];
  enabled?: boolean;
}

export type UpdateAgentParams = Partial<CreateAgentParams>;
```

- [ ] **Step 1.6: 类型检查 + 提交**

Run: `pnpm --filter shared typecheck`
Expected: PASS

```bash
git add packages/shared/src/session.ts packages/shared/src/agent.ts
git commit -m "feat(shared): add agentId to Session and CreateAgentParams types"
git add apps/server/src/migration/sql/0004_diy_agents.sql apps/server/src/migration/__tests__/0004-diy-agents.test.ts
git commit -m "feat(server): add 0004 migration for agents table and binding FK rebuild"
```

---

### Task 2: repo/agent.ts 完整 CRUD + 绑定管理

**Files:**
- Modify: `apps/server/src/repo/agent.ts`
- Modify: `apps/server/src/repo/tool.ts`（`deleteTool` / `deleteToolsByMcp` 清理绑定行）
- Test: `apps/server/src/repo/__tests__/agent.test.ts`

- [ ] **Step 2.1: 写失败测试**

创建 `apps/server/src/repo/__tests__/agent.test.ts`（真实 DB + tmpdir，对齐 `skill.test.ts` 先例）：

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initDatabase, getDb } from '../../db/index.js';
import { deleteToolsByMcp } from '../tool.js';
import {
  listAgents,
  getAgent,
  createAgent,
  updateAgent,
  deleteAgent,
} from '../agent.js';

describe('AgentRepo', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'agent-repo-'));
    initDatabase(testDir);
  });

  afterEach(() => {
    try {
      getDb().close();
    } catch {
      // ignore
    }
    if (testDir && existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('createAgent → getAgent round-trips all fields and bindings', () => {
    const agent = createAgent({
      name: 'Writer',
      description: 'writes things',
      systemPrompt: 'Be terse.',
      modelId: 'm1',
      parameters: { temperature: 0.3 },
      toolIds: ['calculator', 'web_search'],
      skillIds: [],
      mcpIds: [],
    });

    expect(agent.id).toBeDefined();
    expect(agent.enabled).toBe(true);
    expect(agent.parameters).toEqual({ temperature: 0.3 });
    expect([...agent.toolIds].sort()).toEqual(['calculator', 'web_search']);

    const fetched = getAgent(agent.id);
    expect(fetched).toEqual(agent);
  });

  it('updateAgent replaces bindings instead of appending', () => {
    const agent = createAgent({ name: 'A', toolIds: ['calculator', 'web_search'] });

    const updated = updateAgent(agent.id, { toolIds: ['calculator'] })!;

    expect(updated).toBeDefined();
    expect(updated.toolIds).toEqual(['calculator']);
    expect(updated.name).toBe('A'); // 未提供的字段保持不变
  });

  it('updateAgent with no binding fields keeps existing bindings', () => {
    const agent = createAgent({ name: 'A', toolIds: ['calculator'] });
    const updated = updateAgent(agent.id, { name: 'B' })!;
    expect(updated.toolIds).toEqual(['calculator']);
  });

  it('createAgent dedupes tool ids', () => {
    const agent = createAgent({ name: 'A', toolIds: ['calculator', 'calculator'] });
    expect(agent.toolIds).toEqual(['calculator']);
  });

  it('deleteAgent cascades bindings via FK', () => {
    const agent = createAgent({ name: 'A', toolIds: ['calculator'] });
    expect(deleteAgent(agent.id)).toBe(true);
    const rows = getDb()
      .prepare('SELECT COUNT(*) as n FROM agent_tools WHERE agent_id = ?')
      .get(agent.id) as { n: number };
    expect(rows.n).toBe(0);
    expect(getAgent(agent.id)).toBeUndefined();
  });

  it('listAgents filters by enabled', () => {
    createAgent({ name: 'A', enabled: true });
    createAgent({ name: 'B', enabled: false });

    expect(listAgents().map((a) => a.name)).toEqual(['B', 'A']);
    expect(listAgents({ enabled: true }).map((a) => a.name)).toEqual(['A']);
  });

  it('deleteToolsByMcp also removes agent tool bindings', () => {
    const agent = createAgent({ name: 'A', toolIds: ['mcp-t1'] });
    getDb().prepare(
      `INSERT INTO tools (id, name, description, input_schema, type, safety_level, source_mcp_id, policy_version, enabled, created_at, updated_at)
       VALUES ('mcp-t1', 'mcp_t1', '', '{}', 'mcp-provided', 'restricted', 'mcp-1', 'v1', 1, 1, 1)`,
    ).run();

    deleteToolsByMcp('mcp-1');

    const bindings = getDb()
      .prepare('SELECT COUNT(*) as n FROM agent_tools WHERE agent_id = ?')
      .get(agent.id) as { n: number };
    expect(bindings.n).toBe(0);
  });
});
```

- [ ] **Step 2.2: 运行确认失败**

Run: `pnpm --filter server exec vitest run src/repo/__tests__/agent.test.ts`
Expected: FAIL — `listAgents is not a function`

- [ ] **Step 2.3: 实现 repo 扩展**

`apps/server/src/repo/agent.ts` — 顶部 import 改为：

```ts
import type {
  Agent,
  AgentConfig,
  AgentToolBinding,
  AgentToolSafetyOverride,
  CreateAgentParams,
  SafetyLevel,
  UpdateAgentParams,
} from '@my-copilot/shared';
import { getDb } from '../db/index.js';
import { generateId, now } from './base.js';
```

文件末尾追加（既有 4 个函数不动）：

```ts
// ---------------------------------------------------------------------------
// DIY Agent CRUD + bindings（设计文档 docs/2026-08-15-diy-agent-design.md）
// ---------------------------------------------------------------------------

interface AgentRow {
  id: string;
  name: string;
  description: string;
  system_prompt: string;
  model_id: string | null;
  parameters: string;
  enabled: number;
  created_at: number;
  updated_at: number;
}

function rowToAgent(row: AgentRow): Agent {
  let parameters: AgentConfig = {};
  try {
    parameters = JSON.parse(row.parameters) as AgentConfig;
  } catch {
    // 损坏 JSON → 空配置，不阻塞读取
  }
  const db = getDb();
  const toolIds = (
    db.prepare('SELECT tool_id FROM agent_tools WHERE agent_id = ? ORDER BY tool_id')
      .all(row.id) as Array<{ tool_id: string }>
  ).map((r) => r.tool_id);
  const skillIds = (
    db.prepare('SELECT skill_id FROM agent_skills WHERE agent_id = ? ORDER BY skill_id')
      .all(row.id) as Array<{ skill_id: string }>
  ).map((r) => r.skill_id);
  const mcpIds = (
    db.prepare('SELECT mcp_id FROM agent_mcps WHERE agent_id = ? ORDER BY mcp_id')
      .all(row.id) as Array<{ mcp_id: string }>
  ).map((r) => r.mcp_id);
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    systemPrompt: row.system_prompt,
    modelId: row.model_id,
    parameters,
    toolIds,
    skillIds,
    mcpIds,
    enabled: Boolean(row.enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listAgents(filter?: { enabled?: boolean }): Agent[] {
  const db = getDb();
  const rows =
    filter?.enabled !== undefined
      ? (db.prepare('SELECT * FROM agents WHERE enabled = ? ORDER BY created_at DESC')
          .all(filter.enabled ? 1 : 0) as AgentRow[])
      : (db.prepare('SELECT * FROM agents ORDER BY created_at DESC').all() as AgentRow[]);
  return rows.map(rowToAgent);
}

export function getAgent(id: string): Agent | undefined {
  const row = getDb().prepare('SELECT * FROM agents WHERE id = ?').get(id) as AgentRow | undefined;
  return row ? rowToAgent(row) : undefined;
}

function replaceBindings(
  agentId: string,
  params: { toolIds?: string[]; skillIds?: string[]; mcpIds?: string[] },
): void {
  const db = getDb();
  const run = db.transaction(() => {
    if (params.toolIds !== undefined) {
      db.prepare('DELETE FROM agent_tools WHERE agent_id = ?').run(agentId);
      const insert = db.prepare(
        "INSERT INTO agent_tools (agent_id, tool_id, safety_level) VALUES (?, ?, 'inherit')",
      );
      for (const toolId of [...new Set(params.toolIds)]) insert.run(agentId, toolId);
    }
    if (params.skillIds !== undefined) {
      db.prepare('DELETE FROM agent_skills WHERE agent_id = ?').run(agentId);
      const insert = db.prepare('INSERT INTO agent_skills (agent_id, skill_id) VALUES (?, ?)');
      for (const skillId of [...new Set(params.skillIds)]) insert.run(agentId, skillId);
    }
    if (params.mcpIds !== undefined) {
      db.prepare('DELETE FROM agent_mcps WHERE agent_id = ?').run(agentId);
      const insert = db.prepare('INSERT INTO agent_mcps (agent_id, mcp_id) VALUES (?, ?)');
      for (const mcpId of [...new Set(params.mcpIds)]) insert.run(agentId, mcpId);
    }
  });
  run();
}

export function createAgent(params: CreateAgentParams): Agent {
  const db = getDb();
  const id = generateId();
  const ts = now();
  db.prepare(
    `INSERT INTO agents (id, name, description, system_prompt, model_id, parameters, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    params.name,
    params.description ?? '',
    params.systemPrompt ?? '',
    params.modelId ?? null,
    JSON.stringify(params.parameters ?? {}),
    (params.enabled ?? true) ? 1 : 0,
    ts,
    ts,
  );
  replaceBindings(id, params);
  return getAgent(id)!;
}

export function updateAgent(id: string, params: UpdateAgentParams): Agent | undefined {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as AgentRow | undefined;
  if (!existing) return undefined;
  const ts = now();
  let existingParameters: AgentConfig = {};
  try {
    existingParameters = JSON.parse(existing.parameters) as AgentConfig;
  } catch {
    // ignore
  }
  db.prepare(
    `UPDATE agents SET name = ?, description = ?, system_prompt = ?, model_id = ?, parameters = ?, enabled = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    params.name ?? existing.name,
    params.description ?? existing.description,
    params.systemPrompt ?? existing.system_prompt,
    params.modelId !== undefined ? params.modelId : existing.model_id,
    JSON.stringify(params.parameters ?? existingParameters),
    (params.enabled ?? Boolean(existing.enabled)) ? 1 : 0,
    ts,
    id,
  );
  replaceBindings(id, params);
  return getAgent(id);
}

export function deleteAgent(id: string): boolean {
  const result = getDb().prepare('DELETE FROM agents WHERE id = ?').run(id);
  return result.changes > 0;
}
```

`apps/server/src/repo/tool.ts` — 替换 `deleteTool` 与 `deleteToolsByMcp`（补偿失去的 tools 外键级联）：

```ts
export function deleteTool(id: string): boolean {
  const db = getDb();
  const result = db.transaction(() => {
    db.prepare('DELETE FROM agent_tools WHERE tool_id = ?').run(id);
    return db.prepare('DELETE FROM tools WHERE id = ?').run(id);
  })();
  return result.changes > 0;
}

export function deleteToolsByMcp(mcpId: string): number {
  const db = getDb();
  const result = db.transaction(() => {
    db.prepare(
      "DELETE FROM agent_tools WHERE tool_id IN (SELECT id FROM tools WHERE type = 'mcp-provided' AND source_mcp_id = ?)",
    ).run(mcpId);
    return db
      .prepare("DELETE FROM tools WHERE type = 'mcp-provided' AND source_mcp_id = ?")
      .run(mcpId);
  })();
  return result.changes;
}
```

- [ ] **Step 2.4: 运行确认通过 + 回归既有工具仓库测试**

Run: `pnpm --filter server exec vitest run src/repo/__tests__/agent.test.ts src/repo/__tests__/tool.test.ts src/repo/__tests__/tool-sync.test.ts`
Expected: PASS（新 7 例 + 既有全绿）

- [ ] **Step 2.5: 提交**

```bash
git add apps/server/src/repo/agent.ts apps/server/src/repo/tool.ts apps/server/src/repo/__tests__/agent.test.ts
git commit -m "feat(server): add agent repo CRUD with transactional binding replacement"
```

---

### Task 3: session 仓库与路由支持 agentId

**Files:**
- Modify: `apps/server/src/repo/session.ts`
- Modify: `apps/server/src/routes/sessions.ts`
- Test: `apps/server/src/repo/__tests__/session.test.ts`（追加用例）
- Test: `apps/server/src/routes/__tests__/sessions.test.ts`（追加用例）

- [ ] **Step 3.1: 写失败测试**

`apps/server/src/repo/__tests__/session.test.ts` describe 块内追加：

```ts
it('createSession persists agentId and updateSession can change it', () => {
  const session = createSession({ title: 'T', agentId: 'a1' });
  expect(session.agentId).toBe('a1');

  const updated = updateSession(session.id, { agentId: null })!;
  expect(updated.agentId).toBeNull();

  const updated2 = updateSession(session.id, { agentId: 'a2' })!;
  expect(updated2.agentId).toBe('a2');
});
```

`apps/server/src/routes/__tests__/sessions.test.ts` — mock 区追加（现有 `vi.mock('../../repo/message.js', ...)` 之后）：

```ts
vi.mock('../../repo/agent.js', () => ({
  getAgent: vi.fn(),
}));
```

import 区追加：

```ts
import { getAgent } from '../../repo/agent.js';
```

describe 块内追加：

```ts
it('POST / rejects unknown agentId with 400', async () => {
  vi.mocked(getAgent).mockReturnValue(undefined);

  const app = createTestApp();
  const res = await app.request('/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentId: 'missing' }),
  });
  expect(res.status).toBe(400);
});

it('POST / accepts known agentId and passes it through', async () => {
  vi.mocked(getAgent).mockReturnValue({
    id: 'a1', name: 'A', description: '', systemPrompt: '', modelId: null,
    parameters: {}, toolIds: [], skillIds: [], mcpIds: [], enabled: true,
    createdAt: 1, updatedAt: 1,
  });
  const mockSession = { id: 's1', title: 'New Session', modelId: null, agentId: 'a1', createdAt: 1, updatedAt: 1 };
  vi.mocked(createSession).mockReturnValue(mockSession);

  const app = createTestApp();
  const res = await app.request('/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentId: 'a1' }),
  });
  expect(res.status).toBe(201);
  expect(createSession).toHaveBeenCalledWith({ agentId: 'a1' });
});

it('PATCH /:id rejects unknown agentId with 400', async () => {
  vi.mocked(getAgent).mockReturnValue(undefined);

  const app = createTestApp();
  const res = await app.request('/s1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentId: 'missing' }),
  });
  expect(res.status).toBe(400);
});
```

- [ ] **Step 3.2: 运行确认失败**

Run: `pnpm --filter server exec vitest run src/repo/__tests__/session.test.ts src/routes/__tests__/sessions.test.ts`
Expected: FAIL（repo 用例 agentId 断言失败；route 用例 400 断言失败）

- [ ] **Step 3.3: 实现**

`apps/server/src/repo/session.ts`：

1. `SessionRow` 接口加 `agent_id: string | null;`
2. `rowToSession` 与 `rowToSessionSummary` 各加一行 `agentId: row.agent_id,`
3. `createSession` 替换为：

```ts
export function createSession(params: CreateSessionParams): Session {
  const db = getDb();
  const id = generateId();
  const ts = now();
  const title = params.title ?? '新对话';
  const modelId = params.modelId ?? null;
  const agentId = params.agentId ?? null;

  db.prepare(
    `INSERT INTO sessions (id, title, model_id, agent_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, title, modelId, agentId, ts, ts);

  return {
    id,
    title,
    modelId,
    agentId,
    createdAt: ts,
    updatedAt: ts,
  };
}
```

4. `updateSession` 替换为：

```ts
export function updateSession(
  id: string,
  params: { title?: string; modelId?: string | null; agentId?: string | null },
): Session | undefined {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined;
  if (!existing) return undefined;

  const title = params.title ?? existing.title;
  const modelId = params.modelId !== undefined ? params.modelId : existing.model_id;
  const agentId = params.agentId !== undefined ? params.agentId : existing.agent_id;
  const ts = now();

  db.prepare(
    'UPDATE sessions SET title = ?, model_id = ?, agent_id = ?, updated_at = ? WHERE id = ?',
  ).run(title, modelId, agentId, ts, id);

  return {
    id,
    title,
    modelId,
    agentId,
    createdAt: existing.created_at,
    updatedAt: ts,
  };
}
```

`apps/server/src/routes/sessions.ts` — import 区加 `import { getAgent } from '../repo/agent.js';`，文件内（`export const sessionsApp` 之前）加：

```ts
/** agentId 存在时校验其存在；null/undefined 直接放行（解绑/未绑定）。 */
function assertAgentExists(agentId: unknown): void {
  if (agentId === undefined || agentId === null) return;
  if (typeof agentId !== 'string' || !getAgent(agentId)) {
    throw new HttpError(400, 'Agent not found');
  }
}
```

POST 路由在 title 长度校验后追加 `assertAgentExists(body.agentId);`；PATCH 路由在 `updateSession` 调用前追加 `assertAgentExists(body.agentId);`。

- [ ] **Step 3.4: 运行确认通过**

Run: `pnpm --filter server exec vitest run src/repo/__tests__/session.test.ts src/routes/__tests__/sessions.test.ts`
Expected: PASS（含既有用例回归）

- [ ] **Step 3.5: 提交**

```bash
git add apps/server/src/repo/session.ts apps/server/src/routes/sessions.ts apps/server/src/repo/__tests__/session.test.ts apps/server/src/routes/__tests__/sessions.test.ts
git commit -m "feat(server): persist and validate session agentId binding"
```

---

### Task 4: /api/agents 路由 + 挂载

**Files:**
- Create: `apps/server/src/routes/agents.ts`
- Modify: `apps/server/src/index.ts`
- Test: `apps/server/src/routes/__tests__/agents.test.ts`

- [ ] **Step 4.1: 写失败测试**

创建 `apps/server/src/routes/__tests__/agents.test.ts`：

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { errorMiddleware } from '../../middleware/error.js';
import { agentsApp } from '../agents.js';

vi.mock('../../repo/agent.js', () => ({
  listAgents: vi.fn(),
  getAgent: vi.fn(),
  createAgent: vi.fn(),
  updateAgent: vi.fn(),
  deleteAgent: vi.fn(),
}));

vi.mock('../../repo/skill.js', () => ({
  listSkills: vi.fn(),
}));

vi.mock('../../repo/mcp.js', () => ({
  listMcps: vi.fn(),
}));

import { listAgents, getAgent, createAgent, updateAgent, deleteAgent } from '../../repo/agent.js';
import { listSkills } from '../../repo/skill.js';
import { listMcps } from '../../repo/mcp.js';

const baseAgent = {
  id: 'a1', name: 'A', description: '', systemPrompt: '', modelId: null,
  parameters: {}, toolIds: [], skillIds: [], mcpIds: [], enabled: true,
  createdAt: 1, updatedAt: 1,
};

function createTestApp() {
  const app = new Hono();
  app.onError(errorMiddleware());
  app.route('/', agentsApp);
  return app;
}

describe('agents route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listSkills).mockReturnValue([]);
    vi.mocked(listMcps).mockReturnValue([]);
  });

  it('GET / returns list', async () => {
    vi.mocked(listAgents).mockReturnValue([baseAgent]);
    const res = await createTestApp().request('/');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data).toEqual([baseAgent]);
  });

  it('GET /?enabled=true filters', async () => {
    vi.mocked(listAgents).mockReturnValue([baseAgent]);
    await createTestApp().request('/?enabled=true');
    expect(listAgents).toHaveBeenCalledWith({ enabled: true });
  });

  it('POST / validates name', async () => {
    const res = await createTestApp().request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    });
    expect(res.status).toBe(400);
  });

  it('POST / rejects invalid parameters shape', async () => {
    const res = await createTestApp().request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'A', parameters: { bogus: 1 } }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { msg: string };
    expect(body.msg).toContain('bogus');
  });

  it('POST / rejects unknown skill ids', async () => {
    vi.mocked(listSkills).mockReturnValue([
      { id: 'sk1', name: 'S', description: '', enabled: true, createdAt: 1, updatedAt: 1, source: 'upload' },
    ]);
    const res = await createTestApp().request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'A', skillIds: ['nope'] }),
    });
    expect(res.status).toBe(400);
  });

  it('POST / creates agent with 201', async () => {
    vi.mocked(createAgent).mockReturnValue(baseAgent);
    const res = await createTestApp().request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'A', toolIds: ['calculator'] }),
    });
    expect(res.status).toBe(201);
    expect(createAgent).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'A', toolIds: ['calculator'] }),
    );
  });

  it('PATCH /:id updates and returns 404 when missing', async () => {
    vi.mocked(getAgent).mockReturnValue(baseAgent);
    vi.mocked(updateAgent).mockReturnValue({ ...baseAgent, name: 'B' });
    const res = await createTestApp().request('/a1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'B' }),
    });
    expect(res.status).toBe(200);

    vi.mocked(getAgent).mockReturnValue(undefined);
    vi.mocked(updateAgent).mockReturnValue(undefined);
    const res404 = await createTestApp().request('/a1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'B' }),
    });
    expect(res404.status).toBe(404);
  });

  it('DELETE /:id deletes', async () => {
    vi.mocked(deleteAgent).mockReturnValue(true);
    const res = await createTestApp().request('/a1', { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data).toEqual({ deleted: true });
  });
});
```

- [ ] **Step 4.2: 运行确认失败**

Run: `pnpm --filter server exec vitest run src/routes/__tests__/agents.test.ts`
Expected: FAIL — 无法解析 `../agents.js`

- [ ] **Step 4.3: 实现路由**

创建 `apps/server/src/routes/agents.ts`：

```ts
import { Hono } from 'hono';
import {
  listAgents,
  getAgent,
  createAgent,
  updateAgent,
  deleteAgent,
} from '../repo/agent.js';
import { listSkills } from '../repo/skill.js';
import { listMcps } from '../repo/mcp.js';
import { successResponse } from '../utils/response.js';
import { HttpError } from '../middleware/error.js';
import type { CreateAgentParams, UpdateAgentParams } from '@my-copilot/shared';

export const agentsApp = new Hono();

/** 校验 parameters 只含 AgentConfig 已知键且值合法。 */
function parseParameters(raw: unknown): AgentConfig {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new HttpError(400, 'parameters must be a JSON object');
  }
  const { temperature, maxTokens, topP, ...rest } = raw as Record<string, unknown>;
  const unknownKeys = Object.keys(rest);
  if (unknownKeys.length > 0) {
    throw new HttpError(400, `Unknown parameter keys: ${unknownKeys.join(', ')}`);
  }
  if (temperature !== undefined && (typeof temperature !== 'number' || temperature < 0 || temperature > 2)) {
    throw new HttpError(400, 'temperature must be a number between 0 and 2');
  }
  if (maxTokens !== undefined && (typeof maxTokens !== 'number' || !Number.isInteger(maxTokens) || maxTokens < 1)) {
    throw new HttpError(400, 'maxTokens must be a positive integer');
  }
  if (topP !== undefined && (typeof topP !== 'number' || topP < 0 || topP > 1)) {
    throw new HttpError(400, 'topP must be a number between 0 and 1');
  }
  return {
    ...(temperature !== undefined ? { temperature } : {}),
    ...(maxTokens !== undefined ? { maxTokens } : {}),
    ...(topP !== undefined ? { topP } : {}),
  };
}

/** 校验字符串数组字段（toolIds/skillIds/mcpIds）。 */
function parseIdArray(raw: unknown, field: string): string[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw) || raw.some((v) => typeof v !== 'string')) {
    throw new HttpError(400, `${field} must be an array of strings`);
  }
  return raw as string[];
}

/** skill/mcp 绑定必须引用已存在实体（内置工具不入库，toolIds 不校验存在性）。 */
function validateBindingExistence(params: { skillIds?: string[]; mcpIds?: string[] }): void {
  if (params.skillIds) {
    const known = new Set(listSkills().map((s) => s.id));
    const unknown = params.skillIds.filter((id) => !known.has(id));
    if (unknown.length > 0) {
      throw new HttpError(400, `Unknown skill ids: ${unknown.join(', ')}`);
    }
  }
  if (params.mcpIds) {
    const known = new Set(listMcps().map((m) => m.id));
    const unknown = params.mcpIds.filter((id) => !known.has(id));
    if (unknown.length > 0) {
      throw new HttpError(400, `Unknown mcp ids: ${unknown.join(', ')}`);
    }
  }
}

/** POST/PATCH 共用的全量校验：name 必填，其余可选字段类型/取值校验。 */
function validateBody(raw: unknown): CreateAgentParams {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new HttpError(400, 'Request body must be a JSON object');
  }
  const body = raw as Record<string, unknown>;
  const name = body.name;
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new HttpError(400, 'name is required');
  }
  if (name.length > 200) {
    throw new HttpError(400, 'name must be 200 characters or less');
  }
  for (const field of ['description', 'systemPrompt'] as const) {
    if (body[field] !== undefined && typeof body[field] !== 'string') {
      throw new HttpError(400, `${field} must be a string`);
    }
  }
  if (body.modelId !== undefined && body.modelId !== null && typeof body.modelId !== 'string') {
    throw new HttpError(400, 'modelId must be a string or null');
  }
  if (body.enabled !== undefined && typeof body.enabled !== 'boolean') {
    throw new HttpError(400, 'enabled must be a boolean');
  }
  const toolIds = parseIdArray(body.toolIds, 'toolIds');
  const skillIds = parseIdArray(body.skillIds, 'skillIds');
  const mcpIds = parseIdArray(body.mcpIds, 'mcpIds');
  const params: CreateAgentParams = {
    name,
    ...(body.description !== undefined ? { description: body.description as string } : {}),
    ...(body.systemPrompt !== undefined ? { systemPrompt: body.systemPrompt as string } : {}),
    ...(body.modelId !== undefined ? { modelId: body.modelId as string | null } : {}),
    parameters: parseParameters(body.parameters),
    ...(toolIds !== undefined ? { toolIds } : {}),
    ...(skillIds !== undefined ? { skillIds } : {}),
    ...(mcpIds !== undefined ? { mcpIds } : {}),
    ...(body.enabled !== undefined ? { enabled: body.enabled as boolean } : {}),
  };
  validateBindingExistence(params);
  return params;
}

agentsApp.get('/', (c) => {
  const enabled = c.req.query('enabled');
  const data = listAgents(enabled === 'true' ? { enabled: true } : undefined);
  return successResponse(c, data);
});

agentsApp.get('/:id', (c) => {
  const data = getAgent(c.req.param('id'));
  if (!data) throw new HttpError(404, 'Agent not found');
  return successResponse(c, data);
});

agentsApp.post('/', async (c) => {
  const raw = await c.req.json().catch(() => null);
  const params = validateBody(raw);
  const data = createAgent(params);
  return successResponse(c, data, 201);
});

agentsApp.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const existing = getAgent(id);
  if (!existing) throw new HttpError(404, 'Agent not found');
  const raw = await c.req.json().catch(() => null);
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new HttpError(400, 'Request body must be a JSON object');
  }
  const body = raw as Record<string, unknown>;
  // PATCH 可省略 name：回填现有 name 后复用全量校验
  if (body.name === undefined) body.name = existing.name;
  const params: UpdateAgentParams = validateBody(body);
  const data = updateAgent(id, params);
  if (!data) throw new HttpError(404, 'Agent not found');
  return successResponse(c, data);
});

agentsApp.delete('/:id', (c) => {
  const deleted = deleteAgent(c.req.param('id'));
  if (!deleted) throw new HttpError(404, 'Agent not found');
  return successResponse(c, { deleted });
});
```

注意：`parseParameters` 返回类型是 `AgentConfig`，需在 import 区从 shared 引入：`import type { AgentConfig, CreateAgentParams, UpdateAgentParams } from '@my-copilot/shared';`

`apps/server/src/index.ts` — import 区加 `import { agentsApp } from './routes/agents.js';`，在 `app.route('/api/sessions', sessionsApp);` 之后加一行：

```ts
app.route('/api/agents', agentsApp);
```

- [ ] **Step 4.4: 运行确认通过**

Run: `pnpm --filter server exec vitest run src/routes/__tests__/agents.test.ts`
Expected: PASS（8 个用例）

- [ ] **Step 4.5: 提交**

```bash
git add apps/server/src/routes/agents.ts apps/server/src/index.ts apps/server/src/routes/__tests__/agents.test.ts
git commit -m "feat(server): add /api/agents CRUD routes with binding validation"
```

---

### Task 5: assembler 支持 systemPromptOverride

**Files:**
- Modify: `apps/server/src/prompt/assembler.ts`
- Test: `apps/server/src/prompt/__tests__/assembler.test.ts`（追加用例）

- [ ] **Step 5.1: 写失败测试**

在 `apps/server/src/prompt/__tests__/assembler.test.ts` describe 块内追加：

```ts
it('replaces the default system prompt when systemPromptOverride is provided', () => {
  const messages = assembleMessages({
    history: [],
    userContent: 'hi',
    systemPromptOverride: 'You are a pirate.',
  });
  expect(messages[0]).toEqual({ role: 'system', content: 'You are a pirate.' });
});

it('falls back to the default prompt for blank overrides', () => {
  const messages = assembleMessages({
    history: [],
    userContent: 'hi',
    systemPromptOverride: '   ',
  });
  expect(messages[0].content).toBe('你是一个乐于助人的 AI 助手,请用中文回答用户问题。');
});
```

- [ ] **Step 5.2: 运行确认失败**

Run: `pnpm --filter server exec vitest run src/prompt/__tests__/assembler.test.ts`
Expected: FAIL — TS 报未知参数 `systemPromptOverride`（或运行时断言失败）

- [ ] **Step 5.3: 实现**

`apps/server/src/prompt/assembler.ts`：

1. `assembleMessages` 的 params 增加 `systemPromptOverride?: string;`
2. JSDoc 的 Assembly order 第 1 条同步更新为 "System prompt (agent override or default)"
3. 第 1 步替换为：

```ts
  // 1. System prompt — agent 的 systemPromptOverride 非空（trim 后）时替换默认提示
  const systemPrompt = params.systemPromptOverride?.trim().length
    ? params.systemPromptOverride
    : DEFAULT_SYSTEM_PROMPT;
  messages.push({ role: 'system', content: systemPrompt });
```

- [ ] **Step 5.4: 运行确认通过 + 提交**

Run: `pnpm --filter server exec vitest run src/prompt/__tests__/assembler.test.ts`
Expected: PASS（含既有用例回归）

```bash
git add apps/server/src/prompt/assembler.ts apps/server/src/prompt/__tests__/assembler.test.ts
git commit -m "feat(server): add systemPromptOverride to prompt assembler"
```

---

### Task 6: agent-context 解析器 + 运行链路接线

**Files:**
- Create: `apps/server/src/agent-loop/agent-context.ts`
- Modify: `apps/server/src/agent-loop/runner.ts`
- Modify: `apps/server/src/streaming/lifecycle.ts`
- Modify: `apps/server/src/jobs/worker.ts`
- Modify: `apps/server/src/routes/messages.ts`
- Test: `apps/server/src/agent-loop/__tests__/agent-context.test.ts`（新）
- Test: `apps/server/src/streaming/__tests__/lifecycle.test.ts`（追加）
- Test: `apps/server/src/routes/__tests__/messages.test.ts`（追加）

- [ ] **Step 6.1: 写失败测试（解析器）**

创建 `apps/server/src/agent-loop/__tests__/agent-context.test.ts`：

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Agent, SkillMeta, SkillDetail, Tool } from '@my-copilot/shared';

vi.mock('../../repo/agent.js', () => ({ getAgent: vi.fn() }));
vi.mock('../../repo/skill.js', () => ({ listEnabledSkills: vi.fn(), getSkill: vi.fn() }));
vi.mock('../../repo/tool.js', () => ({ listEnabledTools: vi.fn() }));
vi.mock('../../tools/registry.js', () => ({ listRegisteredTools: vi.fn() }));

import { getAgent } from '../../repo/agent.js';
import { listEnabledSkills, getSkill } from '../../repo/skill.js';
import { listEnabledTools } from '../../repo/tool.js';
import { listRegisteredTools } from '../../tools/registry.js';
import { resolveAgentContext } from '../agent-context.js';

function builtin(id: string): Tool {
  return {
    id, name: id, description: '', inputSchema: { fields: [] },
    type: 'built-in', safetyLevel: 'safe', sourceMcpId: null,
    policyVersion: 'v1', enabled: true, createdAt: 1, updatedAt: 1,
  };
}

function mcpTool(id: string, mcpId: string): Tool {
  return { ...builtin(id), type: 'mcp-provided', safetyLevel: 'restricted', sourceMcpId: mcpId };
}

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'a1', name: 'A', description: '', systemPrompt: '', modelId: null,
    parameters: {}, toolIds: [], skillIds: [], mcpIds: [], enabled: true,
    createdAt: 1, updatedAt: 1, ...overrides,
  };
}

function makeSkill(id: string, name: string, order: number): { meta: SkillMeta; detail: SkillDetail } {
  const meta: SkillMeta = { id, name, description: '', enabled: true, createdAt: order, updatedAt: order, source: 'upload' };
  const detail: SkillDetail = { ...meta, content: `body-${id}` };
  return { meta, detail };
}

const sk1 = makeSkill('sk1', 'S1', 1);
const sk2 = makeSkill('sk2', 'S2', 2);

describe('resolveAgentContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listRegisteredTools).mockReturnValue([builtin('calculator'), builtin('web_search')]);
    vi.mocked(listEnabledTools).mockReturnValue([
      mcpTool('mcp-t1', 'mcp-1'),
      mcpTool('mcp-t2', 'mcp-2'),
    ]);
    vi.mocked(listEnabledSkills).mockReturnValue([sk1.meta, sk2.meta]);
    vi.mocked(getSkill).mockImplementation((id: string) =>
      id === 'sk1' ? sk1.detail : id === 'sk2' ? sk2.detail : undefined,
    );
  });

  it('no agent → all globally enabled tools and all enabled skills', () => {
    vi.mocked(getAgent).mockReturnValue(undefined);
    const ctx = resolveAgentContext(null);
    expect(ctx.agent).toBeNull();
    expect(ctx.tools.map((t) => t.id).sort()).toEqual(['calculator', 'mcp-t1', 'mcp-t2', 'web_search']);
    expect(ctx.skills).toEqual([
      { name: 'S1', body: 'body-sk1' },
      { name: 'S2', body: 'body-sk2' },
    ]);
  });

  it('agent tool whitelist intersects globally enabled', () => {
    vi.mocked(getAgent).mockReturnValue(makeAgent({ toolIds: ['calculator'] }));
    const ctx = resolveAgentContext('a1');
    expect(ctx.tools.map((t) => t.id)).toEqual(['calculator']);
  });

  it('unbound tools are invisible even if globally enabled', () => {
    vi.mocked(getAgent).mockReturnValue(makeAgent({ toolIds: ['no_such_tool'] }));
    const ctx = resolveAgentContext('a1');
    expect(ctx.tools).toEqual([]);
  });

  it('bound MCP server pulls in all its tools', () => {
    vi.mocked(getAgent).mockReturnValue(makeAgent({ mcpIds: ['mcp-1'] }));
    const ctx = resolveAgentContext('a1');
    expect(ctx.tools.map((t) => t.id)).toEqual(['mcp-t1']);
  });

  it('tool whitelist and mcp binding combine (union)', () => {
    vi.mocked(getAgent).mockReturnValue(makeAgent({ toolIds: ['web_search'], mcpIds: ['mcp-1'] }));
    const ctx = resolveAgentContext('a1');
    expect(ctx.tools.map((t) => t.id).sort()).toEqual(['mcp-t1', 'web_search']);
  });

  it('skill whitelist filters injections', () => {
    vi.mocked(getAgent).mockReturnValue(makeAgent({ skillIds: ['sk2'] }));
    const ctx = resolveAgentContext('a1');
    expect(ctx.skills).toEqual([{ name: 'S2', body: 'body-sk2' }]);
  });

  it('disabled agent still resolves (bound sessions keep working)', () => {
    vi.mocked(getAgent).mockReturnValue(makeAgent({ enabled: false, toolIds: ['calculator'] }));
    const ctx = resolveAgentContext('a1');
    expect(ctx.agent?.id).toBe('a1');
    expect(ctx.tools.map((t) => t.id)).toEqual(['calculator']);
  });

  it('missing agent id falls back to default context', () => {
    vi.mocked(getAgent).mockReturnValue(undefined);
    const ctx = resolveAgentContext('gone');
    expect(ctx.agent).toBeNull();
    expect(ctx.tools.length).toBe(4);
  });
});
```

- [ ] **Step 6.2: 运行确认失败**

Run: `pnpm --filter server exec vitest run src/agent-loop/__tests__/agent-context.test.ts`
Expected: FAIL — 无法解析 `../agent-context.js`

- [ ] **Step 6.3: 实现解析器**

创建 `apps/server/src/agent-loop/agent-context.ts`：

```ts
/**
 * Agent context resolution（设计文档 docs/2026-08-15-diy-agent-design.md）
 *
 * 给定会话绑定的 agentId，产出运行时上下文：agent 实体（或 null）、
 * 白名单过滤后的工具集、技能注入。
 *
 * 白名单语义：有效工具 = (绑定的 tool id ∪ 绑定 MCP server 的工具) ∩ 全局启用；
 * 无 agent → 全部全局启用工具 + 全部启用技能。
 * enabled 只影响新建会话的选择器，此处不检查（已绑定会话继续可用）。
 * 孤儿 mcp-provided 工具（sourceMcpId=null）始终过滤（对齐 lifecycle 原有逻辑）。
 */
import type { Agent, Tool } from '@my-copilot/shared';
import type { SkillInjection } from '../prompt/assembler.js';
import { getAgent } from '../repo/agent.js';
import { listEnabledSkills, getSkill } from '../repo/skill.js';
import { listEnabledTools } from '../repo/tool.js';
import { listRegisteredTools } from '../tools/registry.js';

export interface AgentContext {
  agent: Agent | null;
  tools: Tool[];
  skills: SkillInjection[];
}

function globallyEnabledTools(): Tool[] {
  return [
    ...listRegisteredTools(),
    ...listEnabledTools().filter(
      (tool) => tool.type === 'mcp-provided' && tool.sourceMcpId !== null,
    ),
  ];
}

function skillInjections(boundSkillIds: Set<string> | null): SkillInjection[] {
  const injections: SkillInjection[] = [];
  for (const meta of listEnabledSkills()) {
    if (boundSkillIds && !boundSkillIds.has(meta.id)) continue;
    const detail = getSkill(meta.id);
    if (detail) injections.push({ name: detail.name, body: detail.content });
  }
  return injections;
}

export function resolveAgentContext(sessionAgentId: string | null | undefined): AgentContext {
  const agent = sessionAgentId ? (getAgent(sessionAgentId) ?? null) : null;

  if (!agent) {
    return { agent: null, tools: globallyEnabledTools(), skills: skillInjections(null) };
  }

  const boundToolIds = new Set(agent.toolIds);
  const boundMcpIds = new Set(agent.mcpIds);
  const tools = globallyEnabledTools().filter(
    (tool) =>
      boundToolIds.has(tool.id) ||
      (tool.type === 'mcp-provided' &&
        tool.sourceMcpId !== null &&
        boundMcpIds.has(tool.sourceMcpId)),
  );

  return {
    agent,
    tools,
    skills: skillInjections(new Set(agent.skillIds)),
  };
}
```

- [ ] **Step 6.4: 运行确认通过**

Run: `pnpm --filter server exec vitest run src/agent-loop/__tests__/agent-context.test.ts`
Expected: PASS（8 个用例）

- [ ] **Step 6.5: runner 透传参数**

`apps/server/src/agent-loop/runner.ts`：

1. shared import 加 `AgentConfig`：
   `import type { AgentConfig, Job, Message, StreamEvent, Tool, ToolApproval, ToolCall } from '@my-copilot/shared';`
2. `RunAgentLoopParams`（`skills?: SkillInjection[];` 之后）与 `AgentLoopJobContext`（`skills?: SkillInjection[];` 之后）各加：

```ts
  /** agent 的自定义系统提示（非空则替换默认提示）。 */
  systemPromptOverride?: string;
  /** agent 的生成参数（temperature/maxTokens/topP），透传给 adapter。 */
  parameters?: AgentConfig;
```

3. `runAgentLoop` 解构（`skills,` 之后）加 `systemPromptOverride, parameters,`
4. `assembleMessages` 调用（第 2 步）加参数：

```ts
      const chatMessages: ChatMessage[] = assembleMessages({
        history,
        userContent,
        attachments,
        skills,
        systemPromptOverride,
      });
```

5. `chatCompletionStream` 调用（第 3 步）options 改为：

```ts
      const generator = adapter.chatCompletionStream(chatMessages, adapterConfig, {
        temperature: parameters?.temperature,
        maxTokens: parameters?.maxTokens,
        topP: parameters?.topP,
        tools: jsonTools.length > 0 ? jsonTools : undefined,
        toolChoice: 'auto',
        parallelToolCalls: true,
        signal: abortSignal,
      });
```

两个 adapter 对 `undefined` 字段均跳过序列化（`if (options?.temperature !== undefined)`），行为向后兼容。

- [ ] **Step 6.6: lifecycle 接线**

`apps/server/src/streaming/lifecycle.ts`：

1. import 区：删除 `import { listEnabledTools } from '../repo/tool.js';` 与 `import { listRegisteredTools } from '../tools/registry.js';`，新增 `import { resolveAgentContext } from '../agent-loop/agent-context.js';`
2. `StreamMessageParams` 加字段（`history: Message[];` 之前）：

```ts
  /** 会话绑定的 DIY agent id（null/undefined = 默认助手）。 */
  agentId?: string | null;
```

3. 解构（`const { sessionId, userMessage, provider, model, attachments, history } = params;`）改为加 `agentId: sessionAgentId,`
4. 原 `enabledTools` 收集块（含孤儿过滤注释，第 61-74 行）整体替换为：

```ts
  // 解析 agent 上下文（白名单过滤 + 技能注入；无 agent 时回退全局启用集）。
  // 孤儿 mcp-provided 工具（sourceMcpId=null）在解析器内过滤。
  const { agent, tools: effectiveTools, skills } = resolveAgentContext(sessionAgentId);
```

5. 异步模式 job payload 中 `enabledTools,` 改为 `agentId: sessionAgentId ?? null,`（worker 执行时重新解析，payload 不再携带工具快照，与 worker 现有"执行时重取"语义一致）
6. `runAgentLoop` 调用改为：

```ts
      const result = await runAgentLoop({
        sessionId,
        userMessageId: assistantMsg.id,
        agentId: agent?.id,
        history: [...history],
        userContent: userMessage.content,
        attachments,
        skills,
        systemPromptOverride: agent?.systemPrompt || undefined,
        parameters: agent?.parameters,
        tools: effectiveTools,
        adapter,
        adapterConfig,
        abortSignal: ac.signal,
```

（`onEvent` 回调及之后内容保持不变。）

- [ ] **Step 6.7: worker 接线**

`apps/server/src/jobs/worker.ts`：

1. `AgentLoopJobPayload` 加字段（`adapterConfig` 之前）：`agentId?: string | null;`
2. `registerAgentLoopHandler` 的动态 import 与 handler 体替换为：

```ts
    const [
      { runAgentLoopAsJob },
      { getAdapter },
      { resolveAgentContext },
    ] =
      await Promise.all([
        import('../agent-loop/runner.js'),
        import('../llm/index.js'),
        import('../agent-loop/agent-context.js'),
      ]);

    const payload = job.payload as unknown as AgentLoopJobPayload;
    const adapter = getAdapter(payload.adapterType);
    // 执行时重新解析（对齐同步模式：入队后改绑定会影响本次运行）
    const { agent, tools, skills } = resolveAgentContext(payload.agentId ?? null);

    return runAgentLoopAsJob(
      job,
      {
        sessionId: payload.sessionId,
        agentId: agent?.id,
        userMessageId: payload.userMessageId,
        history: payload.history,
        userContent: payload.userContent,
        attachments: payload.attachments,
        skills,
        systemPromptOverride: agent?.systemPrompt || undefined,
        parameters: agent?.parameters,
        tools,
        adapter,
        adapterConfig: payload.adapterConfig,
      },
      signal,
    );
```

- [ ] **Step 6.8: messages 路由模型覆盖 + 传参**

`apps/server/src/routes/messages.ts`：

1. import 区加 `import { getAgent } from '../repo/agent.js';`
2. 第 5 步「Resolve provider and model」块（`if (!session.modelId)` 到 `throw new HttpError(400, 'Provider is disabled');`）整体替换为：

```ts
  // 5. Resolve provider and model — agent.modelId 覆盖会话模型，缺失时回退
  let effectiveModelId = session.modelId;
  if (session.agentId) {
    const agent = getAgent(session.agentId);
    if (agent?.modelId) {
      if (getModel(agent.modelId)) {
        effectiveModelId = agent.modelId;
      } else {
        console.warn(
          `[agents] model '${agent.modelId}' not found, falling back to session model`,
        );
      }
    }
  }

  if (!effectiveModelId) {
    throw new HttpError(400, 'No model configured for this session');
  }

  const model = getModel(effectiveModelId);
  if (!model) {
    throw new HttpError(400, 'Model not found');
  }

  const provider = getProvider(model.providerId);
  if (!provider) {
    throw new HttpError(400, 'Provider not found');
  }
  if (!provider.enabled) {
    throw new HttpError(400, 'Provider is disabled');
  }
```

3. `streamMessageHandler(c, {...})` 参数在 `history,` 之后加一行 `agentId: session.agentId,`

- [ ] **Step 6.9: 更新 lifecycle 测试 + 新用例**

`apps/server/src/streaming/__tests__/lifecycle.test.ts`：

1. mock 区（`vi.mock('../../agent-loop/runner.js', ...)` 之后）加：

```ts
vi.mock('../../agent-loop/agent-context.js', () => ({
  resolveAgentContext: vi.fn(() => ({ agent: null, tools: [], skills: [] })),
}));
```

2. import 区（动态 import 之后）加：

```ts
import { resolveAgentContext } from '../../agent-loop/agent-context.js';
import type { Tool } from '@my-copilot/shared';
```

3. describe 块末尾追加：

```ts
  it('passes agent context into runAgentLoop when session has an agent', async () => {
    setupNormalCompletion();
    const calculatorTool: Tool = {
      id: 'calculator', name: 'calculator', description: '',
      inputSchema: { fields: [] }, type: 'built-in', safetyLevel: 'safe',
      sourceMcpId: null, policyVersion: 'v1', enabled: true, createdAt: 1, updatedAt: 1,
    };
    vi.mocked(resolveAgentContext).mockReturnValue({
      agent: {
        id: 'agent-1', name: 'A', description: '', systemPrompt: 'Be terse.',
        modelId: null, parameters: { temperature: 0.2 }, toolIds: ['calculator'],
        skillIds: [], mcpIds: [], enabled: true, createdAt: 1, updatedAt: 1,
      },
      tools: [calculatorTool],
      skills: [{ name: 'S1', body: 'Skill body.' }],
    });

    const params = makeParams();
    (params as Record<string, unknown>).agentId = 'agent-1';
    streamMessageHandler(makeContext(), params);
    await flushMicrotasks();

    expect(mockRunAgentLoop).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'agent-1',
        systemPromptOverride: 'Be terse.',
        parameters: { temperature: 0.2 },
        tools: [calculatorTool],
        skills: [{ name: 'S1', body: 'Skill body.' }],
      }),
    );
    // mockAssembleMessages 被 runner 间接调用的路径不在本测试范围（runner 被mock）。
  });
```

`apps/server/src/routes/__tests__/messages.test.ts`：

1. mock 区加：

```ts
vi.mock('../../repo/agent.js', () => ({
  getAgent: vi.fn(),
}));
```

2. import 区加 `import { getAgent } from '../../repo/agent.js';`
3. describe 块末尾追加：

```ts
  it('POST / overrides model with agent.modelId when session has an agent', async () => {
    const mockSession = { id: 's1', title: 'Test', modelId: 'm1', agentId: 'a1', createdAt: 1, updatedAt: 1 };
    const agentModel = { id: 'm2', providerId: 'p1', name: 'gpt-4o', enabled: true, createdAt: 1, updatedAt: 1 };
    const mockProvider = { id: 'p1', name: 'OpenAI', type: 'openai' as const, baseUrl: 'https://api.openai.com', apiKey: 'sk-test', enabled: true, createdAt: 1, updatedAt: 1 };

    vi.mocked(getSession).mockReturnValue(mockSession);
    vi.mocked(getAgent).mockReturnValue({
      id: 'a1', name: 'A', description: '', systemPrompt: '', modelId: 'm2',
      parameters: {}, toolIds: [], skillIds: [], mcpIds: [], enabled: true,
      createdAt: 1, updatedAt: 1,
    });
    vi.mocked(getModel).mockImplementation((id: string) =>
      id === 'm2' ? agentModel : undefined,
    );
    vi.mocked(getProvider).mockReturnValue(mockProvider);
    vi.mocked(listMessagesBySession).mockReturnValue([]);
    const sseResponse = new Response('sse-stream', { headers: { 'content-type': 'text/event-stream' } });
    vi.mocked(streamMessageHandler).mockReturnValue(sseResponse);

    const app = createTestApp();
    const form = new FormData();
    form.append('content', 'hello');

    const res = await app.request('/sessions/s1/messages', { method: 'POST', body: form });
    expect(res.status).toBe(200);
    expect(streamMessageHandler).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ model: expect.objectContaining({ id: 'm2' }), agentId: 'a1' }),
    );
  });

  it('POST / falls back to session model when agent model is missing', async () => {
    const mockSession = { id: 's1', title: 'Test', modelId: 'm1', agentId: 'a1', createdAt: 1, updatedAt: 1 };
    const sessionModel = { id: 'm1', providerId: 'p1', name: 'gpt-4', enabled: true, createdAt: 1, updatedAt: 1 };
    const mockProvider = { id: 'p1', name: 'OpenAI', type: 'openai' as const, baseUrl: 'https://api.openai.com', apiKey: 'sk-test', enabled: true, createdAt: 1, updatedAt: 1 };

    vi.mocked(getSession).mockReturnValue(mockSession);
    vi.mocked(getAgent).mockReturnValue({
      id: 'a1', name: 'A', description: '', systemPrompt: '', modelId: 'm-gone',
      parameters: {}, toolIds: [], skillIds: [], mcpIds: [], enabled: true,
      createdAt: 1, updatedAt: 1,
    });
    vi.mocked(getModel).mockImplementation((id: string) =>
      id === 'm1' ? sessionModel : undefined,
    );
    vi.mocked(getProvider).mockReturnValue(mockProvider);
    vi.mocked(listMessagesBySession).mockReturnValue([]);
    const sseResponse = new Response('sse-stream', { headers: { 'content-type': 'text/event-stream' } });
    vi.mocked(streamMessageHandler).mockReturnValue(sseResponse);

    const app = createTestApp();
    const form = new FormData();
    form.append('content', 'hello');

    const res = await app.request('/sessions/s1/messages', { method: 'POST', body: form });
    expect(res.status).toBe(200);
    expect(streamMessageHandler).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ model: expect.objectContaining({ id: 'm1' }) }),
    );
  });
```

- [ ] **Step 6.10: 运行全部相关测试**

Run: `pnpm --filter server exec vitest run src/agent-loop src/streaming src/routes/__tests__/messages.test.ts src/jobs`
Expected: PASS（含 runner/worker 既有用例回归；若 worker 测试因 payload 形状变化失败，检查其 mock 的 payload 构造并同步补 `agentId: null`）

- [ ] **Step 6.11: 提交**

```bash
git add apps/server/src/agent-loop/agent-context.ts apps/server/src/agent-loop/runner.ts apps/server/src/streaming/lifecycle.ts apps/server/src/jobs/worker.ts apps/server/src/routes/messages.ts apps/server/src/agent-loop/__tests__/agent-context.test.ts apps/server/src/streaming/__tests__/lifecycle.test.ts apps/server/src/routes/__tests__/messages.test.ts
git commit -m "feat(server): wire agent whitelist resolution into sync and async run paths"
```

---

### Task 7: 前端 API 函数 + agentStore

**Files:**
- Modify: `apps/web/src/api/real.ts`
- Create: `apps/web/src/store/agentStore.ts`
- Test: `apps/web/src/store/agentStore.test.ts`

**说明:** `api/index.ts` barrel 用 `import * as real` 自动透出新增函数，无需手动登记。

- [ ] **Step 7.1: 写失败测试**

创建 `apps/web/src/store/agentStore.test.ts`：

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../api', () => ({
    api: {
        fetchAgents: vi.fn(),
        createAgent: vi.fn(),
        updateAgent: vi.fn(),
        deleteAgent: vi.fn(),
    },
}));

import type { Agent } from '@my-copilot/shared';
import { api } from '../api';
import { useAgentStore } from './agentStore';

const baseAgent: Agent = {
    id: 'a1', name: 'A', description: '', systemPrompt: '', modelId: null,
    parameters: {}, toolIds: ['calculator'], skillIds: [], mcpIds: [],
    enabled: true, createdAt: 1, updatedAt: 1,
};

describe('agentStore', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useAgentStore.setState({ agents: [], isLoading: false });
    });

    it('loadAgents populates state and clears loading', async () => {
        vi.mocked(api.fetchAgents).mockResolvedValue([baseAgent]);
        await useAgentStore.getState().loadAgents();
        expect(useAgentStore.getState().agents).toEqual([baseAgent]);
        expect(useAgentStore.getState().isLoading).toBe(false);
    });

    it('loadAgents swallows errors', async () => {
        vi.mocked(api.fetchAgents).mockRejectedValue(new Error('boom'));
        await useAgentStore.getState().loadAgents();
        expect(useAgentStore.getState().agents).toEqual([]);
        expect(useAgentStore.getState().isLoading).toBe(false);
    });

    it('createAgent prepends to list', async () => {
        vi.mocked(api.createAgent).mockResolvedValue(baseAgent);
        const created = await useAgentStore.getState().createAgent({ name: 'A' });
        expect(created.id).toBe('a1');
        expect(useAgentStore.getState().agents).toHaveLength(1);
    });

    it('updateAgent replaces entry in place', async () => {
        useAgentStore.setState({ agents: [baseAgent] });
        vi.mocked(api.updateAgent).mockResolvedValue({ ...baseAgent, name: 'B' });
        await useAgentStore.getState().updateAgent('a1', { name: 'B' });
        expect(useAgentStore.getState().agents[0]!.name).toBe('B');
    });

    it('deleteAgent removes entry', async () => {
        useAgentStore.setState({ agents: [baseAgent] });
        vi.mocked(api.deleteAgent).mockResolvedValue(undefined);
        await useAgentStore.getState().deleteAgent('a1');
        expect(useAgentStore.getState().agents).toHaveLength(0);
    });

    it('getAgentById handles null and unknown ids', () => {
        useAgentStore.setState({ agents: [baseAgent] });
        expect(useAgentStore.getState().getAgentById(null)).toBeUndefined();
        expect(useAgentStore.getState().getAgentById('nope')).toBeUndefined();
        expect(useAgentStore.getState().getAgentById('a1')?.name).toBe('A');
    });
});
```

- [ ] **Step 7.2: 运行确认失败**

Run: `pnpm --filter web exec vitest run src/store/agentStore.test.ts`
Expected: FAIL — 无法解析 `./agentStore`

- [ ] **Step 7.3: 实现 API 函数**

`apps/web/src/api/real.ts` — import 区的 shared 类型加 `Agent, CreateAgentParams, UpdateAgentParams`；文件末尾（Jobs API 之前或之后均可，建议放在 Skills/MCPs 之后）追加：

```ts
// ─── Agents API ───

/**
 * List DIY agents
 * GET /api/agents
 */
export async function fetchAgents(filter?: { enabled?: boolean }): Promise<Agent[]> {
    const query = filter?.enabled !== undefined ? `?enabled=${filter.enabled}` : '';
    const response = await enhancedFetch<{ data: Agent[] }>(`/api/agents${query}`, {
        method: 'GET',
        timeout: 30000,
    });
    return response.data;
}

/**
 * Create a DIY agent
 * POST /api/agents
 */
export async function createAgent(params: CreateAgentParams): Promise<Agent> {
    const response = await enhancedFetch<{ data: Agent }>('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
        timeout: 30000,
    });
    return response.data;
}

/**
 * Update a DIY agent
 * PATCH /api/agents/:id
 */
export async function updateAgent(id: string, params: UpdateAgentParams): Promise<Agent> {
    const response = await enhancedFetch<{ data: Agent }>(`/api/agents/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
        timeout: 30000,
    });
    return response.data;
}

/**
 * Delete a DIY agent
 * DELETE /api/agents/:id
 */
export async function deleteAgent(id: string): Promise<void> {
    await enhancedFetch<{ data: { deleted: boolean } }>(`/api/agents/${id}`, {
        method: 'DELETE',
        timeout: 30000,
    });
}
```

- [ ] **Step 7.4: 实现 agentStore**

创建 `apps/web/src/store/agentStore.ts`：

```ts
// Zustand - DIY Agent state management
import { create } from 'zustand';
import type { Agent, CreateAgentParams, UpdateAgentParams } from '@my-copilot/shared';
import { api } from '../api';

interface AgentStore {
    agents: Agent[];
    isLoading: boolean;
    loadAgents: () => Promise<void>;
    createAgent: (params: CreateAgentParams) => Promise<Agent>;
    updateAgent: (id: string, params: UpdateAgentParams) => Promise<Agent>;
    deleteAgent: (id: string) => Promise<void>;
    getAgentById: (id: string | null | undefined) => Agent | undefined;
}

export const useAgentStore = create<AgentStore>()((set, get) => ({
    agents: [],
    isLoading: false,

    loadAgents: async () => {
        set({ isLoading: true });
        try {
            const agents = await api.fetchAgents();
            set({ agents, isLoading: false });
        } catch (error) {
            console.error('Failed to load agents:', error);
            set({ isLoading: false });
        }
    },

    createAgent: async (params) => {
        const agent = await api.createAgent(params);
        set({ agents: [agent, ...get().agents] });
        return agent;
    },

    updateAgent: async (id, params) => {
        const agent = await api.updateAgent(id, params);
        set({ agents: get().agents.map((a) => (a.id === id ? agent : a)) });
        return agent;
    },

    deleteAgent: async (id) => {
        await api.deleteAgent(id);
        set({ agents: get().agents.filter((a) => a.id !== id) });
    },

    getAgentById: (id) => (id ? get().agents.find((a) => a.id === id) : undefined),
}));
```

- [ ] **Step 7.5: 运行确认通过 + 提交**

Run: `pnpm --filter web exec vitest run src/store/agentStore.test.ts`
Expected: PASS（6 个用例）

```bash
git add apps/web/src/api/real.ts apps/web/src/store/agentStore.ts apps/web/src/store/agentStore.test.ts
git commit -m "feat(web): add agents API client and agentStore"
```

---

### Task 8: AgentsPage 设置页 + AgentFormModal + 路由/侧栏入口

**Files:**
- Create: `apps/web/src/components/AgentFormModal.tsx`
- Create: `apps/web/src/views/settings/AgentsPage.tsx`
- Modify: `apps/web/src/router.tsx`
- Modify: `apps/web/src/components/Asider/index.tsx`

**说明:** 表单的 `parameters` 按"从简"决策暴露为三个可选数字输入（temperature/maxTokens/topP），服务端已做范围校验——比裸 JSON 编辑器更简单且类型安全。组件级行为通过手动验收覆盖（仓库无组件测试先例，`@testing-library/react` 未安装，不引入新依赖）。

- [ ] **Step 8.1: 实现 AgentFormModal**

创建 `apps/web/src/components/AgentFormModal.tsx`（overlay 结构对齐 `McpFormModal.tsx` 的既有写法，视觉 token 沿用 ToolsPage 所见）：

```tsx
// AgentFormModal - Create/edit a DIY agent (systemPrompt + model + tool/skill/mcp whitelists)

import { useEffect, useState } from 'react'
import type { Agent, CreateAgentParams, Mcp, Model, SkillMeta, Tool } from '@my-copilot/shared'
import { api } from '../api'
import { showMessageAlert } from './common/Alert/alertUtils'

interface AgentFormModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  agent?: Agent
  onSaved: () => void
}

function toggleId(
  setter: React.Dispatch<React.SetStateAction<Set<string>>>,
  id: string,
) {
  setter((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
}

function BindingPicker({
  title,
  hint,
  items,
  selected,
  onToggle,
  labelOf,
}: {
  title: string
  hint: string
  items: Array<{ id: string; enabled: boolean }>
  selected: Set<string>
  onToggle: (id: string) => void
  labelOf: (item: never) => string
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-text-primary">{title}</span>
      <span className="text-xs text-text-tertiary">{hint}</span>
      <div className="flex flex-col gap-1 max-h-40 overflow-y-auto rounded-lg border border-border-base p-2">
        {items.length === 0 ? (
          <span className="text-xs text-text-tertiary px-1 py-0.5">（无可用项）</span>
        ) : (
          items.map((item) => (
            <label
              key={item.id}
              className="flex items-center gap-2 px-1 py-0.5 text-sm text-text-primary hover:bg-bg-hover rounded cursor-pointer"
            >
              <input
                type="checkbox"
                checked={selected.has(item.id)}
                onChange={() => onToggle(item.id)}
                disabled={!item.enabled}
              />
              <span className={!item.enabled ? 'text-text-tertiary line-through' : ''}>
                {labelOf(item as never)}
              </span>
            </label>
          ))
        )}
      </div>
    </div>
  )
}

export default function AgentFormModal({ open, onOpenChange, agent, onSaved }: AgentFormModalProps) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [modelId, setModelId] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [toolIds, setToolIds] = useState<Set<string>>(new Set())
  const [skillIds, setSkillIds] = useState<Set<string>>(new Set())
  const [mcpIds, setMcpIds] = useState<Set<string>>(new Set())
  const [temperature, setTemperature] = useState('')
  const [maxTokens, setMaxTokens] = useState('')
  const [topP, setTopP] = useState('')
  const [allModels, setAllModels] = useState<Model[]>([])
  const [allTools, setAllTools] = useState<Tool[]>([])
  const [allSkills, setAllSkills] = useState<SkillMeta[]>([])
  const [allMcps, setAllMcps] = useState<Mcp[]>([])
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    Promise.all([api.fetchAllModels(), api.fetchTools(), api.fetchSkills(), api.fetchMcps()])
      .then(([models, tools, skills, mcps]) => {
        setAllModels(models)
        setAllTools(tools)
        setAllSkills(skills)
        setAllMcps(mcps)
        if (agent) {
          setName(agent.name)
          setDescription(agent.description)
          setSystemPrompt(agent.systemPrompt)
          setModelId(agent.modelId ?? '')
          setEnabled(agent.enabled)
          setToolIds(new Set(agent.toolIds))
          setSkillIds(new Set(agent.skillIds))
          setMcpIds(new Set(agent.mcpIds))
          setTemperature(agent.parameters.temperature?.toString() ?? '')
          setMaxTokens(agent.parameters.maxTokens?.toString() ?? '')
          setTopP(agent.parameters.topP?.toString() ?? '')
        } else {
          // 新建默认全选当前启用的工具/技能/MCP（设计文档绑定语义细则）
          setName('')
          setDescription('')
          setSystemPrompt('')
          setModelId('')
          setEnabled(true)
          setToolIds(new Set(tools.filter((t) => t.enabled).map((t) => t.id)))
          setSkillIds(new Set(skills.filter((s) => s.enabled).map((s) => s.id)))
          setMcpIds(new Set(mcps.filter((m) => m.enabled).map((m) => m.id)))
          setTemperature('')
          setMaxTokens('')
          setTopP('')
        }
      })
      .catch((error) => {
        console.error('Failed to load agent form data:', error)
        showMessageAlert.error('加载配置数据失败')
      })
  }, [open, agent])

  const handleSave = async () => {
    if (!name.trim()) {
      showMessageAlert.error('请填写 Agent 名称')
      return
    }
    const parameters: CreateAgentParams['parameters'] = {}
    if (temperature !== '') parameters.temperature = Number(temperature)
    if (maxTokens !== '') parameters.maxTokens = Number(maxTokens)
    if (topP !== '') parameters.topP = Number(topP)

    const params: CreateAgentParams = {
      name: name.trim(),
      description,
      systemPrompt,
      modelId: modelId || null,
      parameters,
      toolIds: [...toolIds],
      skillIds: [...skillIds],
      mcpIds: [...mcpIds],
      enabled,
    }

    setIsSaving(true)
    try {
      if (agent) {
        await api.updateAgent(agent.id, params)
        showMessageAlert.success('Agent 已更新')
      } else {
        await api.createAgent(params)
        showMessageAlert.success('Agent 已创建')
      }
      onOpenChange(false)
      onSaved()
    } catch (error) {
      console.error('Failed to save agent:', error)
      showMessageAlert.error('保存 Agent 失败')
    } finally {
      setIsSaving(false)
    }
  }

  if (!open) return null

  const inputClass =
    'w-full px-3 py-2 text-sm text-text-primary bg-bg-primary border border-border-base rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={() => onOpenChange(false)}
    >
      <div
        className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-xl bg-bg-primary border border-border-base p-6 flex flex-col gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold text-text-primary">
          {agent ? '编辑 Agent' : '新建 Agent'}
        </h3>

        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-text-primary">名称 *</span>
          <input
            className={inputClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：网页调研助手"
            maxLength={200}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-text-primary">描述</span>
          <input
            className={inputClass}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="这个 agent 做什么（可选）"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-text-primary">
            System Prompt（非空时替换默认系统提示）
          </span>
          <textarea
            className={`${inputClass} min-h-24 font-mono`}
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            placeholder="留空 = 使用默认助手提示"
          />
        </label>

        <div className="grid grid-cols-2 gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium text-text-primary">模型</span>
            <select
              className={inputClass}
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
            >
              <option value="">跟随会话模型</option>
              {allModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName || m.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium text-text-primary">启用状态</span>
            <select
              className={inputClass}
              value={enabled ? '1' : '0'}
              onChange={(e) => setEnabled(e.target.value === '1')}
            >
              <option value="1">启用（新建会话可选）</option>
              <option value="0">停用（已绑定会话仍可用）</option>
            </select>
          </label>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium text-text-primary">temperature</span>
            <input
              className={inputClass}
              type="number"
              step="0.1"
              min="0"
              max="2"
              value={temperature}
              onChange={(e) => setTemperature(e.target.value)}
              placeholder="0 - 2"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium text-text-primary">maxTokens</span>
            <input
              className={inputClass}
              type="number"
              min="1"
              step="1"
              value={maxTokens}
              onChange={(e) => setMaxTokens(e.target.value)}
              placeholder="正整数"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium text-text-primary">topP</span>
            <input
              className={inputClass}
              type="number"
              step="0.05"
              min="0"
              max="1"
              value={topP}
              onChange={(e) => setTopP(e.target.value)}
              placeholder="0 - 1"
            />
          </label>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <BindingPicker
            title="工具白名单"
            hint="未勾选的工具对该 agent 不可见"
            items={allTools}
            selected={toolIds}
            onToggle={(id) => toggleId(setToolIds, id)}
            labelOf={(t: Tool) => t.name}
          />
          <BindingPicker
            title="Skills 白名单"
            hint="仅注入勾选的 skills"
            items={allSkills}
            selected={skillIds}
            onToggle={(id) => toggleId(setSkillIds, id)}
            labelOf={(s: SkillMeta) => s.name}
          />
          <BindingPicker
            title="MCP 白名单"
            hint="勾选 server 的全部工具可用"
            items={allMcps}
            selected={mcpIds}
            onToggle={(id) => toggleId(setMcpIds, id)}
            labelOf={(m: Mcp) => m.name}
          />
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="px-4 py-2 text-sm bg-bg-secondary border border-border-base text-text-primary rounded-lg hover:bg-bg-hover transition-colors"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="px-4 py-2 text-sm bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors disabled:opacity-50"
          >
            {isSaving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}
```

注意：`BindingPicker` 的 `labelOf` 用函数子类型（`(t: Tool) => string` 等）传入 `labelOf: (item: never) => string` 参数位——若 TS 严格模式报逆变错误，直接把 `BindingPicker` 泛型化为 `BindingPicker<T extends { id: string; enabled: boolean }>`，`labelOf: (item: T) => string`（推荐，实现时一步到位）。

- [ ] **Step 8.2: 实现 AgentsPage**

创建 `apps/web/src/views/settings/AgentsPage.tsx`（结构对齐 ToolsPage）：

```tsx
// DIY Agent 管理：创建/编辑/启停/删除自定义 agent

import { useEffect, useState } from 'react'
import type { Agent } from '@my-copilot/shared'
import AgentFormModal from '../../components/AgentFormModal'
import { Badge } from '../../components/common/Badge'
import { showMessageAlert } from '../../components/common/Alert/alertUtils'
import { useAgentStore } from '../../store/agentStore'

export function AgentsPage() {
  const agents = useAgentStore((s) => s.agents)
  const isLoading = useAgentStore((s) => s.isLoading)
  const loadAgents = useAgentStore((s) => s.loadAgents)
  const updateAgent = useAgentStore((s) => s.updateAgent)
  const deleteAgent = useAgentStore((s) => s.deleteAgent)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editAgent, setEditAgent] = useState<Agent | undefined>()
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    loadAgents()
  }, [loadAgents])

  const handleCreate = () => {
    setEditAgent(undefined)
    setIsModalOpen(true)
  }

  const handleEdit = (agent: Agent) => {
    setEditAgent(agent)
    setIsModalOpen(true)
  }

  const handleToggleEnabled = async (agent: Agent) => {
    setTogglingIds((prev) => new Set(prev).add(agent.id))
    try {
      await updateAgent(agent.id, { enabled: !agent.enabled })
    } catch (error) {
      console.error('Failed to toggle agent enabled:', error)
      showMessageAlert.error('切换状态失败')
    } finally {
      setTogglingIds((prev) => {
        const next = new Set(prev)
        next.delete(agent.id)
        return next
      })
    }
  }

  const handleDelete = async (agent: Agent) => {
    if (!window.confirm(`确定删除 Agent「${agent.name}」？已绑定它的会话将退回默认助手。`)) return
    try {
      await deleteAgent(agent.id)
      showMessageAlert.success('Agent 已删除')
    } catch (error) {
      console.error('Failed to delete agent:', error)
      showMessageAlert.error('删除 Agent 失败')
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-medium text-text-primary">Agent 管理</h2>
          <p className="mt-1 text-xs text-text-secondary">
            自定义 system prompt、模型与工具/技能/MCP 白名单；新建会话时选择生效。
          </p>
        </div>
        <button
          onClick={handleCreate}
          className="px-4 py-2 text-sm bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors"
        >
          新建 Agent
        </button>
      </div>

      {isLoading ? (
        <div className="text-sm text-text-secondary">加载中...</div>
      ) : agents.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border-base px-6 py-10 text-center">
          <p className="text-sm text-text-secondary">还没有自定义 Agent</p>
          <p className="mt-1 text-xs text-text-tertiary">
            创建一个试试：指定 system prompt、模型和工具白名单。
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {agents.map((agent) => (
            <div
              key={agent.id}
              className="flex items-center justify-between p-4 bg-bg-secondary border border-border-base rounded-lg hover:border-primary-400 transition-colors"
            >
              <div className="flex flex-col gap-1 min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-text-primary">{agent.name}</span>
                  {!agent.enabled && <Badge colorClass="bg-gray-100 text-gray-500">已停用</Badge>}
                  {agent.modelId && <Badge colorClass="bg-blue-100 text-blue-700">指定模型</Badge>}
                  {agent.systemPrompt && (
                    <Badge colorClass="bg-amber-100 text-amber-700">自定义提示</Badge>
                  )}
                </div>
                <span className="text-xs text-text-secondary truncate">
                  {agent.description || '—'}
                </span>
                <span className="text-xs text-text-tertiary">
                  工具 {agent.toolIds.length} · Skills {agent.skillIds.length} · MCP{' '}
                  {agent.mcpIds.length}
                </span>
              </div>
              <div className="flex items-center gap-3 shrink-0 pl-4">
                <button
                  onClick={() => handleToggleEnabled(agent)}
                  disabled={togglingIds.has(agent.id)}
                  className="px-3 py-1.5 text-xs bg-bg-primary border border-border-base text-text-primary rounded-lg hover:bg-bg-hover transition-colors disabled:opacity-40"
                >
                  {agent.enabled ? '停用' : '启用'}
                </button>
                <button
                  onClick={() => handleEdit(agent)}
                  className="px-3 py-1.5 text-xs bg-bg-primary border border-border-base text-text-primary rounded-lg hover:bg-bg-hover transition-colors"
                >
                  编辑
                </button>
                <button
                  onClick={() => handleDelete(agent)}
                  className="px-3 py-1.5 text-xs bg-red-50 border border-red-200 text-red-600 rounded-lg hover:bg-red-100 transition-colors"
                >
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <AgentFormModal
        open={isModalOpen}
        onOpenChange={setIsModalOpen}
        agent={editAgent}
        onSaved={() => loadAgents()}
      />
    </div>
  )
}
```

- [ ] **Step 8.3: 注册路由与侧栏入口**

`apps/web/src/router.tsx` — import 区加 `import { AgentsPage } from './views/settings/AgentsPage';`，settings children 中（`tools` 之前）加：

```tsx
          { path: 'agents', element: <AgentsPage /> },
```

`apps/web/src/components/Asider/index.tsx` — footer 设置数组中（`providers` 之前）加一项：

```tsx
            { key: 'agents', label: 'Agents', icon: '🤖' },
```

- [ ] **Step 8.4: 验证 + 提交**

Run: `pnpm --filter web typecheck`
Expected: PASS

```bash
git add apps/web/src/components/AgentFormModal.tsx apps/web/src/views/settings/AgentsPage.tsx apps/web/src/router.tsx apps/web/src/components/Asider/index.tsx
git commit -m "feat(web): add Agents settings page with binding pickers and nav entries"
```

---

### Task 9: 会话绑定（ChatShell agent 选择器 + 懒建会话传参）

**Files:**
- Modify: `apps/web/src/store/sessionStore.ts`
- Modify: `apps/web/src/components/ChatShell/index.tsx`

- [ ] **Step 9.1: sessionStore 增加 pendingAgentId**

`apps/web/src/store/sessionStore.ts`：

1. `SessionStore` 接口（`pendingModelId` 相关行之后）加：

```ts
    /** Agent selected for the pending (not-yet-created) session */
    pendingAgentId: string | null;
```

及 actions 区（`setPendingModelId` 声明之后）加：

```ts
    /** Set agent for pending session */
    setPendingAgentId: (agentId: string | null) => void;
```

2. 初始 state（`pendingModelId: null,` 之后）加 `pendingAgentId: null,`
3. actions 实现（`setPendingModelId` 之后）加：

```ts
        setPendingAgentId: (agentId) => {
            set({ pendingAgentId: agentId });
        },
```

4. `sendMessage` 中解构改为包含 `pendingAgentId`（`const { addMessage, updateMessage, updateSessionSummary, createSession, pendingModelId, pendingAgentId } = get();`）；懒建分支改为：

```ts
            if (sessionId === NEW_SESSION_SENTINEL) {
                const session = await createSession({
                    title: '新对话',
                    modelId: pendingModelId ?? undefined,
                    agentId: pendingAgentId ?? undefined,
                });
                realSessionId = session.id;
                set({ selectedSessionId: realSessionId, pendingModelId: null, pendingAgentId: null });
            }
```

- [ ] **Step 9.2: ChatShell 加 agent 选择器**

`apps/web/src/components/ChatShell/index.tsx`：

1. import 区加：

```ts
import { useAgentStore } from '../../store/agentStore'
```

2. 组件内（`setActiveJobId` 选择器之后）加：

```ts
  const agents = useAgentStore((state) => state.agents)
  const loadAgents = useAgentStore((state) => state.loadAgents)
  const pendingAgentId = useSessionStore((state) => state.pendingAgentId)
  const setPendingAgentId = useSessionStore((state) => state.setPendingAgentId)
```

3. 模型加载 effect 旁（`useEffect(() => { if (!authToken) return; loadModels() }, ...)` 之后）加：

```ts
  // Load agents alongside models (same token-gated pattern)
  useEffect(() => {
    if (!authToken) return
    loadAgents()
  }, [authToken, loadAgents])
```

4. `effectiveModelId` 定义之后加：

```ts
  // Effective agent: pending for new session, bound agent for existing session
  const effectiveAgentId = selectedSessionId === NEW_SESSION_SENTINEL
    ? pendingAgentId
    : currentSession?.agentId ?? null
  const boundAgent = agents.find((a) => a.id === effectiveAgentId)
  const enabledAgents = agents.filter((a) => a.enabled)

  const handleAgentChange = async (agentId: string) => {
    try {
      if (selectedSessionId === NEW_SESSION_SENTINEL) {
        setPendingAgentId(agentId || null)
      } else if (selectedSessionId) {
        // 仅作用于后续轮次；历史消息不动（设计文档 v1 决策）
        await updateSession(selectedSessionId, { agentId: agentId || null })
      }
    } catch (error) {
      console.error('Failed to update session agent:', error)
      showMessageAlert.error('切换 Agent 失败')
    }
  }
```

5. 模型选择栏 JSX（`<span ...>模型</span>` 之前）插入 agent 选择器；模型 `<select>` 在 agent 指定模型时禁用并提示：

```tsx
        <span className="text-sm text-text-secondary shrink-0">Agent</span>
        <select
          value={effectiveAgentId || ''}
          onChange={(e) => handleAgentChange(e.target.value)}
          className="flex-1 min-w-0 max-w-xs px-3 py-1.5 text-sm text-text-primary bg-bg-primary border border-border-base rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all"
        >
          <option value="">默认助手</option>
          {enabledAgents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name}
            </option>
          ))}
        </select>
```

模型 `<select>` 标签加 `disabled={!!boundAgent?.modelId}`，且其后追加提示：

```tsx
        {boundAgent?.modelId && (
          <span className="text-xs text-text-tertiary shrink-0">模型由 agent 指定</span>
        )}
```

（`handleModelChange` 逻辑不变——被禁用后无法触发。）

- [ ] **Step 9.3: 验证 + 提交**

Run: `pnpm --filter web typecheck && pnpm --filter web exec vitest run src/store`
Expected: PASS

```bash
git add apps/web/src/store/sessionStore.ts apps/web/src/components/ChatShell/index.tsx
git commit -m "feat(web): add session-level agent selector and lazy-create binding"
```

---

### Task 10: 全量验证 + 手动验收

- [ ] **Step 10.1: 全量自动化验证**

Run: `pnpm typecheck && pnpm --filter server test && pnpm --filter web test && pnpm lint`
Expected: 全部 PASS（含既有测试回归；`pnpm test` 等价可替代两条 filter 命令）

- [ ] **Step 10.2: 手动验收（pnpm dev，AGENT_ASYNC_MODE 两种模式各验一次）**

1. 设置 → Agents → 新建：名称"网页调研助手"，systemPrompt 填入角色提示，工具白名单只勾 `web_search` + `http_fetch`，模型选"跟随会话"→ 保存
2. 新建会话 → 顶部 Agent 选择器选"网页调研助手" → 发消息触发一次工具调用
3. 验证边界：模型只能看到/调用 `web_search`、`http_fetch`（让模型尝试算术，应无 calculator 可用；danger/restricted 工具的确认流照常弹出）
4. 验证 systemPrompt 替换生效（回复风格/语言符合自定义提示）
5. 会话中途切回"默认助手" → 下一轮起恢复全部启用工具与默认提示，历史消息不变
6. 编辑该 agent 指定固定模型 → 发消息验证模型切换；再删除该模型 → 发消息验证回退会话模型 + 服务端 warn 日志
7. 删除 agent → 已绑定会话自动回到默认助手，可继续对话
8. 停用 agent → 新建会话选择器不出现，已绑定会话继续可用

- [ ] **Step 10.3: 收尾提交（如有验收修复）**

```bash
git add -A
git commit -m "fix: address findings from DIY agent manual acceptance"
```

（无修复则跳过。）

---

## 自审记录（writing-plans Self-Review）

1. **规格覆盖**：设计文档全部章节均映射到 Task 1-10（数据模型→T1、repo→T2、session 绑定→T3、路由→T4、prompt 替换→T5、运行链路/模型覆盖/skills 缺口→T6、前端 API/store→T7、管理 UI→T8、会话绑定 UI→T9、测试策略/手动验收→各任务+T10）。规格测试策略中"executor 有效集过滤"由 T6 `agent-context.test.ts` 承担（设计文档已更新：过滤点在 lifecycle/worker 的解析器，executor 不改）。
2. **占位符**：无 TBD/TODO；所有代码步骤含完整代码。
3. **类型一致性**：`resolveAgentContext` 签名与返回结构在 T6 三个消费点（lifecycle/worker/测试）一致；`CreateAgentParams`/`Session.agentId`/`AgentLoopJobPayload.agentId` 跨任务一致。
4. **有意偏离（已注明理由）**：① 前端 parameters 用三个数字输入而非裸 JSON（服务端已校验，更简单类型安全）；② 组件级行为测试以手动验收替代（仓库无组件测试先例，不引入 `@testing-library/react` 新依赖）；③ 计划存放于 `docs/` 根目录带日期前缀（仓库先例），而非技能默认的 `docs/superpowers/plans/`。




