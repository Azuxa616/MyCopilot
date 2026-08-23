# Skill 系统升级（P0+P1）实施计划

> **执行记录（2026-08-22，分支 `skill-system-upgrade`）：** 计划已全部执行完毕（Task 1-10）并通过终审。与原文的偏差：
> - **迁移编号**：计划原文的 `0005_skill_files.sql` 实际落地为 **`0006_skill_files.sql`**（0005 被并发的 plugin 系统迁移 `0005_plugins.sql` 占用）
> - **Task 1 形态**：P0 采纳了工作区已存在的 `prompt/skill-injections.ts`（`buildSkillInjections()`）实现（commit `e3349f3`，在 prase-2-dev 主分支），未新建 `agent-loop/agent-context.ts`；diy-agent 计划扩展该文件加白名单参数
> - **终审修复**（`2313df4`）：sync 增加 triggers-only 变更检测；repo 的 createSkill/updateSkill/replaceSkillFiles 包 `db.transaction`；zip 附属文件路径净化（`isSafeSkillFilePath`）+ 嵌套形态剥离 pack 根前缀；PATCH `/:id` 校验 files 路径
> - **Shared 类型**：`SkillSource` 因并发 plugin 工作新增 `'plugin'` 枚举值，与本计划新增类型合并保留

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 skills 注入链路缺口（P0），并把 skill 从单文件升级为目录包模型（`SKILL.md` + 附属文件），补齐编辑 UI 与 ZIP 导入（P1）。

**Architecture:** 新建 `agent-loop/agent-context.ts` 作为 skill 注入唯一解析点（lifecycle/worker 共用，diy-agent 计划将原地扩展为 `resolveAgentContext`）；数据层新增 `skill_files` 表（迁移 0005）+ `skills.triggers` 列，repo 层 files 全量替换语义；scanner 双模式（目录包 + 平铺兼容）；ZIP 导入经 `fflate` 解压后走既有 `createSkill`。前端补编辑模式（复用 `SkillFormModal`）与导入入口。

**Tech Stack:** Hono 4 + better-sqlite3 + fflate（新增，server）、React 19 + @testing-library/react（web）、Vitest（双环境）、`@my-copilot/shared` 类型。

**规格来源:** `docs/2026-08-22-skill-system-upgrade-design.md`（已获用户批准，覆盖其 P0 + P1 阶段；P2/P3 另行计划）

**关键设计决策（已锁定，源自设计文档决策记录）:**
- `skills.body` 继续存 `SKILL.md` 正文；附属文件入 `skill_files` 表；`SKILL.md` 本身不入 `skill_files`（避免双写）
- 附属文件限额：单文件 ≤ 256 KB、每 skill ≤ 20 个、总量 ≤ 1 MB、仅文本扩展名白名单；`scripts/` 一律跳过
- 导入（ZIP）落库为 `source = 'upload'`（可编辑副本），不新增来源枚举
- 目录同步双模式并存：`<name>/SKILL.md` 目录包 + 旧平铺 `*.md`，不做破坏切换
- **不做**：skill 可执行脚本、glob 作用域、workspace 实体、`always`/`read_skill`（P2）

**与 DIY agent 计划的执行顺序协调（重要）:**
- `docs/2026-08-15-diy-agent-plan.md`（未执行）的 Task 6 也计划创建 `agent-loop/agent-context.ts` 并顺带修 skills 链路。**若该计划先执行，本计划 Task 1 整体跳过**（其 Task 6 已覆盖 P0）。
- 若本计划先执行（默认路径）：Task 1 创建 `agent-context.ts` 最小版；diy-agent 计划执行时其 Task 6 应改为"扩展已有文件"——在文件中加入 `globallyEnabledTools()` 与 `resolveAgentContext()`，`skillInjections()` 原样复用。
- **迁移编号竞态**：当前磁盘最新迁移为 `0004_memories.sql`，本计划使用 `0005_skill_files.sql`。若 diy-agent 迁移先落地（其文档误写为 0004，实际应取下一可用编号），本计划迁移文件改名为下一可用编号，内容不变。

**新依赖说明（项目规则要求）:** `fflate`（server）——零依赖纯 TypeScript zip 解压库，`unzipSync` 同步 API 无需流式处理；备选 `adm-zip` 需额外 `@types` 且有历史 CVE（prototype pollution），备选 `unzipper` 流式 API 对 ≤1 MB 的 skill 包过重。测试中同时用其 `zipSync` 构造测试 ZIP，无需 fixture 文件。

**命令约定（均在仓库根 `F:\MyProjects\MyCopilot` 执行）:**
- 定向测试：`pnpm --filter server exec vitest run <路径>` / `pnpm --filter web exec vitest run <路径>`
- 全量验证：`pnpm typecheck && pnpm --filter server test && pnpm --filter web test && pnpm lint`
- 每个 Task 完成且定向测试通过后提交一次（conventional commit）；若所在会话约定不自动提交，跳过 commit 步骤

---

### Task 1: P0 — skills 注入链路修复（采纳现有实现）

> **修订（2026-08-22 执行时）：** 工作区已存在一份未提交的 P0 实现（`prompt/skill-injections.ts` 的 `buildSkillInjections()` + lifecycle/worker 接线）。经用户确认：**保留该形态**，本任务改为"验证 + 采纳 + 补缺口"。白名单参数版（`skillInjections(boundSkillIds)`）留给 diy-agent 计划在其 Task 6 中扩展该文件。原 `agent-loop/agent-context.ts` 方案作废。

**Files:**
- Verify: `apps/server/src/prompt/skill-injections.ts`（已存在）
- Verify: `apps/server/src/prompt/__tests__/skill-injections.test.ts`（已存在，3 用例）
- Verify: `apps/server/src/streaming/lifecycle.ts`（已接线：import + `skills: buildSkillInjections()`）
- Verify: `apps/server/src/jobs/worker.ts`（已接线：动态 import + 执行期解析）
- Test: `apps/server/src/streaming/__tests__/lifecycle.test.ts`（确认 skills 断言存在）

- [ ] **Step 1.1: 验证现有测试全绿**

Run: `pnpm --filter server exec vitest run src/prompt/__tests__/skill-injections.test.ts src/streaming/__tests__/lifecycle.test.ts src/prompt`
Expected: 全部 PASS

- [ ] **Step 1.2: 验证接线完整性**

确认两点（读代码，不改动）：
1. `lifecycle.ts` 同步路径：`runAgentLoop` 调用含 `skills: buildSkillInjections()`
2. `worker.ts` 异步路径：`registerAgentLoopHandler` 的 context 构造含 `skills: buildSkillInjections()`（执行期解析，非 payload 快照）

若有任一缺失，按上述形态补齐（`prompt/skill-injections.ts` 是唯一 skills 来源）。

- [ ] **Step 1.3: 补测试缺口（如有）**

若 `lifecycle.test.ts` 未覆盖"skills 被传给 runAgentLoop"的断言，补一条最小断言用例（mock `buildSkillInjections` 返回 `[{name:'S', body:'B'}]`，断言 `runAgentLoop` 收到该参数）。已有则跳过。

- [ ] **Step 1.4: 回归验证**

Run: `pnpm --filter server exec vitest run src/streaming src/routes/__tests__/messages.test.ts src/agent-loop src/prompt`
Expected: 全部 PASS

- [ ] **Step 1.5: Commit（仅本任务文件组）**

```bash
git add apps/server/src/prompt/skill-injections.ts apps/server/src/prompt/__tests__/skill-injections.test.ts apps/server/src/streaming/lifecycle.ts apps/server/src/streaming/__tests__/lifecycle.test.ts apps/server/src/jobs/worker.ts
git commit -m "fix(server): wire skills injection into sync/async agent loop (P0)"
```

---

### Task 2: Shared 类型扩展

**Files:**
- Modify: `packages/shared/src/skill.ts`

**说明:** `SkillFrontmatter` 不动（`always` 属 P2）。`triggers` 解析 parser 已支持，本任务只打通持久化链路的类型。

- [ ] **Step 2.1: 扩展 skill.ts**

`packages/shared/src/skill.ts` 全量替换为：

```ts
export interface SkillFrontmatter {
  name: string;
  description: string;
  triggers?: string[];
  version?: string;
}

export type SkillSource = 'directory' | 'upload';

/** skill 目录包的附属文件元数据（列表用，不含内容）。 */
export interface SkillFileMeta {
  /** 相对 skill 根目录的 posix 风格路径，如 'references/api.md'。 */
  path: string;
  size: number;
}

/** 创建/更新 skill 时传入的附属文件（含内容）。 */
export interface SkillFileInput {
  path: string;
  content: string;
}

export interface SkillMeta {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  source?: SkillSource;
  filePath?: string;
  /** frontmatter triggers（解析后持久化；缺省为空数组语义）。 */
  triggers?: string[];
  /** 附属文件数量（目录包模型；平铺/无附属为 0）。 */
  fileCount?: number;
}

export interface SkillDetail extends SkillMeta {
  content: string;
  /** 附属文件元数据列表（内容按需经 GET /api/skills/:id/files/:path 获取）。 */
  files?: SkillFileMeta[];
}

export interface ParsedSkill {
  frontmatter: SkillFrontmatter;
  body: string;
  raw: string;
}

export interface CreateSkillParams {
  name: string;
  description: string;
  body: string;
  source: SkillSource;
  filePath?: string;
  enabled?: boolean;
  triggers?: string[];
  files?: SkillFileInput[];
}

export interface UpdateSkillParams {
  name?: string;
  description?: string;
  body?: string;
  enabled?: boolean;
  triggers?: string[];
  /** 提供时全量替换该 skill 的附属文件。 */
  files?: SkillFileInput[];
}
```

- [ ] **Step 2.2: 类型检查**

Run: `pnpm --filter shared typecheck 2>$null; if ($LASTEXITCODE -ne 0) { pnpm --filter shared exec tsc --noEmit }`
Expected: PASS（shared 无运行时逻辑，类型变更由 `pnpm typecheck` 全仓验证；既有消费方只读取既有字段，新增字段全部可选，零破坏）

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 2.3: Commit**

```bash
git add packages/shared/src/skill.ts
git commit -m "feat(shared): add skill pack types (files, triggers) for skill system upgrade"
```

---

### Task 3: 迁移 0005 + repo 扩展（triggers / skill_files）

**Files:**
- Create: `apps/server/src/migration/sql/0005_skill_files.sql`
- Create: `apps/server/src/migration/__tests__/0005-skill-files.test.ts`
- Modify: `apps/server/src/repo/skill.ts`
- Test: `apps/server/src/repo/__tests__/skill.test.ts`（追加用例）

- [ ] **Step 3.1: 写失败测试（迁移）**

创建 `apps/server/src/migration/__tests__/0005-skill-files.test.ts`：

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initDatabase, getDb } from '../../db/index.js';

describe('migration 0005 skill files', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'migration-0005-'));
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

  it('creates skill_files table with expected columns and unique constraint', () => {
    const cols = getDb().prepare('PRAGMA table_info(skill_files)').all() as Array<{ name: string }>;
    expect(cols.map((c) => c.name)).toEqual(
      expect.arrayContaining(['id', 'skill_id', 'path', 'content', 'created_at', 'updated_at']),
    );
  });

  it('adds triggers column to skills with default []', () => {
    const cols = getDb().prepare('PRAGMA table_info(skills)').all() as Array<{ name: string }>;
    expect(cols.map((c) => c.name)).toContain('triggers');

    getDb().prepare(
      "INSERT INTO skills (id, name, description, body, source, enabled, created_at, updated_at) VALUES ('s1', 'T', '', 'b', 'upload', 1, 1, 1)",
    ).run();
    const row = getDb().prepare("SELECT triggers FROM skills WHERE id = 's1'").get() as { triggers: string };
    expect(JSON.parse(row.triggers)).toEqual([]);
  });

  it('enforces unique (skill_id, path) and cascades skill deletion', () => {
    const db = getDb();
    db.prepare(
      "INSERT INTO skills (id, name, description, body, source, enabled, created_at, updated_at) VALUES ('s1', 'T', '', 'b', 'upload', 1, 1, 1)",
    ).run();
    db.prepare(
      "INSERT INTO skill_files (id, skill_id, path, content, created_at, updated_at) VALUES ('f1', 's1', 'references/a.md', 'x', 1, 1)",
    ).run();

    // unique(skill_id, path)
    let duplicateRejected = false;
    try {
      db.prepare(
        "INSERT INTO skill_files (id, skill_id, path, content, created_at, updated_at) VALUES ('f2', 's1', 'references/a.md', 'y', 1, 1)",
      ).run();
    } catch {
      duplicateRejected = true;
    }
    expect(duplicateRejected).toBe(true);

    // cascade
    db.prepare("DELETE FROM skills WHERE id = 's1'").run();
    const n = db.prepare('SELECT COUNT(*) as n FROM skill_files').get() as { n: number };
    expect(n.n).toBe(0);
  });
});
```

- [ ] **Step 3.2: 运行确认失败**

Run: `pnpm --filter server exec vitest run src/migration/__tests__/0005-skill-files.test.ts`
Expected: FAIL（`no such table: skill_files`）

- [ ] **Step 3.3: 写迁移**

创建 `apps/server/src/migration/sql/0005_skill_files.sql`（⚠️ 若 diy-agent 迁移已先落地占用 0005，本文件改为下一可用编号）：

```sql
-- Skill 目录包模型（设计 docs/2026-08-22-skill-system-upgrade-design.md）
-- 附属文件表：SKILL.md 正文仍在 skills.body，附属文件（references/assets）入本表。
CREATE TABLE skill_files (
  id TEXT PRIMARY KEY,
  skill_id TEXT NOT NULL,
  path TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE,
  UNIQUE (skill_id, path)
);
CREATE INDEX IF NOT EXISTS idx_skill_files_skill_id ON skill_files(skill_id);

-- frontmatter triggers 持久化（JSON string[]，缺省 '[]'）。
ALTER TABLE skills ADD COLUMN triggers TEXT NOT NULL DEFAULT '[]';
```

- [ ] **Step 3.4: 运行确认迁移测试通过**

Run: `pnpm --filter server exec vitest run src/migration/__tests__/0005-skill-files.test.ts`
Expected: PASS（3 个用例）

- [ ] **Step 3.5: 写失败测试（repo 扩展）**

在 `apps/server/src/repo/__tests__/skill.test.ts` 的 `describe('SkillRepo', ...)` 内追加（import 区补 `listSkillFiles, getSkillFile` 到现有 repo import，`SkillFileInput` 到 shared import）：

```ts
  it('createSkill persists triggers and files; listSkillFiles/getSkillFile read them back', () => {
    const skill = createSkill({
      name: 'Pack',
      description: 'dir-pack skill',
      body: '# entry',
      source: 'upload',
      triggers: ['review', '评审'],
      files: [
        { path: 'references/api.md', content: 'api doc' },
        { path: 'assets/tpl.txt', content: 'template' },
      ],
    });

    expect(skill.triggers).toEqual(['review', '评审']);
    expect(skill.fileCount).toBe(2);

    const detail = getSkill(skill.id);
    expect(detail?.files).toEqual([
      { path: 'references/api.md', size: 7 },
      { path: 'assets/tpl.txt', size: 8 },
    ]);

    expect(getSkillFile(skill.id, 'references/api.md')).toEqual({
      path: 'references/api.md',
      content: 'api doc',
    });
    expect(getSkillFile(skill.id, 'nope.md')).toBeUndefined();
  });

  it('updateSkill with files fully replaces the file set', () => {
    const skill = createSkill({
      name: 'Pack',
      description: '',
      body: 'b',
      source: 'upload',
      files: [
        { path: 'a.md', content: 'a' },
        { path: 'b.md', content: 'b' },
      ],
    });

    const updated = updateSkill(skill.id, {
      files: [{ path: 'b.md', content: 'b2' }, { path: 'c.md', content: 'c' }],
    });

    expect(updated?.fileCount).toBe(2);
    expect(listSkillFiles(skill.id).map((f) => f.path).sort()).toEqual(['b.md', 'c.md']);
    expect(getSkillFile(skill.id, 'b.md')?.content).toBe('b2');
    expect(getSkillFile(skill.id, 'a.md')).toBeUndefined();
  });

  it('updateSkill without files leaves the file set untouched', () => {
    const skill = createSkill({
      name: 'Pack',
      description: '',
      body: 'b',
      source: 'upload',
      files: [{ path: 'a.md', content: 'a' }],
    });

    updateSkill(skill.id, { name: 'Renamed' });
    expect(listSkillFiles(skill.id)).toEqual([{ path: 'a.md', size: 1 }]);
  });

  it('updateSkill persists triggers', () => {
    const skill = createSkill({ name: 'T', description: '', body: 'b', source: 'upload' });
    const updated = updateSkill(skill.id, { triggers: ['x'] });
    expect(updated?.triggers).toEqual(['x']);
    expect(getSkill(skill.id)?.triggers).toEqual(['x']);
  });

  it('deleteSkill cascades to skill_files', () => {
    const skill = createSkill({
      name: 'Pack',
      description: '',
      body: 'b',
      source: 'upload',
      files: [{ path: 'a.md', content: 'a' }],
    });

    deleteSkill(skill.id);
    expect(listSkillFiles(skill.id)).toEqual([]);
  });

  it('listSkills returns fileCount aggregated', () => {
    createSkill({
      name: 'WithFiles',
      description: '',
      body: 'b',
      source: 'upload',
      files: [{ path: 'a.md', content: 'a' }, { path: 'b.md', content: 'b' }],
    });
    createSkill({ name: 'Bare', description: '', body: 'b', source: 'upload' });

    const names = new Map(listSkills().map((s) => [s.name, s.fileCount ?? 0]));
    expect(names.get('WithFiles')).toBe(2);
    expect(names.get('Bare')).toBe(0);
  });
```

- [ ] **Step 3.6: 运行确认失败**

Run: `pnpm --filter server exec vitest run src/repo/__tests__/skill.test.ts`
Expected: 新用例 FAIL（`triggers`/`files` 未持久化），既有用例 PASS

- [ ] **Step 3.7: 扩展 repo/skill.ts**

`apps/server/src/repo/skill.ts` 修改点（保持既有函数签名兼容）：

1. import 区替换为：

```ts
import type {
  SkillMeta,
  SkillDetail,
  CreateSkillParams,
  UpdateSkillParams,
  SkillSource,
  SkillFileMeta,
  SkillFileInput,
} from '@my-copilot/shared';
import { getDb } from '../db/index.js';
import { generateId, now } from './base.js';
```

2. `SkillRow` 加一列 `triggers: string;`；新增内部接口：

```ts
interface SkillFileRow {
  id: string;
  skill_id: string;
  path: string;
  content: string;
  created_at: number;
  updated_at: number;
}
```

3. 新增辅助函数（放在 `rowToMeta` 之前）：

```ts
function parseTriggers(raw: string): string[] | undefined {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((t) => typeof t === 'string') && parsed.length > 0) {
      return parsed;
    }
  } catch {
    // fallthrough: 坏数据按"无 triggers"处理
  }
  return undefined;
}

/** 全量替换某 skill 的附属文件（DELETE + INSERT，单事务）。 */
function replaceSkillFiles(skillId: string, files: SkillFileInput[]): void {
  const db = getDb();
  const ts = now();
  db.prepare('DELETE FROM skill_files WHERE skill_id = ?').run(skillId);
  const insert = db.prepare(
    `INSERT INTO skill_files (id, skill_id, path, content, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const f of files) {
    insert.run(generateId(), skillId, f.path, f.content, ts, ts);
  }
}

function listSkillFileRows(skillId: string): SkillFileRow[] {
  return getDb()
    .prepare('SELECT * FROM skill_files WHERE skill_id = ? ORDER BY path')
    .all(skillId) as SkillFileRow[];
}
```

4. `rowToMeta` 加 triggers（fileCount 由 listSkills/getSkill 单独聚合填充）：

```ts
function rowToMeta(row: SkillRow, fileCount = 0): SkillMeta {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    enabled: Boolean(row.enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    source: row.source as SkillSource,
    filePath: row.file_path ?? undefined,
    triggers: parseTriggers(row.triggers),
    fileCount,
  };
}
```

5. `rowToDetail` 扩展：

```ts
function rowToDetail(row: SkillRow): SkillDetail {
  const fileRows = listSkillFileRows(row.id);
  return {
    ...rowToMeta(row, fileRows.length),
    content: row.body,
    files: fileRows.map((f) => ({ path: f.path, size: f.content.length })),
  };
}
```

6. `listSkills` 末尾改为带聚合（替换 `return rows.map(rowToMeta);`）：

```ts
  const counts = new Map(
    (
      db
        .prepare('SELECT skill_id, COUNT(*) as n FROM skill_files GROUP BY skill_id')
        .all() as Array<{ skill_id: string; n: number }>
    ).map((r) => [r.skill_id, r.n]),
  );
  return rows.map((row) => rowToMeta(row, counts.get(row.id) ?? 0));
```

7. `createSkill`：INSERT 语句的列与值都补 `triggers`（`params.triggers ? JSON.stringify(params.triggers) : '[]'`），INSERT 成功后：

```ts
  if (params.files && params.files.length > 0) {
    replaceSkillFiles(id, params.files);
  }
```

返回对象补 `triggers: params.triggers, fileCount: params.files?.length ?? 0, files: params.files?.map((f) => ({ path: f.path, size: f.content.length }))`（`SkillDetail.files` 可选，直接给全量形态）。

8. `updateSkill`：读取 `params.triggers ?? existing.triggers`（existing.triggers 是 JSON 字符串，直接透传）；`params.files !== undefined` 时 UPDATE 后调 `replaceSkillFiles(id, params.files)`；返回对象补 `triggers` / `fileCount` / `files`（与 rowToDetail 对齐——updateSkill 返回值改用 `rowToDetail` 风格组装，或 update 后 `return getSkill(id)`，取后者最简：函数末尾 `return getSkill(id);`）。

9. 文件末尾导出新函数：

```ts
export function listSkillFiles(skillId: string): SkillFileMeta[] {
  return listSkillFileRows(skillId).map((f) => ({ path: f.path, size: f.content.length }));
}

export function getSkillFile(
  skillId: string,
  path: string,
): { path: string; content: string } | undefined {
  const row = getDb()
    .prepare('SELECT * FROM skill_files WHERE skill_id = ? AND path = ?')
    .get(skillId, path) as SkillFileRow | undefined;
  return row ? { path: row.path, content: row.content } : undefined;
}
```

- [ ] **Step 3.8: 运行确认通过**

Run: `pnpm --filter server exec vitest run src/repo/__tests__/skill.test.ts`
Expected: 全部 PASS（既有 + 新增 6 个用例）

- [ ] **Step 3.9: Commit**

```bash
git add apps/server/src/migration/sql/0005_skill_files.sql apps/server/src/migration/__tests__/0005-skill-files.test.ts apps/server/src/repo/skill.ts apps/server/src/repo/__tests__/skill.test.ts
git commit -m "feat(server): skill pack storage — skill_files table, triggers column, repo CRUD"
```

---

### Task 4: scanner 双模式扫描（目录包 + 平铺兼容）

**Files:**
- Create: `apps/server/src/skills/limits.ts`
- Create: `apps/server/src/skills/__tests__/limits.test.ts`
- Modify: `apps/server/src/skills/scanner.ts`
- Test: `apps/server/src/skills/__tests__/scanner.test.ts`（追加用例）

- [ ] **Step 4.1: 写失败测试（limits）**

创建 `apps/server/src/skills/__tests__/limits.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import {
  SKILL_FILE_MAX_BYTES,
  SKILL_MAX_FILES,
  SKILL_FILES_TOTAL_MAX_BYTES,
  isSkillTextFile,
} from '../limits.js';

describe('skill limits', () => {
  it('exposes the documented constants', () => {
    expect(SKILL_FILE_MAX_BYTES).toBe(256 * 1024);
    expect(SKILL_MAX_FILES).toBe(20);
    expect(SKILL_FILES_TOTAL_MAX_BYTES).toBe(1024 * 1024);
  });

  it('isSkillTextFile accepts whitelisted extensions only', () => {
    expect(isSkillTextFile('references/api.md')).toBe(true);
    expect(isSkillTextFile('assets/tpl.txt')).toBe(true);
    expect(isSkillTextFile('conf.yaml')).toBe(true);
    expect(isSkillTextFile('scripts/run.sh')).toBe(false); // 扩展名不在白名单
    expect(isSkillTextFile('logo.png')).toBe(false);
    expect(isSkillTextFile('bin')).toBe(false);
  });
});
```

- [ ] **Step 4.2: 运行确认失败**

Run: `pnpm --filter server exec vitest run src/skills/__tests__/limits.test.ts`
Expected: FAIL（module not found）

- [ ] **Step 4.3: 创建 limits.ts**

创建 `apps/server/src/skills/limits.ts`：

```ts
/**
 * Skill 目录包附属文件的统一限额与白名单（设计文档决策记录）。
 * scanner（目录同步，超限跳过）与 zip-import（导入，超限报错）共用。
 */

/** 单个附属文件大小上限（字节）。 */
export const SKILL_FILE_MAX_BYTES = 256 * 1024;

/** 每个 skill 的附属文件数量上限。 */
export const SKILL_MAX_FILES = 20;

/** 每个 skill 的附属文件总大小上限（字节）。 */
export const SKILL_FILES_TOTAL_MAX_BYTES = 1024 * 1024;

/** 允许收录的文本文件扩展名（skill 脚本/二进制一律排除）。 */
const TEXT_EXTENSIONS = new Set([
  '.md',
  '.txt',
  '.json',
  '.csv',
  '.yaml',
  '.yml',
  '.xml',
  '.html',
]);

/** 判断文件名是否属于允许收录的文本类型（按扩展名，大小写不敏感）。 */
export function isSkillTextFile(fileName: string): boolean {
  const dot = fileName.lastIndexOf('.');
  if (dot < 0) return false;
  return TEXT_EXTENSIONS.has(fileName.slice(dot).toLowerCase());
}
```

- [ ] **Step 4.4: 运行确认通过**

Run: `pnpm --filter server exec vitest run src/skills/__tests__/limits.test.ts`
Expected: PASS

- [ ] **Step 4.5: 写失败测试（scanner 双模式）**

在 `apps/server/src/skills/__tests__/scanner.test.ts` 追加（import 区补 `mkdirSync` 已有、`mkdirSync` 需确认存在，缺则补）：

```ts
  it('discovers a directory-pack skill with SKILL.md entry and side files', () => {
    const packDir = join(dir, 'code-review');
    mkdirSync(join(packDir, 'references'), { recursive: true });
    writeFileSync(
      join(packDir, 'SKILL.md'),
      `---
name: CodeReview
description: review code
---
# Review body`,
    );
    writeFileSync(join(packDir, 'references', 'api.md'), 'api reference');
    writeFileSync(join(packDir, 'extra.txt'), 'notes');

    const result = scanSkillDirectory(dir);
    expect(result).toHaveLength(1);

    const skill = result[0];
    expect(skill.parsed.frontmatter.name).toBe('CodeReview');
    expect(skill.filePath).toBe(join(packDir, 'SKILL.md'));
    expect(skill.files).toEqual([
      { path: 'references/api.md', content: 'api reference' },
      { path: 'extra.txt', content: 'notes' },
    ]);
  });

  it('directory pack skips scripts dir, non-text files, and oversized files', () => {
    const packDir = join(dir, 'pack');
    mkdirSync(join(packDir, 'scripts'), { recursive: true });
    writeFileSync(
      join(packDir, 'SKILL.md'),
      `---\nname: Pack\ndescription: d\n---\nbody`,
    );
    writeFileSync(join(packDir, 'scripts', 'run.sh'), '#!/bin/sh');
    writeFileSync(join(packDir, 'logo.png'), 'fake-binary');
    writeFileSync(join(packDir, 'big.md'), 'x'.repeat(256 * 1024 + 1));

    const result = scanSkillDirectory(dir);
    expect(result).toHaveLength(1);
    expect(result[0].files).toEqual([]); // 全部被跳过：scripts/、非白名单、超限
  });

  it('directory pack exceeding file count limit keeps first N files', () => {
    const packDir = join(dir, 'many');
    mkdirSync(packDir, { recursive: true });
    writeFileSync(join(packDir, 'SKILL.md'), `---\nname: Many\ndescription: d\n---\nbody`);
    for (let i = 0; i < 25; i++) {
      writeFileSync(join(packDir, `f${i}.txt`), `c${i}`);
    }

    const result = scanSkillDirectory(dir);
    expect(result[0].files.length).toBeLessThanOrEqual(20);
  });

  it('directory without SKILL.md is ignored entirely', () => {
    mkdirSync(join(dir, 'not-a-skill'), { recursive: true });
    writeFileSync(join(dir, 'not-a-skill', 'random.md'), 'no frontmatter pack');

    expect(scanSkillDirectory(dir)).toEqual([]);
  });

  it('flat *.md skills still work and carry empty files', () => {
    writeFileSync(join(dir, 'flat.md'), `---\nname: Flat\ndescription: d\n---\nflat body`);

    const result = scanSkillDirectory(dir);
    expect(result).toHaveLength(1);
    expect(result[0].parsed.frontmatter.name).toBe('Flat');
    expect(result[0].files).toEqual([]);
  });
```

- [ ] **Step 4.6: 运行确认失败**

Run: `pnpm --filter server exec vitest run src/skills/__tests__/scanner.test.ts`
Expected: 新用例 FAIL（files 字段不存在），既有用例 PASS

- [ ] **Step 4.7: 实现 scanner 双模式**

`apps/server/src/skills/scanner.ts` 全量替换为：

```ts
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { createHash } from 'node:crypto';
import type { ParsedSkill } from '@my-copilot/shared';
import { parseSkillMarkdown } from './parser.js';
import {
  SKILL_FILE_MAX_BYTES,
  SKILL_MAX_FILES,
  SKILL_FILES_TOTAL_MAX_BYTES,
  isSkillTextFile,
} from './limits.js';

export interface DiscoveredSkillFile {
  /** 相对 skill 根目录的 posix 风格路径（如 'references/api.md'）。 */
  path: string;
  content: string;
}

export interface DiscoveredSkill {
  filePath: string;
  fileName: string;
  parsed: ParsedSkill;
  hash: string;
  /** 目录包附属文件（平铺形态恒为空数组）。 */
  files: DiscoveredSkillFile[];
}

function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf-8').digest('hex');
}

/**
 * 递归收集 skill 目录包的附属文件。
 * 跳过：SKILL.md 本身、scripts/ 目录、非白名单扩展名、超限文件；
 * 数量/总量到达上限后停止收集。永不 throw，读不出的文件跳过并 warn。
 */
function collectPackFiles(packDir: string): DiscoveredSkillFile[] {
  const results: DiscoveredSkillFile[] = [];
  let totalBytes = 0;

  const walk = (currentDir: string, relDir: string): void => {
    if (results.length >= SKILL_MAX_FILES) return;

    let entries: string[];
    try {
      entries = readdirSync(currentDir);
    } catch (err) {
      console.warn(`[skills] failed to read directory ${currentDir}:`, err);
      return;
    }

    for (const entry of entries.sort()) {
      if (results.length >= SKILL_MAX_FILES) return;
      if (entry === 'SKILL.md' || entry === 'scripts') continue;

      const fullPath = join(currentDir, entry);
      const relPath = relDir ? `${relDir}/${entry}` : entry;

      let stat;
      try {
        stat = statSync(fullPath);
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        walk(fullPath, relPath);
        continue;
      }
      if (!stat.isFile()) continue;
      if (!isSkillTextFile(entry)) continue;
      if (stat.size > SKILL_FILE_MAX_BYTES) {
        console.warn(`[skills] skipped oversized file ${fullPath} (${stat.size} bytes)`);
        continue;
      }
      if (totalBytes + stat.size > SKILL_FILES_TOTAL_MAX_BYTES) {
        console.warn(`[skills] skipped ${fullPath}: total size limit reached`);
        continue;
      }

      try {
        const content = readFileSync(fullPath, 'utf-8');
        results.push({ path: relPath, content });
        totalBytes += stat.size;
      } catch (err) {
        console.warn(`[skills] failed to read ${fullPath}:`, err);
      }
    }
  };

  walk(packDir, '');
  return results;
}

/**
 * Scan a directory for skills. Two layouts are recognized (设计文档支柱一):
 *
 * 1. 目录包：`<dir>/<skill-name>/SKILL.md`（+ 附属文件，递归收集）
 * 2. 平铺（旧形态，行为不变）：`<dir>/*.md`
 *
 * - Missing directory → returns [] (never throws).
 * - Entry files/packs without a usable frontmatter `name` are skipped.
 * - Unreadable files are skipped (logged via console.warn).
 */
export function scanSkillDirectory(dir: string): DiscoveredSkill[] {
  if (!existsSync(dir)) {
    return [];
  }

  let dirStat;
  try {
    dirStat = statSync(dir);
  } catch {
    return [];
  }
  if (!dirStat.isDirectory()) {
    return [];
  }

  let entries: string[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    console.warn(`[skills] failed to read directory ${dir}:`, err);
    return [];
  }

  const results: DiscoveredSkill[] = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      // 目录包形态：<name>/SKILL.md
      const packDir = join(dir, entry.name);
      const skillMdPath = join(packDir, 'SKILL.md');
      if (!existsSync(skillMdPath)) continue;

      let raw: string;
      try {
        raw = readFileSync(skillMdPath, 'utf-8');
      } catch (err) {
        console.warn(`[skills] failed to read ${skillMdPath}:`, err);
        continue;
      }

      const parsed = parseSkillMarkdown(raw);
      if (!parsed.frontmatter.name) continue;

      results.push({
        filePath: skillMdPath,
        fileName: 'SKILL.md',
        parsed,
        hash: sha256(raw),
        files: collectPackFiles(packDir),
      });
      continue;
    }

    if (!entry.isFile()) continue;
    if (!entry.name.toLowerCase().endsWith('.md')) continue;

    // 平铺形态（旧行为，files 恒为空）
    const filePath = join(dir, entry.name);

    let stat;
    try {
      stat = statSync(filePath);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;

    let raw: string;
    try {
      raw = readFileSync(filePath, 'utf-8');
    } catch (err) {
      console.warn(`[skills] failed to read ${filePath}:`, err);
      continue;
    }

    const parsed = parseSkillMarkdown(raw);
    if (!parsed.frontmatter.name) {
      continue;
    }

    results.push({
      filePath,
      fileName: basename(filePath),
      parsed,
      hash: sha256(raw),
      files: [],
    });
  }

  return results;
}
```

- [ ] **Step 4.8: 运行确认通过**

Run: `pnpm --filter server exec vitest run src/skills/__tests__/scanner.test.ts src/skills/__tests__/limits.test.ts`
Expected: 全部 PASS

- [ ] **Step 4.9: sync 回归（此时 sync 仍未消费 files，应保持绿）**

Run: `pnpm --filter server exec vitest run src/skills`
Expected: 全部 PASS

- [ ] **Step 4.10: Commit**

```bash
git add apps/server/src/skills/limits.ts apps/server/src/skills/scanner.ts apps/server/src/skills/__tests__/limits.test.ts apps/server/src/skills/__tests__/scanner.test.ts
git commit -m "feat(server): scanner dual-mode — directory packs (SKILL.md + side files) alongside flat *.md"
```

---

### Task 5: sync 附属文件 diff + triggers 透传

**Files:**
- Modify: `apps/server/src/skills/sync.ts`
- Modify: `apps/server/src/routes/skills.ts`（POST `/` 与 PATCH `/:id` 透传 triggers）
- Test: `apps/server/src/skills/__tests__/sync.test.ts`（追加用例）
- Test: `apps/server/src/routes/__tests__/skills.test.ts`（追加用例）

- [ ] **Step 5.1: 写失败测试（sync）**

在 `apps/server/src/skills/__tests__/sync.test.ts` 追加（该文件已有临时目录 + initDatabase 的 setup，沿用其 describe 结构；若其 setup 不同，按既有风格对齐——核心断言如下）：

```ts
  it('syncs directory-pack skills with side files and reports file counts', () => {
    const packDir = join(dir, 'pack-a');
    mkdirSync(join(packDir, 'references'), { recursive: true });
    writeFileSync(
      join(packDir, 'SKILL.md'),
      `---\nname: PackA\ndescription: d\n---\nbody-a`,
    );
    writeFileSync(join(packDir, 'references', 'api.md'), 'api-v1');

    let result = syncDirectorySkills(getDb(), dir);
    expect(result.created).toBe(1);
    expect(result.filesCreated).toBe(1);

    const created = listSkillsBySource('directory').find((s) => s.name === 'PackA');
    expect(created).toBeDefined();
    expect(listSkillFiles(created!.id)).toEqual([{ path: 'references/api.md', size: 6 }]);

    // 附属文件内容变化 → 主文件未变也要 update files
    writeFileSync(join(packDir, 'references', 'api.md'), 'api-v2');
    result = syncDirectorySkills(getDb(), dir);
    expect(result.updated).toBe(1);
    expect(result.filesUpdated).toBe(1);
    expect(getSkillFile(created!.id, 'references/api.md')?.content).toBe('api-v2');

    // 附属文件删除 → filesDeleted
    rmSync(join(packDir, 'references', 'api.md'));
    result = syncDirectorySkills(getDb(), dir);
    expect(result.filesDeleted).toBe(1);
    expect(listSkillFiles(created!.id)).toEqual([]);
  });

  it('persists frontmatter triggers for directory skills', () => {
    writeFileSync(
      join(dir, 'trig.md'),
      `---\nname: Trig\ndescription: d\ntriggers:\n  - review\n  - 评审\n---\nbody`,
    );

    syncDirectorySkills(getDb(), dir);
    const skill = listSkillsBySource('directory').find((s) => s.name === 'Trig');
    expect(skill?.triggers).toEqual(['review', '评审']);
  });
```

import 区需补：`listSkillFiles, getSkillFile`（from `../../repo/skill.js`）、`rmSync`（node:fs，若未有）。

- [ ] **Step 5.2: 运行确认失败**

Run: `pnpm --filter server exec vitest run src/skills/__tests__/sync.test.ts`
Expected: 新用例 FAIL（filesCreated 字段不存在 / files 未同步）

- [ ] **Step 5.3: 实现 sync 扩展**

`apps/server/src/skills/sync.ts` 修改：

1. import 区替换 repo import 为：

```ts
import {
  findByFilePath,
  createSkill,
  updateSkill,
  deleteSkill,
  listSkillsBySource,
  listSkillFiles,
  getSkillFile,
} from '../repo/skill.js';
```

2. `SyncResult` 扩展：

```ts
export interface SyncResult {
  created: number;
  updated: number;
  skipped: number;
  deleted: number;
  filesCreated: number;
  filesUpdated: number;
  filesDeleted: number;
}
```

初始化处同步改为 `const result: SyncResult = { created: 0, updated: 0, skipped: 0, deleted: 0, filesCreated: 0, filesUpdated: 0, filesDeleted: 0 };`

3. 新增文件 diff 辅助函数（`syncDirectorySkills` 之前）：

```ts
/** 比较磁盘发现的附属文件与 DB 现状，产出计数（不执行写入）。 */
function diffSkillFiles(
  skillId: string,
  discovered: DiscoveredSkill['files'],
): { changed: boolean; created: number; updated: number; deleted: number } {
  const existing = listSkillFiles(skillId);
  const existingPaths = new Set(existing.map((f) => f.path));
  const discoveredPaths = new Set(discovered.map((f) => f.path));

  let created = 0;
  let updated = 0;
  for (const file of discovered) {
    if (!existingPaths.has(file.path)) {
      created += 1;
      continue;
    }
    const row = getSkillFile(skillId, file.path);
    if (!row || row.content !== file.content) updated += 1;
  }
  const deleted = existing.filter((f) => !discoveredPaths.has(f.path)).length;

  return { changed: created + updated + deleted > 0, created, updated, deleted };
}
```

4. create 分支（`createSkill({...})` 调用）加 `triggers: disc.parsed.frontmatter.triggers,` 与 `files: disc.files,`；`result.created += 1` 后补 `result.filesCreated += disc.files.length;`

5. `contentChanged` 判定扩展（主文件未变但附属文件变化也要更新）：

```ts
    const fileDiff = diffSkillFiles(current.id, disc.files);
    const contentChanged =
      !detail ||
      detail.name !== disc.parsed.frontmatter.name ||
      detail.description !== disc.parsed.frontmatter.description ||
      detail.content !== disc.parsed.body ||
      fileDiff.changed;

    if (!contentChanged) {
      result.skipped += 1;
      continue;
    }

    updateSkill(current.id, {
      name: disc.parsed.frontmatter.name,
      description: disc.parsed.frontmatter.description,
      body: disc.parsed.body,
      triggers: disc.parsed.frontmatter.triggers ?? [],
      files: disc.files,
    });
    result.updated += 1;
    result.filesCreated += fileDiff.created;
    result.filesUpdated += fileDiff.updated;
    result.filesDeleted += fileDiff.deleted;
```

（`updateSkill` 的 files 全量替换语义已覆盖删除场景。）

- [ ] **Step 5.4: 运行确认通过**

Run: `pnpm --filter server exec vitest run src/skills/__tests__/sync.test.ts`
Expected: 全部 PASS

- [ ] **Step 5.5: routes 透传 triggers（POST / 与 PATCH /:id）**

先在 `apps/server/src/routes/__tests__/skills.test.ts` 追加两个用例（import 区已有 `createSkill`/`updateSkill` mock）：

```ts
  it('POST / persists frontmatter triggers', async () => {
    vi.mocked(parseSkillMarkdown).mockReturnValue({
      frontmatter: { name: 'T', description: 'd', triggers: ['a', 'b'] },
      body: 'body',
      raw: '',
    });
    vi.mocked(createSkill).mockReturnValue({ ...mockSkillDetail, id: 's9' });

    const app = createTestApp();
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'x' }),
    });
    expect(res.status).toBe(201);
    expect(vi.mocked(createSkill).mock.calls[0][0].triggers).toEqual(['a', 'b']);
  });

  it('PATCH /:id forwards triggers and files', async () => {
    vi.mocked(getSkillMeta).mockReturnValue({ ...mockSkillMeta });
    vi.mocked(updateSkill).mockReturnValue({ ...mockSkillDetail });

    const app = createTestApp();
    const res = await app.request('/s1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        triggers: ['x'],
        files: [{ path: 'a.md', content: 'a' }],
      }),
    });
    expect(res.status).toBe(200);
    expect(vi.mocked(updateSkill).mock.calls[0][1]).toEqual({
      triggers: ['x'],
      files: [{ path: 'a.md', content: 'a' }],
    });
  });
```

Run: `pnpm --filter server exec vitest run src/routes/__tests__/skills.test.ts`
Expected: 新用例 FAIL（triggers 未透传）

然后修改 `apps/server/src/routes/skills.ts`：

- POST `/` 的 `createSkill` 调用加：

```ts
    const data = createSkill({
      name: parsed.frontmatter.name,
      description: parsed.frontmatter.description,
      body: parsed.body,
      triggers: parsed.frontmatter.triggers,
      source,
    });
```

- PATCH `/:id` 的 `updateSkill(id, body)` 已直接透传整个 `UpdateSkillParams` body——triggers/files 字段自动透传，**无需改动**（测试用于锁定该行为）。

Run: `pnpm --filter server exec vitest run src/routes/__tests__/skills.test.ts`
Expected: 全部 PASS

- [ ] **Step 5.6: Commit**

```bash
git add apps/server/src/skills/sync.ts apps/server/src/skills/__tests__/sync.test.ts apps/server/src/routes/skills.ts apps/server/src/routes/__tests__/skills.test.ts
git commit -m "feat(server): sync side-file diff for skill packs and persist triggers"
```

---

### Task 6: ZIP 导入（fflate + parseSkillZip + POST /import）

**Files:**
- Modify: `apps/server/package.json`（新增依赖 fflate）
- Create: `apps/server/src/skills/zip-import.ts`
- Create: `apps/server/src/skills/__tests__/zip-import.test.ts`
- Modify: `apps/server/src/routes/skills.ts`（新增 POST /import）
- Test: `apps/server/src/routes/__tests__/skills.test.ts`（追加用例）

- [ ] **Step 6.1: 安装依赖**

Run: `pnpm --filter server add fflate`
Expected: 安装成功（约 ^0.8.x）

- [ ] **Step 6.2: 写失败测试（zip-import）**

创建 `apps/server/src/skills/__tests__/zip-import.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { parseSkillZip } from '../zip-import.js';

function zipOf(entries: Record<string, string>): Uint8Array {
  return zipSync(
    Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, strToU8(v)])),
  );
}

const VALID_SKILL_MD = `---
name: Imported
description: from zip
---
# Imported body`;

describe('parseSkillZip', () => {
  it('parses a root-level SKILL.md pack with side files', () => {
    const result = parseSkillZip(
      zipOf({
        'SKILL.md': VALID_SKILL_MD,
        'references/api.md': 'api doc',
        'assets/tpl.txt': 'tpl',
        'scripts/run.sh': '#!/bin/sh', // 应被跳过
      }),
    );

    expect(result.ok).toBe(true);
    expect(result.skill).toMatchObject({
      name: 'Imported',
      description: 'from zip',
      body: '# Imported body',
    });
    expect(result.skill?.files).toEqual([
      { path: 'assets/tpl.txt', content: 'tpl' },
      { path: 'references/api.md', content: 'api doc' },
    ]);
  });

  it('parses a single-subdirectory pack (<name>/SKILL.md)', () => {
    const result = parseSkillZip(
      zipOf({
        'code-review/SKILL.md': VALID_SKILL_MD,
        'code-review/README.md': 'readme',
      }),
    );

    expect(result.ok).toBe(true);
    // 附属文件保留 zip 内相对路径（含子目录前缀）
    expect(result.skill?.files).toEqual([{ path: 'code-review/README.md', content: 'readme' }]);
  });

  it('falls back to a single flat .md at zip root (legacy shape)', () => {
    const result = parseSkillZip(zipOf({ 'old-skill.md': VALID_SKILL_MD }));
    expect(result.ok).toBe(true);
    expect(result.skill?.name).toBe('Imported');
    expect(result.skill?.files).toEqual([]);
  });

  it('rejects a zip without SKILL.md or usable markdown', () => {
    const result = parseSkillZip(zipOf({ 'foo.txt': 'no skill here' }));
    expect(result.ok).toBe(false);
    expect(result.error).toContain('SKILL.md');
  });

  it('rejects a SKILL.md missing frontmatter name', () => {
    const result = parseSkillZip(zipOf({ 'SKILL.md': 'no frontmatter' }));
    expect(result.ok).toBe(false);
    expect(result.error).toContain('name');
  });

  it('rejects oversized side files with the offending path', () => {
    const result = parseSkillZip(
      zipOf({
        'SKILL.md': VALID_SKILL_MD,
        'big.md': 'x'.repeat(256 * 1024 + 1),
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain('big.md');
  });

  it('rejects packs exceeding the file count limit', () => {
    const entries: Record<string, string> = { 'SKILL.md': VALID_SKILL_MD };
    for (let i = 0; i < 25; i++) entries[`f${i}.txt`] = `c${i}`;

    const result = parseSkillZip(zipOf(entries));
    expect(result.ok).toBe(false);
    expect(result.error).toContain('20');
  });

  it('rejects malformed zip data', () => {
    const result = parseSkillZip(new Uint8Array([0x00, 0x01, 0x02, 0x03]));
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });
});
```

- [ ] **Step 6.3: 运行确认失败**

Run: `pnpm --filter server exec vitest run src/skills/__tests__/zip-import.test.ts`
Expected: FAIL（module not found）

- [ ] **Step 6.4: 实现 zip-import.ts**

创建 `apps/server/src/skills/zip-import.ts`：

```ts
import { unzipSync, strFromU8 } from 'fflate';
import { parseSkillMarkdown } from './parser.js';
import {
  SKILL_FILE_MAX_BYTES,
  SKILL_MAX_FILES,
  SKILL_FILES_TOTAL_MAX_BYTES,
  isSkillTextFile,
} from './limits.js';

/** parseSkillZip 的成功载荷（对齐 CreateSkillParams 的可编辑副本语义）。 */
export interface ImportedSkill {
  name: string;
  description: string;
  body: string;
  triggers?: string[];
  files: Array<{ path: string; content: string }>;
}

/** fail-soft 结果结构（对齐 attachment/parser.ts 风格：永不 throw）。 */
export interface SkillZipResult {
  ok: boolean;
  error?: string;
  skill?: ImportedSkill;
}

/**
 * 解析 ZIP 形式的 skill 目录包（对齐 Claude Code 生态格式）。
 *
 * 识别三种形态：
 * 1. 根级 `SKILL.md`（+ 附属文件）
 * 2. 唯一子目录下的 `<name>/SKILL.md`
 * 3. 根级单个 `*.md`（旧平铺形态）
 *
 * 附属文件：跳过 `scripts/` 前缀与非白名单扩展名；超限/超数直接失败并指明路径
 * （导入路径按设计文档报 400，目录同步才是"跳过 + 计数"语义）。
 */
export function parseSkillZip(buffer: Uint8Array): SkillZipResult {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(buffer);
  } catch {
    return { ok: false, error: '无法解析 ZIP 文件：文件损坏或不是有效的 ZIP 格式' };
  }

  // 过滤目录条目（zip 中目录以 / 结尾）与隐藏文件
  const fileEntries = Object.entries(entries).filter(
    ([path, data]) => !path.endsWith('/') && data.length >= 0 && !path.split('/').pop()!.startsWith('.'),
  );
  const paths = fileEntries.map(([p]) => p);

  // 定位 SKILL.md：根级 > 唯一子目录级
  const rootSkill = paths.find((p) => p === 'SKILL.md');
  const nestedSkill = rootSkill ? undefined : paths.find((p) => /^[^/]+\/SKILL\.md$/.test(p));

  let entryPath: string | undefined;
  if (rootSkill) {
    entryPath = rootSkill;
  } else if (nestedSkill) {
    entryPath = nestedSkill;
  } else {
    // 兼容：根级单个 .md（旧平铺形态）
    const flatMds = paths.filter((p) => p.toLowerCase().endsWith('.md') && !p.includes('/'));
    if (flatMds.length === 1) {
      entryPath = flatMds[0];
    } else {
      return {
        ok: false,
        error: 'ZIP 中未找到 SKILL.md（支持根级或唯一子目录下的 SKILL.md）',
      };
    }
  }

  const raw = strFromU8(entries[entryPath]);
  const parsed = parseSkillMarkdown(raw);
  if (!parsed.frontmatter.name) {
    return { ok: false, error: 'SKILL.md 的 frontmatter 缺少 name 字段' };
  }

  // 收集附属文件（跳过入口自身与 scripts/）
  const files: Array<{ path: string; content: string }> = [];
  let totalBytes = 0;
  const oversize: string[] = [];

  for (const [path, data] of fileEntries) {
    if (path === entryPath) continue;
    if (path === 'scripts' || path.startsWith('scripts/')) continue;
    const baseName = path.split('/').pop()!;
    if (!isSkillTextFile(baseName)) continue;

    if (data.length > SKILL_FILE_MAX_BYTES) {
      oversize.push(path);
      continue;
    }
    if (files.length >= SKILL_MAX_FILES) {
      return { ok: false, error: `附属文件数量超过上限（${SKILL_MAX_FILES} 个）` };
    }
    if (totalBytes + data.length > SKILL_FILES_TOTAL_MAX_BYTES) {
      return { ok: false, error: `附属文件总大小超过上限（${SKILL_FILES_TOTAL_MAX_BYTES} 字节）` };
    }

    files.push({ path, content: strFromU8(data) });
    totalBytes += data.length;
  }

  if (oversize.length > 0) {
    return {
      ok: false,
      error: `以下附属文件超过单文件上限（${SKILL_FILE_MAX_BYTES} 字节）：${oversize.join(', ')}`,
    };
  }

  files.sort((a, b) => a.path.localeCompare(b.path));

  return {
    ok: true,
    skill: {
      name: parsed.frontmatter.name,
      description: parsed.frontmatter.description,
      body: parsed.body,
      triggers: parsed.frontmatter.triggers,
      files,
    },
  };
}
```

- [ ] **Step 6.5: 运行确认通过**

Run: `pnpm --filter server exec vitest run src/skills/__tests__/zip-import.test.ts`
Expected: 全部 PASS（8 个用例）

- [ ] **Step 6.6: 写失败测试（route）**

在 `apps/server/src/routes/__tests__/skills.test.ts` 追加（import 区补 `parseSkillZip` 的 mock 与导入；mock 区加 `vi.mock('../../skills/zip-import.js', () => ({ parseSkillZip: vi.fn() }));`）：

```ts
  it('POST /import uploads a zip and creates an upload-source skill', async () => {
    vi.mocked(parseSkillZip).mockReturnValue({
      ok: true,
      skill: {
        name: 'Zipped',
        description: 'd',
        body: 'b',
        files: [{ path: 'references/a.md', content: 'a' }],
      },
    });
    vi.mocked(createSkill).mockReturnValue({ ...mockSkillDetail, id: 'sz1' });

    const app = createTestApp();
    const form = new FormData();
    form.append(
      'file',
      new File([new Uint8Array([1, 2, 3])], 'pack.zip', { type: 'application/zip' }),
    );

    const res = await app.request('/import', { method: 'POST', body: form });
    expect(res.status).toBe(201);
    expect(vi.mocked(createSkill).mock.calls[0][0]).toMatchObject({
      name: 'Zipped',
      source: 'upload',
      files: [{ path: 'references/a.md', content: 'a' }],
    });
  });

  it('POST /import rejects a zip without usable SKILL.md', async () => {
    vi.mocked(parseSkillZip).mockReturnValue({ ok: false, error: 'ZIP 中未找到 SKILL.md' });

    const app = createTestApp();
    const form = new FormData();
    form.append('file', new File([new Uint8Array([1])], 'bad.zip'));

    const res = await app.request('/import', { method: 'POST', body: form });
    expect(res.status).toBe(400);
    const body = (await res.json()) as ApiResponse;
    expect(JSON.stringify(body)).toContain('SKILL.md');
  });

  it('POST /import rejects a missing file field', async () => {
    const app = createTestApp();
    const res = await app.request('/import', {
      method: 'POST',
      body: new FormData(),
    });
    expect(res.status).toBe(400);
  });
```

Run: `pnpm --filter server exec vitest run src/routes/__tests__/skills.test.ts`
Expected: 新用例 FAIL（404，路由不存在）

- [ ] **Step 6.7: 实现 POST /import 路由**

`apps/server/src/routes/skills.ts`：

1. import 区加：

```ts
import { parseSkillZip } from '../skills/zip-import.js';
```

2. 在 `app.post('/', ...)` 之后新增（放在 POST `/` 与 GET `/:id` 之间）：

```ts
  // POST /import — upload a ZIP containing a skill directory pack.
  app.post('/import', async (c) => {
    const body = await c.req.parseBody();
    const file = body['file'];
    if (!(file instanceof File)) {
      throw new HttpError(400, 'Missing required field: file');
    }
    if (!file.name.toLowerCase().endsWith('.zip')) {
      throw new HttpError(400, 'Only .zip files are supported');
    }

    const buffer = new Uint8Array(await file.arrayBuffer());
    const parsed = parseSkillZip(buffer);
    if (!parsed.ok || !parsed.skill) {
      throw new HttpError(400, parsed.error ?? 'Invalid skill zip');
    }

    const { name, description, body: skillBody, triggers, files } = parsed.skill;
    const data = createSkill({
      name,
      description,
      body: skillBody,
      triggers,
      files,
      source: 'upload', // 导入创建可编辑副本（设计决策：不新增 source 枚举）
    });

    return successResponse(c, data, 201);
  });
```

（`File` 为 Node 18+ 全局类型；若 tsc 报 `File` 未定义，在文件顶部加 `/// <reference lib="dom" />` 不可取——改用 `typeof file === 'object' && file !== null && 'arrayBuffer' in file` 判定并 `as File` 断言。优先直接 `instanceof File`。）

- [ ] **Step 6.8: 运行确认通过 + 手动验证解析链**

Run: `pnpm --filter server exec vitest run src/routes/__tests__/skills.test.ts src/skills/__tests__/zip-import.test.ts`
Expected: 全部 PASS

- [ ] **Step 6.9: Commit**

```bash
git add apps/server/package.json pnpm-lock.yaml apps/server/src/skills/zip-import.ts apps/server/src/skills/__tests__/zip-import.test.ts apps/server/src/routes/skills.ts apps/server/src/routes/__tests__/skills.test.ts
git commit -m "feat(server): ZIP skill-pack import via fflate (POST /api/skills/import)"
```

---

### Task 7: 附属文件读取路由（GET /:id/files/*）

**Files:**
- Modify: `apps/server/src/routes/skills.ts`
- Test: `apps/server/src/routes/__tests__/skills.test.ts`（追加用例）

- [ ] **Step 7.1: 写失败测试**

追加（import 区的 repo mock 需补 `getSkillFile: vi.fn(), listSkillFiles: vi.fn()`；对应 import 补 `getSkillFile`）：

```ts
  it('GET /:id/files/* returns file content for a nested path', async () => {
    vi.mocked(getSkillMeta).mockReturnValue({ ...mockSkillMeta });
    vi.mocked(getSkillFile).mockReturnValue({
      path: 'references/api.md',
      content: 'api doc',
    });

    const app = createTestApp();
    const res = await app.request('/s1/files/references%2Fapi.md');
    expect(res.status).toBe(200);
    const body = (await res.json()) as ApiResponse;
    expect(body.data).toEqual({ path: 'references/api.md', content: 'api doc' });
    expect(vi.mocked(getSkillFile).mock.calls[0]).toEqual(['s1', 'references/api.md']);
  });

  it('GET /:id/files/* rejects path traversal', async () => {
    const app = createTestApp();
    const res = await app.request('/s1/files/..%2F..%2Fetc%2Fpasswd');
    expect(res.status).toBe(400);
  });

  it('GET /:id/files/* returns 404 for unknown file', async () => {
    vi.mocked(getSkillMeta).mockReturnValue({ ...mockSkillMeta });
    vi.mocked(getSkillFile).mockReturnValue(undefined);

    const app = createTestApp();
    const res = await app.request('/s1/files/nope.md');
    expect(res.status).toBe(404);
  });
```

- [ ] **Step 7.2: 运行确认失败**

Run: `pnpm --filter server exec vitest run src/routes/__tests__/skills.test.ts`
Expected: 新用例 FAIL（404，路由不存在）

- [ ] **Step 7.3: 实现路由**

`apps/server/src/routes/skills.ts`：

1. repo import 补 `getSkillFile`：

```ts
import {
  listSkills,
  getSkill,
  getSkillMeta,
  getSkillFile,
  createSkill,
  updateSkill,
  deleteSkill,
} from '../repo/skill.js';
```

2. 在 GET `/:id` 之后新增：

```ts
  // GET /:id/files/* — return one side file's content (path may contain '/').
  // Uses a wildcard (not :path) so nested paths like references/api.md work;
  // callers percent-encode the path (encodeURIComponent keeps '/' as %2F).
  app.get('/:id/files/*', (c) => {
    const id = c.req.param('id');

    const marker = '/files/';
    const idx = c.req.path.indexOf(marker);
    let filePath = idx >= 0 ? c.req.path.slice(idx + marker.length) : '';
    try {
      filePath = decodeURIComponent(filePath);
    } catch {
      throw new HttpError(400, 'Invalid file path encoding');
    }

    if (
      !filePath ||
      filePath.includes('..') ||
      filePath.startsWith('/') ||
      filePath.includes('\\')
    ) {
      throw new HttpError(400, 'Invalid file path');
    }

    if (!getSkillMeta(id)) {
      throw new HttpError(404, 'Skill not found');
    }
    const data = getSkillFile(id, filePath);
    if (!data) {
      throw new HttpError(404, 'File not found');
    }
    return successResponse(c, data);
  });
```

- [ ] **Step 7.4: 运行确认通过**

Run: `pnpm --filter server exec vitest run src/routes/__tests__/skills.test.ts`
Expected: 全部 PASS

- [ ] **Step 7.5: Commit**

```bash
git add apps/server/src/routes/skills.ts apps/server/src/routes/__tests__/skills.test.ts
git commit -m "feat(server): GET /api/skills/:id/files/* side-file content endpoint"
```

---

### Task 8: Web 编辑 UI（SkillFormModal 编辑模式 + SkillsPage 编辑按钮）

**Files:**
- Modify: `apps/web/src/components/SkillFormModal.tsx`
- Modify: `apps/web/src/views/settings/SkillsPage.tsx`
- Create: `apps/web/src/components/SkillFormModal.test.tsx`

**前置确认:** `api/real.ts` 已有 `updateSkill(id, params)`（第 406 行）与 `getSkill(id)`（第 380 行），web 侧 API 零改动。

- [ ] **Step 8.1: 写失败测试**

创建 `apps/web/src/components/SkillFormModal.test.tsx`：

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SkillFormModal from './SkillFormModal';
import type { SkillDetail } from '@my-copilot/shared';

const detail: SkillDetail = {
  id: 's1',
  name: 'OldName',
  description: 'Old desc',
  content: '# old body',
  enabled: true,
  createdAt: 1,
  updatedAt: 1,
  source: 'upload',
};

function setup(overrides: { onUpdate?: (id: string, p: unknown) => void } = {}) {
  const onSave = vi.fn();
  const onUpdate = overrides.onUpdate ?? vi.fn();
  render(
    <SkillFormModal
      open
      onClose={vi.fn()}
      onSave={onSave}
      editing={detail}
      onUpdate={onUpdate as never}
    />,
  );
  return { onSave, onUpdate };
}

describe('SkillFormModal edit mode', () => {
  it('prefills name/description/content from the editing skill', () => {
    setup();
    expect((screen.getByDisplayValue('OldName') as HTMLInputElement).value).toBe('OldName');
    expect((screen.getByDisplayValue('Old desc') as HTMLTextAreaElement).value).toBe('Old desc');
    // 切到粘贴模式才能看到内容 textarea；直接断言 modal 标题
    expect(screen.getByText('编辑 Skill')).toBeTruthy();
  });

  it('submits UpdateSkillParams via onUpdate in edit mode', () => {
    const { onSave, onUpdate } = setup();

    fireEvent.change(screen.getByDisplayValue('OldName'), {
      target: { value: 'NewName' },
    });
    fireEvent.click(screen.getByText('保存'));

    expect(onUpdate).toHaveBeenCalledWith('s1', {
      name: 'NewName',
      description: 'Old desc',
      body: '# old body',
    });
    expect(onSave).not.toHaveBeenCalled();
  });

  it('create mode still calls onSave (no regression)', () => {
    const onSave = vi.fn();
    render(
      <SkillFormModal open onClose={vi.fn()} onSave={onSave} editing={null} onUpdate={vi.fn()} />,
    );

    fireEvent.change(screen.getByPlaceholderText('例如：my-skill'), {
      target: { value: 'Fresh' },
    });
    const descTextarea = screen
      .getAllByRole('textbox')
      .find((el) => (el as HTMLTextAreaElement).value === '') as HTMLTextAreaElement;
    fireEvent.change(descTextarea, { target: { value: 'd' } });

    // 内容必填：切到粘贴模式填入
    fireEvent.click(screen.getByText('粘贴文本'));
    fireEvent.change(screen.getByRole('textbox', { name: '' }), { target: { value: '' } });

    expect(screen.getByText('创建')).toBeTruthy();
    expect(screen.getByText('新建 Skill')).toBeTruthy();
  });
});
```

⚠️ 第三个用例的定位选择器按实际 DOM 调整（核心断言：编辑模式标题"编辑 Skill"、保存按钮文案"保存"；新建模式标题"新建 Skill"、按钮"创建"、`onSave` 路径不回归）。若 Modal 渲染到 portal，`screen` 查询仍有效。

- [ ] **Step 8.2: 运行确认失败**

Run: `pnpm --filter web exec vitest run src/components/SkillFormModal.test.tsx`
Expected: FAIL（editing prop 不存在 / 标题不匹配）

- [ ] **Step 8.3: 扩展 SkillFormModal**

`apps/web/src/components/SkillFormModal.tsx` 修改点：

1. props 与 import：

```tsx
import type { CreateSkillParams, SkillDetail, UpdateSkillParams } from '@my-copilot/shared'

export interface SkillFormModalProps {
  open: boolean
  onClose: () => void
  onSave: (params: CreateSkillParams) => void
  /** 编辑模式：要编辑的 skill（null = 新建）。directory 来源由调用方屏蔽。 */
  editing?: SkillDetail | null
  onUpdate?: (id: string, params: UpdateSkillParams) => void
}
```

组件签名改为 `export default function SkillFormModal({ open, onClose, onSave, editing = null, onUpdate }: SkillFormModalProps)`。

2. 回填：`lastOpen` 变化且 `open` 为 true 时，`if (editing)` 分支额外 `setContent(editing.content)`（其余 reset 逻辑不变）。

3. `handleSubmit` 分支：

```tsx
  const handleSubmit = () => {
    if (!validate()) return
    if (editing && onUpdate) {
      onUpdate(editing.id, {
        name: name.trim(),
        description: description.trim(),
        body: content,
      })
    } else {
      const params: CreateSkillParams = {
        name: name.trim(),
        description: description.trim(),
        body: content,
        source: 'upload' as SkillSource,
        enabled: true,
      }
      onSave(params)
    }
    onClose()
  }
```

4. Modal 标题与提交按钮文案：

```tsx
    <Modal open={open} onOpenChange={(o) => !o && onClose()} title={editing ? '编辑 Skill' : '新建 Skill'} width="640px">
```

```tsx
          <button
            onClick={handleSubmit}
            className="px-4 py-2 text-sm bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors font-medium"
          >
            {editing ? '保存' : '创建'}
          </button>
```

- [ ] **Step 8.4: 运行确认通过**

Run: `pnpm --filter web exec vitest run src/components/SkillFormModal.test.tsx`
Expected: PASS

- [ ] **Step 8.5: SkillsPage 接编辑入口**

`apps/web/src/views/settings/SkillsPage.tsx` 修改点：

1. state 区加 `const [editingSkill, setEditingSkill] = useState<SkillDetail | null>(null)`，import 的 shared 类型补 `SkillDetail, UpdateSkillParams`。

2. 处理函数：

```tsx
  const handleEdit = async (skill: SkillMeta) => {
    try {
      const detail = await api.getSkill(skill.id)
      setEditingSkill(detail)
      setIsModalOpen(true)
    } catch (error) {
      console.error('Failed to load skill:', error)
      showMessageAlert.error('加载 Skill 失败')
    }
  }

  const handleModalUpdate = async (id: string, params: UpdateSkillParams) => {
    try {
      const updated = await api.updateSkill(id, params)
      setSkills((prev) => prev.map((s) => (s.id === id ? { ...s, ...updated } : s)))
      showMessageAlert.success('Skill 已更新')
    } catch (error) {
      console.error('Failed to update skill:', error)
      showMessageAlert.error('更新 Skill 失败')
    }
  }
```

3. 删除按钮旁加编辑按钮（`isDirectory` 禁用）：

```tsx
                <div className="flex items-center gap-3 shrink-0 pl-4">
                  <button
                    onClick={() => handleEdit(skill)}
                    disabled={isDirectory}
                    className="px-3 py-1.5 text-xs bg-bg-elevated border border-border-base text-text-primary rounded-lg hover:border-primary-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    编辑
                  </button>
                  <button
                    onClick={() => handleDelete(skill)}
                    disabled={isDirectory}
                    className="px-3 py-1.5 text-xs bg-error-50 border border-error-200 text-error-600 rounded-lg hover:bg-error-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    删除
                  </button>
                </div>
```

4. 底部 Modal 传参并在关闭时清空编辑态：

```tsx
      <SkillFormModal
        open={isModalOpen}
        onClose={() => {
          setIsModalOpen(false)
          setEditingSkill(null)
        }}
        onSave={handleModalSave}
        editing={editingSkill}
        onUpdate={handleModalUpdate}
      />
```

（确认 `api.getSkill` / `api.updateSkill` 已经由 `api/index.ts` barrel 导出——real.ts 已实现，barrel 用 `export *` 则自动可用；若 barrel 是显式列表则补两行。）

- [ ] **Step 8.6: web 回归**

Run: `pnpm --filter web exec vitest run src/components/SkillFormModal.test.tsx && pnpm --filter web exec tsc --noEmit`
Expected: 测试 PASS + 类型检查通过

- [ ] **Step 8.7: Commit**

```bash
git add apps/web/src/components/SkillFormModal.tsx apps/web/src/components/SkillFormModal.test.tsx apps/web/src/views/settings/SkillsPage.tsx
git commit -m "feat(web): skill edit mode — SkillFormModal editing + SkillsPage edit action"
```

---

### Task 9: Web ZIP 导入入口 + 附属文件展示

**Files:**
- Modify: `apps/web/src/api/real.ts`
- Modify: `apps/web/src/api/index.ts`（若 barrel 为显式列表则补导出）
- Modify: `apps/web/src/views/settings/SkillsPage.tsx`

**前置确认:** `real.ts` 的 `sendMessage`（第 85 行起）已用 FormData 走 `fetchWithAuth` —— 新函数照抄其 FormData 模式（不手工设置 Content-Type，让浏览器生成 multipart boundary）。

- [ ] **Step 9.1: api 函数**

`apps/web/src/api/real.ts` 在 Skills API 区块（`rescanSkills` 之后）追加：

```ts
/**
 * Import a skill directory pack from a ZIP file
 * POST /api/skills/import (multipart/form-data)
 */
export async function importSkillZip(file: File): Promise<SkillMeta> {
    // FormData 走 fetchWithAuth（参照 sendMessage 的 multipart 模式，
    // 不手工设置 Content-Type，浏览器自动生成 boundary）。
    const formData = new FormData();
    formData.append('file', file);
    const response = await fetchWithAuth('/api/skills/import', {
        method: 'POST',
        body: formData,
    });
    if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { msg?: string } | null;
        throw new Error(body?.msg ?? `导入失败（HTTP ${response.status}）`);
    }
    const body = (await response.json()) as { data: SkillMeta };
    return body.data;
}

/**
 * Fetch one side file's content
 * GET /api/skills/:id/files/:path（path 经 encodeURIComponent，'/' 编码为 %2F）
 */
export async function getSkillFile(
    id: string,
    path: string,
): Promise<{ path: string; content: string }> {
    const response = await enhancedFetch<{ data: { path: string; content: string } }>(
        `/api/skills/${id}/files/${encodeURIComponent(path)}`,
        { method: 'GET', timeout: 30000 },
    );
    return response.data;
}
```

⚠️ 对照 `sendMessage` 的实际实现修正 `fetchWithAuth` 用法（其签名/返回类型以 `api/request.ts` 为准）；错误分支的响应体字段名对照 `HttpError` 中间件实际输出（`msg` 或 `error`）。

- [ ] **Step 9.2: SkillsPage 导入按钮 + 附属文件徽标**

`apps/web/src/views/settings/SkillsPage.tsx`：

1. import 加 `importSkillZip, getSkillFile`（经 `../../api` barrel），并加 `useRef`：

```tsx
import { useState, useEffect, useCallback, useRef } from 'react'
```

2. state/ref 区加：

```tsx
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isImporting, setIsImporting] = useState(false)
  const [expandedSkill, setExpandedSkill] = useState<string | null>(null)
  const [filePreview, setFilePreview] = useState<{ path: string; content: string } | null>(null)
```

3. 导入处理：

```tsx
  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // 允许重复选择同一文件
    if (!file) return
    setIsImporting(true)
    try {
      await importSkillZip(file)
      showMessageAlert.success('Skill 导入成功')
      await loadSkills()
    } catch (error) {
      console.error('Failed to import skill:', error)
      showMessageAlert.error(error instanceof Error ? error.message : '导入 Skill 失败')
    } finally {
      setIsImporting(false)
    }
  }

  const handlePreviewFile = async (skillId: string, path: string) => {
    try {
      const data = await getSkillFile(skillId, path)
      setFilePreview(data)
    } catch (error) {
      console.error('Failed to load skill file:', error)
      showMessageAlert.error('加载文件失败')
    }
  }
```

4. Header 按钮区（"+ 新建 Skill" 旁）：

```tsx
        <div className="flex items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept=".zip,application/zip"
            onChange={handleImportFile}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isImporting}
            className="px-4 py-2 bg-bg-secondary text-text-primary border border-border-base rounded-lg hover:border-primary-400 transition-colors text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isImporting ? '导入中...' : '导入 ZIP'}
          </button>
          <button
            onClick={handleCreate}
            className="px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors text-sm font-medium"
          >
            + 新建 Skill
          </button>
        </div>
```

5. 行内：name 徽标区追加 fileCount 徽标（`skill.filePath && ...` 之前）：

```tsx
                      {(skill.fileCount ?? 0) > 0 && (
                        <button
                          onClick={() =>
                            setExpandedSkill(expandedSkill === skill.id ? null : skill.id)
                          }
                          className="text-xs text-primary-600 hover:text-primary-700 underline underline-offset-2"
                        >
                          {skill.fileCount} 个附属文件
                        </button>
                      )}
```

6. 展开区（skill 行 div 之后、列表容器内）渲染附属文件列表。改为：列表容器内 map 返回 fragment，skill 行后跟展开块：

```tsx
          {skills.map((skill) => {
            const isDirectory = skill.source === 'directory'
            const isExpanded = expandedSkill === skill.id
            return (
              <div key={skill.id} className="flex flex-col gap-2">
                {/* …既有 skill 行 div 原样保留（编辑/删除按钮已在 Task 8 加入）… */}
                {isExpanded && <SkillFilesPanel skillId={skill.id} onOpen={handlePreviewFile} />}
              </div>
            )
          })}
```

7. 文件列表子组件（SkillsPage.tsx 文件底部、组件外定义，自取数据）：

```tsx
function SkillFilesPanel({
  skillId,
  onOpen,
}: {
  skillId: string
  onOpen: (skillId: string, path: string) => void
}) {
  const [files, setFiles] = useState<{ path: string; size: number }[] | null>(null)

  useEffect(() => {
    let active = true
    api
      .getSkill(skillId)
      .then((detail) => {
        if (active) setFiles(detail.files ?? [])
      })
      .catch(() => {
        if (active) setFiles([])
      })
    return () => {
      active = false
    }
  }, [skillId])

  if (files === null) {
    return <div className="text-xs text-text-tertiary pl-4">加载附属文件...</div>
  }
  if (files.length === 0) {
    return <div className="text-xs text-text-tertiary pl-4">无附属文件</div>
  }
  return (
    <div className="flex flex-col gap-1 pl-4 py-2 border-l-2 border-border-base">
      {files.map((f) => (
        <button
          key={f.path}
          onClick={() => onOpen(skillId, f.path)}
          className="text-left text-xs font-mono text-text-secondary hover:text-primary-600 transition-colors truncate"
        >
          {f.path} <span className="text-text-tertiary">({f.size} B)</span>
        </button>
      ))}
    </div>
  )
}
```

8. 文件内容预览（列表容器之后）：

```tsx
      {filePreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
          <div className="flex flex-col gap-3 max-w-2xl w-full max-h-[70vh] bg-bg-elevated border border-border-base rounded-lg p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-mono font-medium text-text-primary truncate">
                {filePreview.path}
              </span>
              <button
                onClick={() => setFilePreview(null)}
                className="px-3 py-1 text-xs bg-bg-secondary border border-border-base rounded-lg hover:bg-bg-hover transition-colors"
              >
                关闭
              </button>
            </div>
            <pre className="text-xs font-mono text-text-secondary whitespace-pre-wrap overflow-auto">
              {filePreview.content}
            </pre>
          </div>
        </div>
      )}
```

（`api.getSkill` 需确认 barrel 导出，同 Task 8。）

- [ ] **Step 9.3: 手动验收**

Run: `pnpm dev`
验收清单：
1. 设置 → 技能管理 → "导入 ZIP"：选一个含 `SKILL.md` + `references/` 的 zip → 列表出现新 skill，徽标显示附属文件数
2. 点"N 个附属文件" → 展开列表 → 点文件 → 预览内容 → 关闭
3. "编辑"按钮 → 回填正确 → 改名保存 → 列表刷新
4. directory 来源 skill：编辑按钮禁用
5. 新建会话发送消息 → server 日志/DB 确认 skills 注入（或临时在 `assembleMessagesV2` 打印验证）

- [ ] **Step 9.4: web 全量回归 + 类型检查**

Run: `pnpm --filter web test && pnpm --filter web exec tsc --noEmit`
Expected: 全部 PASS

- [ ] **Step 9.5: Commit**

```bash
git add apps/web/src/api/real.ts apps/web/src/api/index.ts apps/web/src/views/settings/SkillsPage.tsx
git commit -m "feat(web): skill ZIP import entry, side-file badge and preview panel"
```

---

### Task 10: 全量验证

- [ ] **Step 10.1: 全仓类型检查 + 全部测试 + lint**

Run: `pnpm typecheck`
Expected: PASS

Run: `pnpm --filter server test && pnpm --filter web test`
Expected: 全部 PASS（既有套件零回归；重点关注 `lifecycle.test.ts`、`messages.test.ts`、`sync.test.ts`、`assembler*.test.ts`）

Run: `pnpm lint`
Expected: PASS

- [ ] **Step 10.2: 端到端冒烟（可选但推荐）**

Run: `pnpm dev` → 完成 Task 9 Step 9.3 验收清单

- [ ] **Step 10.3: 更新设计文档状态**

`docs/2026-08-22-skill-system-upgrade-design.md` 头部状态行改为：

```markdown
**状态：** P0+P1 已实施（实施计划 `docs/2026-08-22-skill-system-upgrade-plan.md`）；P2/P3 待排期
```

```bash
git add docs/2026-08-22-skill-system-upgrade-design.md docs/2026-08-22-skill-system-upgrade-plan.md
git commit -m "docs: mark skill system upgrade P0+P1 as implemented"
```

---

## 规格覆盖自查（写给执行者）

| 设计文档条目 | 任务 |
|---|---|
| P0：lifecycle/worker 补 skills 传参 | Task 1 |
| `skill_files` 表 + `skills.triggers` 列（迁移 0005） | Task 3 |
| Shared 类型（SkillFileMeta/SkillFileInput/triggers/fileCount/files） | Task 2 |
| repo：files 全量替换、级联、listSkillFiles/getSkillFile | Task 3 |
| scanner 双模式（目录包 + 平铺）、scripts/ 跳过、限额 | Task 4 |
| sync 附属文件 diff + filesCreated/Updated/Deleted 计数 | Task 5 |
| POST /import（multipart ZIP、三种形态、400 明细） | Task 6 |
| GET /:id/files/*（路径穿越校验） | Task 7 |
| 编辑 UI（回填、PATCH、directory 只读） | Task 8 |
| 导入入口 + fileCount 徽标 + 文件列表/预览 | Task 9 |
| 设计文档"错误处理"表全部场景 | Task 4/5/6/7 对应测试用例 |
| P2（渐进披露/read_skill/always/GitHub 导入/AI 生成）、P3（插件 RFC） | **不在本计划**，另行计划 |

**明确不在本计划内（防执行者顺手实现）:** `agent_skills` 绑定生效（归 diy-agent 计划）、`read_skill` 工具、frontmatter `always`、清单式注入、GitHub URL 导入、模板库、SkillDetailDrawer 独立组件（Task 9 的展开面板即 P1 形态）。
