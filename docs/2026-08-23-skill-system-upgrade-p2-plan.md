# Skill 系统升级 P2（渐进披露 + GitHub 导入 + Agent 自主装载）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** skills 注入从全文改为清单 + `read_skill` 按需读取（渐进披露）；新增 GitHub 仓库导入（manifest + import 端点）与 `list_github_skills`/`install_skill` 内置工具，实现"贴仓库链接 → agent 自行匹配并装载"；补齐 AI 生成入口与创建模板。

**Architecture:** 注入改造集中在 `prompt/`（`SkillInjection` 扩展字段 + assembler v1/v2 清单化，`always: true` 保留全文例外）；GitHub 能力落在新模块 `skills/github.ts`（域名白名单 + 归档大小上限 + codeload 拉取 + 多 skill 发现 + 单 skill 导入），路由薄封装；两个内置工具挂既有 `tools/builtins/` 注册体系（`read_skill`/`list_github_skills` 为 safe，`install_skill` 为 **restricted**——持久化 prompt 注入必须过审批流）；AI 生成走"预设 prompt → agent 产出草稿 → `install_skill(content)` → 审批"闭环，web 侧只需一个非持久化 draftStore + Sender 消费。

**Tech Stack:** 既有栈（Hono 4 + better-sqlite3 + fflate 已引入）；新依赖：**无**。

**规格来源:** `docs/2026-08-22-skill-system-upgrade-design.md`（"GitHub 仓库导入与 agent 自主装载"节 + 支柱三渐进披露；开放问题 5 已决策域名白名单、问题 7 建议候选 ≤3 呈报）

**前置:** P0+P1 已在分支 `skill-system-upgrade` 交付（迁移至 0006）。本计划在其上继续（同一分支或合并后新分支均可），迁移使用 **`0007_skill_always.sql`**（执行前确认 `migration/sql/` 下一个可用编号）。

**关键设计决策（已锁定）:**
- `always` 采用 frontmatter 布尔字段（开放问题 1 落地）：`always: true` 全文注入；v1 不做独立 UI 开关（body 已剥离 frontmatter，UI 开关会与内容脱钩），管理页仅显示徽标
- 清单注入格式：常驻每 skill 约 2-3 行（name/description/triggers），头部指引模型用 `read_skill` 取正文
- `install_skill` = restricted：skill 是持久化 prompt 注入，每会话首用过审批弹窗（用户看到将安装的 name/description）；`content` 参数路径同时服务 AI 生成闭环
- 域名白名单：`SKILL_IMPORT_ALLOWED_HOSTS`（默认 `github.com`），归档上限 `SKILL_IMPORT_MAX_MB`（默认 10）；env 在 `github.ts` 调用时读取（测试可注入）
- 仓库归档 URL：`https://codeload.github.com/{owner}/{repo}/zip/HEAD`（HEAD = 默认分支别名）；归档根目录 `{repo}-{ref}/` 统一剥离
- `read_skill` 按 name 在 enabled 集内精确匹配，取第一个匹配（skills.name 无唯一约束，同名歧义 v1 接受并在返回中注明）
- agent 自主装载不持有 AUTH_TOKEN：工具内部直调 repo/service 函数（同进程），无 HTTP 回环

**命令约定（均在 worktree 根执行）:**
- 定向测试：`pnpm --filter server exec vitest run <路径>` / `pnpm --filter web exec vitest run <路径>`
- 全量验证：`pnpm typecheck && pnpm --filter server test && pnpm --filter web test && pnpm lint`
- 已知基线：`src/plugin/__tests__/loader.test.ts` 2 例失败与 `src/plugin/loader.ts(229,56)` typecheck 错误为并发会话预存问题，不算回归

---

### Task 1: `always` 字段——shared 类型 + parser 解析

**Files:**
- Modify: `packages/shared/src/skill.ts`
- Modify: `apps/server/src/skills/parser.ts`
- Test: `apps/server/src/skills/__tests__/parser.test.ts`（追加）

- [ ] **Step 1.1: 写失败测试**

`apps/server/src/skills/__tests__/parser.test.ts` describe 内追加：

```ts
  it('parses always: true from frontmatter', () => {
    const parsed = parseSkillMarkdown(`---\nname: A\ndescription: d\nalways: true\n---\nbody`);
    expect(parsed.frontmatter.always).toBe(true);
  });

  it('always defaults to absent (undefined) and tolerates invalid values', () => {
    const absent = parseSkillMarkdown(`---\nname: A\ndescription: d\n---\nbody`);
    expect(absent.frontmatter.always).toBeUndefined();

    const invalid = parseSkillMarkdown(`---\nname: A\ndescription: d\nalways: yes\n---\nbody`);
    expect(invalid.frontmatter.always).toBeUndefined(); // 非 boolean 容错为未设置
  });
```

- [ ] **Step 1.2: 运行确认失败**

Run: `pnpm --filter server exec vitest run src/skills/__tests__/parser.test.ts`
Expected: 新用例 FAIL（`always` 属性不存在）

- [ ] **Step 1.3: 实现**

`packages/shared/src/skill.ts` 的 `SkillFrontmatter` 加字段（`triggers` 之后）：

```ts
  /** 恒相关短 skill：全文常驻注入，不进清单（渐进披露例外，设计支柱三）。 */
  always?: boolean;
```

同文件 `SkillMeta`（`triggers` 后）、`CreateSkillParams`（`triggers` 后）、`UpdateSkillParams`（`triggers` 后）各加：

```ts
  /** 恒相关标记（frontmatter always；缺省 false 语义）。 */
  always?: boolean;
```

`apps/server/src/skills/parser.ts` 的 `normalizeFrontmatter`（`version` 处理之前）加：

```ts
  if (typeof data.always === 'boolean') {
    result.always = data.always;
  }
```

- [ ] **Step 1.4: 运行确认通过**

Run: `pnpm --filter server exec vitest run src/skills/__tests__/parser.test.ts && pnpm --filter shared build && pnpm --filter shared test`
Expected: 全部 PASS（shared 重建后类型流通）

- [ ] **Step 1.5: Commit**

```bash
git add packages/shared/src/skill.ts apps/server/src/skills/parser.ts apps/server/src/skills/__tests__/parser.test.ts
git commit -m "feat(skill): parse frontmatter always flag (full-injection exception)"
```

---

### Task 2: 迁移 0007 + repo/routes/sync 持久化 `always`

**Files:**
- Create: `apps/server/src/migration/sql/0007_skill_always.sql`（编号按执行时下一个可用顺延）
- Create: `apps/server/src/migration/__tests__/0007-skill-always.test.ts`
- Modify: `apps/server/src/repo/skill.ts`
- Modify: `apps/server/src/migration/__tests__/runner.test.ts`（计数 6→7，加 always 列断言）
- Modify: `apps/server/src/skills/sync.ts` + `apps/server/src/routes/skills.ts`（透传）
- Test: `apps/server/src/repo/__tests__/skill.test.ts`、`apps/server/src/skills/__tests__/sync.test.ts`（追加）

- [ ] **Step 2.1: 写失败迁移测试**

创建 `apps/server/src/migration/__tests__/0007-skill-always.test.ts`（套 0006 测试的 setup 模板）：

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initDatabase, getDb } from '../../db/index.js';

describe('migration 0007 skill always', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'migration-0007-'));
    initDatabase(testDir);
  });

  afterEach(() => {
    try { getDb().close(); } catch { /* ignore */ }
    if (testDir && existsSync(testDir)) rmSync({ recursive: true, force: true }, testDir);
  });

  it('adds always column to skills with default 0', () => {
    const cols = getDb().prepare('PRAGMA table_info(skills)').all() as Array<{ name: string }>;
    expect(cols.map((c) => c.name)).toContain('always');

    getDb().prepare(
      "INSERT INTO skills (id, name, description, body, source, enabled, created_at, updated_at) VALUES ('s1', 'T', '', 'b', 'upload', 1, 1, 1)",
    ).run();
    const row = getDb().prepare("SELECT always FROM skills WHERE id = 's1'").get() as { always: number };
    expect(row.always).toBe(0);
  });
});
```

- [ ] **Step 2.2: 确认失败 → 写迁移 → 确认通过**

Run 失败后创建 `0007_skill_always.sql`：

```sql
-- Skill 渐进披露（设计 docs/2026-08-22-skill-system-upgrade-design.md 支柱三）：
-- always=1 的 skill 绕过清单、全文常驻注入。
ALTER TABLE skills ADD COLUMN always INTEGER NOT NULL DEFAULT 0;
```

同步更新 `runner.test.ts`：两处 `expect(row.count).toBe(6)` → `.toBe(7)`，并在 fresh-install 断言块加 `expect(tableNames).toContain('skill_files');` 之后无需新表断言（always 是列）。Run 两个迁移测试文件，全部 PASS。

- [ ] **Step 2.3: repo 失败测试 → 实现**

`repo/__tests__/skill.test.ts` 追加：

```ts
  it('createSkill/updateSkill persist always flag', () => {
    const skill = createSkill({ name: 'A', description: '', body: 'b', source: 'upload', always: true });
    expect(skill.always).toBe(true);

    const updated = updateSkill(skill.id, { always: false });
    expect(updated?.always).toBe(false);
    expect(getSkill(skill.id)?.always).toBe(false);
  });
```

`repo/skill.ts`：`SkillRow` 加 `always: number;`；`rowToMeta` 返回加 `always: Boolean(row.always),`；`createSkill` INSERT 列与值补 `always`（`params.always ? 1 : 0`）；`updateSkill` 计算 `const always = params.always !== undefined ? params.always : Boolean(existing.always);` 并加入 UPDATE 列（create/update 已事务化，直接嵌进既有语句）。

- [ ] **Step 2.4: sync + routes 透传**

`sync.test.ts` 追加：

```ts
  it('syncs frontmatter always flag and detects always-only changes', () => {
    const f = join(dir, 'al.md');
    writeFileSync(f, `---\nname: Al\ndescription: d\nalways: true\n---\nbody`);
    syncDirectorySkills(getDb(), dir);
    const skill = listSkillsBySource('directory').find((s) => s.name === 'Al');
    expect(skill?.always).toBe(true);

    writeFileSync(f, `---\nname: Al\ndescription: d\n---\nbody`); // 仅去掉 always
    const result = syncDirectorySkills(getDb(), dir);
    expect(result.updated).toBe(1);
    expect(listSkillsBySource('directory').find((s) => s.name === 'Al')?.always).toBe(false);
  });
```

`sync.ts`：create/update 调用各加 `always: disc.parsed.frontmatter.always ?? false,`；`contentChanged` 加 `Boolean(detail?.always) !== Boolean(disc.parsed.frontmatter.always) ||`。`routes/skills.ts` POST `/` 的 createSkill 调用加 `always: parsed.frontmatter.always,`（PATCH 已整体透传无需改）。

Run: `pnpm --filter server exec vitest run src/repo/__tests__/skill.test.ts src/skills src/migration src/routes/__tests__/skills.test.ts` 全 PASS；`pnpm --filter server exec tsc --noEmit` 仅预存 plugin 错误。

- [ ] **Step 2.5: Commit**

```bash
git add apps/server/src/migration apps/server/src/repo/skill.ts apps/server/src/repo/__tests__/skill.test.ts apps/server/src/skills/sync.ts apps/server/src/skills/__tests__/sync.test.ts apps/server/src/routes/skills.ts
git commit -m "feat(server): persist skill always flag (0007) through repo/sync/routes"
```

---

### Task 3: `read_skill` 内置工具（safe）

**Files:**
- Create: `apps/server/src/tools/builtins/read-skill.ts`
- Modify: `apps/server/src/tools/builtins/index.ts`（注册表追加）
- Create: `apps/server/src/tools/builtins/__tests__/read-skill.test.ts`

**参考实现模式:** `tools/builtins/base64-decode.ts`（`ToolExecutor` + `builtinTool()` + `executeLocalTool` + helpers）；注册见 `index.ts` 的 `builtinExecutors` 数组。

- [ ] **Step 3.1: 写失败测试**

创建 `__tests__/read-skill.test.ts`（mock repo 模块；参考 `http-fetch.test.ts` 的 mock 风格）：

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SkillMeta, SkillDetail } from '@my-copilot/shared';

vi.mock('../../../repo/skill.js', () => ({
  listEnabledSkills: vi.fn(),
  getSkill: vi.fn(),
  getSkillFile: vi.fn(),
}));

import { listEnabledSkills, getSkill, getSkillFile } from '../../../repo/skill.js';
import { readSkillExecutor } from '../read-skill.js';

const ctx = { sessionId: 's' };

function makeDetail(over: Partial<SkillDetail>): SkillDetail {
  return {
    id: 'sk1', name: 'pdf', description: 'd', content: '# body', enabled: true,
    createdAt: 1, updatedAt: 1, source: 'upload', ...over,
  };
}

describe('read_skill tool', () => {
  beforeEach(() => vi.clearAllMocks());

  it('describe: safe builtin with name + optional path', () => {
    const tool = readSkillExecutor.describe();
    expect(tool.name).toBe('read_skill');
    expect(tool.safetyLevel).toBe('safe');
    expect(tool.inputSchema.fields.map((f) => f.name)).toEqual(['name', 'path']);
  });

  it('returns SKILL.md body by name when path omitted', async () => {
    vi.mocked(listEnabledSkills).mockReturnValue([
      { id: 'sk1', name: 'pdf', description: '', enabled: true, createdAt: 1, updatedAt: 1 } as SkillMeta,
    ]);
    vi.mocked(getSkill).mockReturnValue(makeDetail({}));

    const result = await readSkillExecutor.execute({ name: 'pdf' }, ctx);
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain('# body');
  });

  it('returns side file content when path given', async () => {
    vi.mocked(listEnabledSkills).mockReturnValue([
      { id: 'sk1', name: 'pdf', description: '', enabled: true, createdAt: 1, updatedAt: 1 } as SkillMeta,
    ]);
    vi.mocked(getSkill).mockReturnValue(makeDetail({}));
    vi.mocked(getSkillFile).mockReturnValue({ path: 'references/api.md', content: 'api doc' });

    const result = await readSkillExecutor.execute({ name: 'pdf', path: 'references/api.md' }, ctx);
    expect(result.content[0]?.text).toContain('api doc');
    expect(vi.mocked(getSkillFile).mock.calls[0]).toEqual(['sk1', 'references/api.md']);
  });

  it('errors for unknown or disabled skill without leaking content', async () => {
    vi.mocked(listEnabledSkills).mockReturnValue([]);
    const result = await readSkillExecutor.execute({ name: 'nope' }, ctx);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('不在当前可用');
  });

  it('rejects unsafe path arguments', async () => {
    vi.mocked(listEnabledSkills).mockReturnValue([
      { id: 'sk1', name: 'pdf', description: '', enabled: true, createdAt: 1, updatedAt: 1 } as SkillMeta,
    ]);
    vi.mocked(getSkill).mockReturnValue(makeDetail({}));
    const result = await readSkillExecutor.execute({ name: 'pdf', path: '../etc/passwd' }, ctx);
    expect(result.isError).toBe(true);
    expect(getSkillFile).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3.2: 确认失败 → 实现**

创建 `tools/builtins/read-skill.ts`：

```ts
import type { ToolExecutor } from '../registry.js';
import { builtinTool, executeLocalTool, textResult, errorResult, requiredString, optionalString } from './helpers.js';
import { listEnabledSkills, getSkill, getSkillFile } from '../../repo/skill.js';
import { isSafeSkillFilePath } from '../../skills/limits.js';

/** 单次工具输出字符上限（安全阀；skill 正文按生态约定 <5k，references 可能更大）。 */
const READ_SKILL_MAX_CHARS = 64_000;

export const readSkillExecutor: ToolExecutor = {
  describe: () => builtinTool({
    id: 'read-skill',
    name: 'read_skill',
    description:
      'Read the full instructions of an available skill, or one of its side files. ' +
      'Use after the skill manifest suggests a skill is relevant. ' +
      'Returns the skill name/description plus the requested content.',
    fields: [
      { name: 'name', type: 'string', description: 'Exact skill name from the manifest', required: true },
      { name: 'path', type: 'string', description: "Optional side-file path (e.g. 'references/api.md'); omit for the SKILL.md body", required: false },
    ],
  }),
  async execute(args, context) {
    return executeLocalTool(context, () => {
      const name = requiredString(args, 'name', 500);
      const path = optionalString(args, 'path', 1000);

      // 可见集 = 全局 enabled（agent_skills 白名单过滤由 diy-agent 计划接入）
      const match = listEnabledSkills().find((s) => s.name === name);
      if (!match) {
        return errorResult(`Skill "${name}" 不在当前可用技能集内（未启用或不存在）。`);
      }
      const detail = getSkill(match.id);
      if (!detail) return errorResult(`Skill "${name}" 读取失败。`);

      let text: string;
      if (path === undefined) {
        text = `# ${detail.name}\n\n${detail.description}\n\n---\n\n${detail.content}`;
      } else {
        if (!isSafeSkillFilePath(path)) {
          return errorResult('Invalid path：不允许 ..、绝对路径或反斜杠。');
        }
        const file = getSkillFile(match.id, path);
        if (!file) return errorResult(`Skill "${name}" 没有附属文件 ${path}。`);
        text = file.content;
      }

      if (text.length > READ_SKILL_MAX_CHARS) {
        text = text.slice(0, READ_SKILL_MAX_CHARS) + '\n…[truncated]';
      }
      return textResult(text);
    });
  },
};
```

`tools/builtins/index.ts` 的 `builtinExecutors` 数组追加 `{ name: 'read_skill', executor: readSkillExecutor }`（对齐既有条目形态——先读该文件确认导出名）。

- [ ] **Step 3.3: 确认通过 + Commit**

Run: `pnpm --filter server exec vitest run src/tools src/routes/__tests__/tools.test.ts` 全 PASS（既有 tools 路由测试因新工具出现在列表而断言数量的话，按需更新——先跑再定）。

```bash
git add apps/server/src/tools/builtins
git commit -m "feat(tools): read_skill builtin (safe) — on-demand skill body/side-file access"
```

---

### Task 4: 渐进披露——SkillInjection 扩展 + assembler 清单注入

**Files:**
- Modify: `apps/server/src/prompt/assembler.ts`（`SkillInjection` + v1/v2 注入段）
- Modify: `apps/server/src/prompt/skill-injections.ts`（丰富字段）
- Test: `apps/server/src/prompt/__tests__/assembler.test.ts`、`assembler-v2.test.ts`、`skill-injections.test.ts`（更新 + 追加）

**行为契约（先写测试锁定）:**
1. 非 always skills → 清单条目：`- name: X | description: Y | triggers: a, b`，头部含 `read_skill` 指引；**不含正文**
2. `always: true` skill → 保留既有全文块格式（`# Skill: X\n\n<body>`）
3. 无 skills → 不注入（现状不变）；顺序/字节稳定性维持（system → skills 清单 → always 全文 → memory → summary）

- [ ] **Step 4.1: 更新测试（先红）**

`skill-injections.test.ts`：现有断言 `{name, body}` 扩展为包含 `description`/`triggers`/`always`（fixture 补字段）。

`assembler.test.ts` / `assembler-v2.test.ts`：把既有"全文注入"断言改为新契约，例如：

```ts
  it('injects manifest (no body) for regular skills and full text for always skills', async () => {
    const messages = assembleMessages({ /* v2 用 await assembleMessagesV2 */
      history: [], userContent: 'hi',
      skills: [
        { name: 'pdf', description: '处理 PDF', triggers: ['pdf', '文档'], body: 'SECRET-BODY', always: false },
        { name: 'persona', description: '', body: 'You are terse.', always: true },
      ],
    });
    const skillsMsg = messages.find((m) => m.role === 'system' && m.content.includes('skills are available'));
    expect(skillsMsg?.content).toContain('- name: pdf');
    expect(skillsMsg?.content).toContain('处理 PDF');
    expect(skillsMsg?.content).toContain('pdf, 文档');
    expect(skillsMsg?.content).toContain('read_skill');
    expect(skillsMsg?.content).not.toContain('SECRET-BODY'); // 正文不常驻
    expect(skillsMsg?.content).toContain('# Skill: persona'); // always 全文
    expect(skillsMsg?.content).toContain('You are terse.');
  });
```

Run 确认红。

- [ ] **Step 4.2: 实现**

`assembler.ts`：

```ts
/** Skill 注入条目（渐进披露：常规 skill 仅进清单，正文经 read_skill 按需读取）。 */
export interface SkillInjection {
  name: string;
  description?: string;
  triggers?: string[];
  body: string;
  always?: boolean;
}

/** 清单 + always 全文段（v1/v2 共用）。字节序确定：清单在前、always 全文在后。 */
export function buildSkillsSection(skills: SkillInjection[]): string {
  const manifest = skills.filter((s) => !s.always);
  const full = skills.filter((s) => s.always && s.body.trim().length > 0);
  if (manifest.length === 0 && full.length === 0) return '';

  const parts: string[] = [];
  if (manifest.length > 0) {
    const lines = manifest
      .map((s) => {
        const desc = s.description?.trim() || '（无描述）';
        const trig = s.triggers && s.triggers.length > 0 ? ` | triggers: ${s.triggers.join(', ')}` : '';
        return `- name: ${s.name} | description: ${desc}${trig}`;
      })
      .join('\n');
    parts.push(
      `The following skills are available. To use one, first read its full ` +
      `instructions with the read_skill tool (pass the exact name), then follow them:\n\n${lines}`,
    );
  }
  if (full.length > 0) {
    const blocks = full.map((s) => `# Skill: ${s.name}\n\n${s.body.trim()}`).join('\n\n---\n\n');
    parts.push(`Always apply these skills:\n\n${blocks}`);
  }
  return parts.join('\n\n');
}
```

v1 `assembleMessages` 与 v2 `assembleMessagesV2` 的 skills 段统一改为 `const skillsText = buildSkillsSection(params.skills ?? []);`（v1 注入条件 `if (skillsText)`，v2 同步替换既有 skillsText 构造；其余管线不动）。

`skill-injections.ts` 的 `buildSkillInjections` 返回值补齐字段：

```ts
    return detail
      ? [{
          name: detail.name,
          description: detail.description,
          triggers: detail.triggers,
          body: detail.content,
          always: detail.always,
        }]
      : [];
```

- [ ] **Step 4.3: 确认通过 + 回归**

Run: `pnpm --filter server exec vitest run src/prompt src/agent-loop src/streaming` 全 PASS（lifecycle/runner 既有测试若断言旧注入文案需同步微调——以测试意图为准更新断言，不删用例）。

- [ ] **Step 4.4: Commit**

```bash
git add apps/server/src/prompt
git commit -m "feat(prompt): progressive disclosure — manifest injection + always full-text + read_skill guidance"
```

---

### Task 5: GitHub 服务模块（白名单 + 归档 + 发现 + 导入）

**Files:**
- Create: `apps/server/src/skills/github.ts`
- Create: `apps/server/src/skills/__tests__/github.test.ts`

**模块接口（导出）：**

```ts
export interface RepoSkillEntry { path: string; name: string; description: string; fileCount: number; }
export interface GithubSkillManifest { repo: string; ref: string; entries: RepoSkillEntry[]; }
export function parseGithubRepoUrl(url: string): { owner: string; repo: string; archiveUrl: string }; // 非法/非白名单 → throw
export async function listRepoSkills(url: string): Promise<GithubSkillManifest>;          // 只读
export async function importRepoSkill(url: string, path?: string): Promise<SkillDetail>;  // 落库 source='upload'
```

- [ ] **Step 5.1: 写失败测试**

`__tests__/github.test.ts`（fflate `zipSync` 造归档 fixture，`vi.stubGlobal('fetch', ...)` mock；每用例设置 `process.env.SKILL_IMPORT_ALLOWED_HOSTS` / `SKILL_IMPORT_MAX_MB` 后还原）：

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { zipSync, strToU8 } from 'fflate';

const { listRepoSkills, importRepoSkill, parseGithubRepoUrl } = await import('../github.js');

function repoZip(root: string, entries: Record<string, string>): Response {
  const full = Object.fromEntries(
    Object.entries(entries).map(([k, v]) => [`${root}/${k}`, strToU8(v)]),
  );
  const body = zipSync(full);
  return new Response(body, { status: 200, headers: { 'content-length': String(body.length) } });
}

const SKILL_MD = (n: string) => `---\nname: ${n}\ndescription: skill ${n}\n---\n# ${n} body`;

beforeEach(() => { process.env.SKILL_IMPORT_MAX_MB = '1'; });
afterEach(() => { vi.unstubAllGlobals(); delete process.env.SKILL_IMPORT_ALLOWED_HOSTS; });

describe('parseGithubRepoUrl', () => {
  it('accepts github.com owner/repo and builds codeload HEAD archive url', () => {
    const r = parseGithubRepoUrl('https://github.com/anthropics/skills');
    expect(r.owner).toBe('anthropics');
    expect(r.repo).toBe('skills');
    expect(r.archiveUrl).toBe('https://codeload.github.com/anthropics/skills/zip/HEAD');
  });

  it('rejects non-whitelisted hosts', () => {
    expect(() => parseGithubRepoUrl('https://evil.com/a/b')).toThrow(/不允许/);
  });

  it('honors SKILL_IMPORT_ALLOWED_HOSTS override', () => {
    process.env.SKILL_IMPORT_ALLOWED_HOSTS = 'gitee.com';
    expect(() => parseGithubRepoUrl('https://gitee.com/a/b')).not.toThrow();
    expect(() => parseGithubRepoUrl('https://github.com/a/b')).toThrow(/不允许/);
  });
});

describe('listRepoSkills', () => {
  it('lists pack skills and root SKILL.md, stripping archive root prefix', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => repoZip('skills-abc123', {
      'pdf/SKILL.md': SKILL_MD('pdf'),
      'pdf/references/api.md': 'api',
      'docx/SKILL.md': SKILL_MD('docx'),
      'README.md': 'not a skill entry',
    })));

    const m = await listRepoSkills('https://github.com/o/r');
    expect(m.entries.map((e) => e.name).sort()).toEqual(['docx', 'pdf']);
    const pdf = m.entries.find((e) => e.name === 'pdf')!;
    expect(pdf.path).toBe('pdf');
    expect(pdf.fileCount).toBe(1);
    expect(pdf.description).toBe('skill pdf');
  });

  it('rejects archives over the size cap via content-length', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(new Uint8Array(10), { status: 200, headers: { 'content-length': String(2 * 1024 * 1024) } })));
    await expect(listRepoSkills('https://github.com/o/r')).rejects.toThrow(/上限/);
  });

  it('surfaces fetch failures with status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nf', { status: 404 })));
    await expect(listRepoSkills('https://github.com/o/r')).rejects.toThrow(/404/);
  });
});

describe('importRepoSkill', () => {
  it('imports one pack with side files as upload-source editable copy', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => repoZip('skills-abc123', {
      'pdf/SKILL.md': `---\nname: pdf\ndescription: d\ntriggers:\n  - pdf\n---\nbody`,
      'pdf/references/api.md': 'api',
    })));
    const { getDb, initDatabase } = await import('../../db/index.js');
    const { mkdtempSync, rmSync, existsSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'gh-import-'));
    initDatabase(dir);
    try {
      const detail = await importRepoSkill('https://github.com/o/r', 'pdf');
      expect(detail.source).toBe('upload');
      expect(detail.triggers).toEqual(['pdf']);
      expect(detail.files?.map((f) => f.path)).toEqual(['references/api.md']);
    } finally {
      getDb().close();
      if (existsSync(dir)) rmSync({ recursive: true, force: true }, dir);
    }
  });

  it('throws with candidate list when path omitted and repo has multiple skills', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => repoZip('skills-abc123', {
      'a/SKILL.md': SKILL_MD('a'), 'b/SKILL.md': SKILL_MD('b'),
    })));
    await expect(importRepoSkill('https://github.com/o/r')).rejects.toThrow(/a.*b|多个/);
  });
});
```

- [ ] **Step 5.2: 确认失败 → 实现**

创建 `skills/github.ts`（要点）：

```ts
import { unzipSync, strFromU8 } from 'fflate';
import type { SkillDetail } from '@my-copilot/shared';
import { parseSkillMarkdown } from './parser.js';
import { createSkill } from '../repo/skill.js';
import {
  SKILL_FILE_MAX_BYTES, SKILL_MAX_FILES, SKILL_FILES_TOTAL_MAX_BYTES,
  isSkillTextFile, isSafeSkillFilePath,
} from './limits.js';

const DEFAULT_ALLOWED_HOSTS = 'github.com,codeload.github.com';

function allowedHosts(): string[] {
  return (process.env.SKILL_IMPORT_ALLOWED_HOSTS?.trim() || DEFAULT_ALLOWED_HOSTS)
    .split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
}

function maxArchiveBytes(): number {
  const mb = Number(process.env.SKILL_IMPORT_MAX_MB) || 10;
  return mb * 1024 * 1024;
}

export function parseGithubRepoUrl(url: string): { owner: string; repo: string; archiveUrl: string } {
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error(`无效的仓库 URL：${url}`); }
  if (!allowedHosts().includes(parsed.hostname.toLowerCase())) {
    throw new Error(`仓库域名 ${parsed.hostname} 不在白名单内（SKILL_IMPORT_ALLOWED_HOSTS）`);
  }
  const m = parsed.pathname.match(/^\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  if (!m) throw new Error(`无法从 URL 解析 owner/repo：${url}`);
  const [, owner, repo] = m;
  return { owner, repo, archiveUrl: `https://codeload.github.com/${owner}/${repo}/zip/HEAD` };
}
```

其余实现要点（按测试契约）：`fetchArchive`——检查 `content-length` 超限即 throw（含"上限"字样），非 2xx throw 含 status；`arrayBuffer` 后二次校验 `byteLength`；`unzipSync` → 剥离归档根前缀（取任一 entry 的第一段）→ 过滤目录/隐藏文件（复用 zip-import 同规则）。发现：`<dir>/SKILL.md`（深度恰为 1）逐个 `parseSkillMarkdown` 取 name/description，附属文件仅计数（不载内容）；根级 `SKILL.md` 记为 `path: ''`。导入：定位 `path` 对应目录 → 递归收集附属文件（文本白名单 + `isSafeSkillFilePath` + 三限额，超限 throw）→ `createSkill({ name, description, body, triggers, always, files, source: 'upload' })`；path 缺省且多候选时 throw 并列出候选名（问题 7 的服务端兜底：呈报由 agent 在工具层做，这里保证错误信息可用）。所有网络错误/解析错误向上 throw（由路由层转 400 或工具层转 isError）。

Run: `pnpm --filter server exec vitest run src/skills/__tests__/github.test.ts` 全 PASS。

- [ ] **Step 5.3: Commit**

```bash
git add apps/server/src/skills/github.ts apps/server/src/skills/__tests__/github.test.ts
git commit -m "feat(skills): github repo service — host whitelist, capped archive fetch, multi-skill discovery, single-skill import"
```

---

### Task 6: GitHub 路由（manifest + import）

**Files:**
- Modify: `apps/server/src/routes/skills.ts`
- Test: `apps/server/src/routes/__tests__/skills.test.ts`（追加；`vi.mock('../../skills/github.js')`）

- [ ] **Step 6.1: 写失败测试**

```ts
  it('GET /github/manifest proxies listRepoSkills', async () => {
    vi.mocked(listRepoSkills).mockResolvedValue({
      repo: 'o/r', ref: 'HEAD',
      entries: [{ path: 'pdf', name: 'pdf', description: 'd', fileCount: 1 }],
    });
    const app = createTestApp();
    const res = await app.request('/github/manifest?url=' + encodeURIComponent('https://github.com/o/r'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as ApiResponse;
    expect((body.data as { entries: unknown[] }).entries).toHaveLength(1);
  });

  it('GET /github/manifest rejects non-whitelisted url with 400', async () => {
    vi.mocked(listRepoSkills).mockRejected(new Error('仓库域名 evil.com 不在白名单内'));
    const app = createTestApp();
    const res = await app.request('/github/manifest?url=' + encodeURIComponent('https://evil.com/a/b'));
    expect(res.status).toBe(400);
  });

  it('POST /import/github creates skill via importRepoSkill', async () => {
    vi.mocked(importRepoSkill).mockResolvedValue({ ...mockSkillDetail, id: 'gh1' });
    const app = createTestApp();
    const res = await app.request('/import/github', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://github.com/o/r', path: 'pdf' }),
    });
    expect(res.status).toBe(201);
    expect(vi.mocked(importRepoSkill).mock.calls[0]).toEqual(['https://github.com/o/r', 'pdf']);
  });
```

- [ ] **Step 6.2: 确认失败 → 实现 → 确认通过**

`routes/skills.ts`：import 补 `listRepoSkills, importRepoSkill`（来自 `../skills/github.js`，mock 区同步）；在 POST `/import` 之后注册：

```ts
  // GET /github/manifest — 列出仓库内的 skill 候选（只读，agent 仓库内检索用）。
  app.get('/github/manifest', async (c) => {
    const url = c.req.query('url');
    if (!url) throw new HttpError(400, 'Missing required query: url');
    try {
      return successResponse(c, await listRepoSkills(url));
    } catch (err) {
      throw new HttpError(400, err instanceof Error ? err.message : String(err));
    }
  });

  // POST /import/github — 从仓库导入单个 skill（path 缺省要求仓库为单 skill 形态）。
  app.post('/import/github', async (c) => {
    const body = await c.req.json<{ url?: string; path?: string }>();
    if (!body.url) throw new HttpError(400, 'Missing required field: url');
    try {
      return successResponse(c, await importRepoSkill(body.url, body.path), 201);
    } catch (err) {
      throw new HttpError(400, err instanceof Error ? err.message : String(err));
    }
  });
```

Run: `pnpm --filter server exec vitest run src/routes/__tests__/skills.test.ts` 全 PASS。

- [ ] **Step 6.3: Commit**

```bash
git add apps/server/src/routes/skills.ts apps/server/src/routes/__tests__/skills.test.ts
git commit -m "feat(server): GET /api/skills/github/manifest + POST /api/skills/import/github"
```

---

### Task 7: `list_github_skills`（safe）+ `install_skill`（restricted）工具

**Files:**
- Create: `apps/server/src/tools/builtins/list-github-skills.ts`
- Create: `apps/server/src/tools/builtins/install-skill.ts`
- Modify: `apps/server/src/tools/builtins/index.ts`
- Create: `apps/server/src/tools/builtins/__tests__/list-github-skills.test.ts`、`__tests__/install-skill.test.ts`

- [ ] **Step 7.1: 写失败测试**

`list-github-skills.test.ts`：`vi.mock('../../../skills/github.js')`；断言 describe 为 safe、`listRepoSkills` 结果以文本形式返回（含 name/description/path/fileCount 逐行）、异常 → `isError: true`。

`install-skill.test.ts`（关键用例）：

```ts
describe('install_skill tool', () => {
  it('describe: restricted builtin（持久注入必须过审批）', () => {
    const tool = installSkillExecutor.describe();
    expect(tool.safetyLevel).toBe('restricted');
  });

  it('content path: parses SKILL.md and creates upload-source skill', async () => {
    vi.mocked(createSkill).mockReturnValue(makeDetail({ name: 'gen' }));
    const result = await installSkillExecutor.execute(
      { content: '---\nname: gen\ndescription: d\nalways: true\n---\n# body' }, ctx);
    expect(vi.mocked(createSkill).mock.calls[0][0]).toMatchObject({
      name: 'gen', source: 'upload', always: true,
    });
    expect(result.isError).toBeUndefined();
  });

  it('repoUrl path: delegates to importRepoSkill', async () => {
    vi.mocked(importRepoSkill).mockResolvedValue(makeDetail({ name: 'pdf' }));
    const result = await installSkillExecutor.execute(
      { repoUrl: 'https://github.com/o/r', path: 'pdf' }, ctx);
    expect(importRepoSkill).toHaveBeenCalledWith('https://github.com/o/r', 'pdf');
    expect(result.content[0]?.text).toContain('pdf');
  });

  it('content missing frontmatter name → isError with guidance', async () => {
    const result = await installSkillExecutor.execute({ content: 'no frontmatter' }, ctx);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('name');
    expect(createSkill).not.toHaveBeenCalled();
  });

  it('neither content nor repoUrl → isError', async () => {
    const result = await installSkillExecutor.execute({}, ctx);
    expect(result.isError).toBe(true);
  });
});
```

- [ ] **Step 7.2: 确认失败 → 实现**

`list-github-skills.ts`（safe，`optionalString` 无必填——repoUrl 必填 `requiredString` maxBytes 1000）：

```ts
export const listGithubSkillsExecutor: ToolExecutor = {
  describe: () => builtinTool({
    id: 'list-github-skills',
    name: 'list_github_skills',
    description:
      'List the skills available in a GitHub repository (read-only). ' +
      'Returns each skill\'s name, description, path and side-file count. ' +
      'Use this to find a skill matching the user\'s need, then install it with install_skill.',
    fields: [
      { name: 'repoUrl', type: 'string', description: 'Repository URL, e.g. https://github.com/anthropics/skills', required: true },
    ],
  }),
  async execute(args, context) {
    return executeLocalTool(context, () => {
      const repoUrl = requiredString(args, 'repoUrl', 1000);
      // fail-soft 转 async：executeLocalTool 不支持 promise，直接 try/catch
      return listRepoSkills(repoUrl).then(
        (m) => textResult(
          `仓库 ${m.repo} 共 ${m.entries.length} 个 skill：\n` +
          m.entries.map((e) => `- path: ${e.path || '(root)'} | name: ${e.name} | ${e.description} | ${e.fileCount} 个附属文件`).join('\n') +
          '\n用 install_skill(repoUrl, path) 安装其中之一。',
        ),
        (err) => errorResult(err instanceof Error ? err.message : String(err)),
      ) as ToolExecutionResult;
    });
  },
};
```

（若 `executeLocalTool` 的同步签名不便，可直接手写 try/catch + signal 检查，模式以 `http-fetch.ts` 现有异步工具为准——实现时先读它对齐。）

`install-skill.ts`（**restricted**，describe 覆写安全级）：

```ts
function describeInstallSkill(): Tool {
  return { ...builtinTool({
    id: 'install-skill',
    name: 'install_skill',
    description:
      'Install a skill so it is available in future conversations. ' +
      ' EITHER pass content (a complete SKILL.md with YAML frontmatter name/description) ' +
      'to save a drafted skill, OR pass repoUrl (+ optional path from list_github_skills) ' +
      'to install from a GitHub repository. ' +
      'When multiple repo skills match the user\'s request: present up to 3 candidates and ask; ' +
      'if more than 3, pick the best and explain why. Always show the user what will be installed.',
    fields: [
      { name: 'repoUrl', type: 'string', description: 'GitHub repository URL', required: false },
      { name: 'path', type: 'string', description: 'Skill path inside the repo (from list_github_skills)', required: false },
      { name: 'content', type: 'string', description: 'Complete SKILL.md content (frontmatter + body)', required: false },
    ],
  }), safetyLevel: 'restricted' };
}
```

execute：`repoUrl` 分支 `importRepoSkill(repoUrl, path)`；否则 `content` 分支 `parseSkillMarkdown` → 缺 name 则 errorResult（含指引）→ `createSkill({ name, description, body, triggers, always, source: 'upload' })`；两者皆空 → errorResult。成功返回 `已安装 skill「${name}」：${description}（下个会话起生效）`。（restricted 审批流由 executor 既有机制按 safetyLevel 自动触发，本工具无需感知。）

`builtins/index.ts` 注册两个执行器。

- [ ] **Step 7.3: 确认通过 + 集成回归**

Run: `pnpm --filter server exec vitest run src/tools src/routes/__tests__/tools.test.ts src/agent-loop` 全 PASS（`tools.test.ts` 的工具列表断言按新增 +2 调整）。

- [ ] **Step 7.4: Commit**

```bash
git add apps/server/src/tools/builtins
git commit -m "feat(tools): list_github_skills (safe) + install_skill (restricted, approval-gated skill install)"
```

---

### Task 8: Web——AI 生成入口 + 模板 + always 徽标

**Files:**
- Create: `apps/web/src/store/draftStore.ts`（非持久化 zustand）
- Modify: `apps/web/src/components/Sender/Sender.tsx`（消费 pendingDraft）
- Modify: `apps/web/src/views/settings/SkillsPage.tsx`（"让 AI 生成"按钮 + always 徽标）
- Modify: `apps/web/src/components/SkillFormModal.tsx`（模板 chips）
- Test: `apps/web/src/store/__tests__/draftStore.test.ts`（新）、`SkillFormModal.test.tsx`（追加模板用例）

**draftStore 形态（AI 生成闭环）：**

```ts
import { create } from 'zustand';

interface DraftStore {
  /** 待注入 Sender 的预填文本；一次性消费。 */
  pendingDraft: string | null;
  setPendingDraft: (text: string) => void;
  consumePendingDraft: () => string | null;
}

export const useDraftStore = create<DraftStore>((set) => ({
  pendingDraft: null,
  setPendingDraft: (text) => set({ pendingDraft: text }),
  consumePendingDraft: () => {
    const d = useDraftStore.getState().pendingDraft;
    if (d !== null) set({ pendingDraft: null });
    return d;
  },
}));
```

- [ ] **Step 8.1: draftStore 失败测试 → 实现**

测试：`setPendingDraft('x')` → `consumePendingDraft()` 返回 `'x'` 且清空；再次 consume 返回 `null`。

- [ ] **Step 8.2: Sender 消费**

`Sender.tsx` 渲染期守卫块（`selectedSessionId !== prevSessionId` 同处风格）追加：每次渲染检查 `useDraftStore.getState().pendingDraft`，非空且 `selectedSessionId` 可用时 `consumePendingDraft()` 并 `setContent(消费值)`（注意：仅当当前 content 为空或同为空会话时注入，避免覆盖用户输入）。

- [ ] **Step 8.3: SkillsPage "让 AI 生成" 按钮 + always 徽标**

Header 三按钮（导入 ZIP / 让 AI 生成 / + 新建）：

```tsx
          <button
            onClick={() => {
              useDraftStore.getState().setPendingDraft(
                '我想创建一个 skill。请先向我确认用途与细节，然后按 Claude Code 生态格式生成 SKILL.md（YAML frontmatter 含 name/description，可选 triggers/always），把完整内容展示给我审阅；我确认后，使用 install_skill 工具的 content 参数保存。',
              )
              navigate('/')
            }}
            className="px-4 py-2 bg-bg-secondary text-text-primary border border-border-base rounded-lg hover:border-primary-400 transition-colors text-sm font-medium"
          >
            让 AI 生成
          </button>
```

（`useNavigate` 来自 react-router-dom； SkillsPage 已在 Router 内。）行内徽标（SourceBadge 旁）：

```tsx
                      {skill.always && (
                        <Badge colorClass="bg-amber-100 text-amber-700">always</Badge>
                      )}
```

- [ ] **Step 8.4: SkillFormModal 模板 chips**

粘贴模式 textarea 上方加三个 chip 按钮，点击填入骨架（`setContent` 并切到粘贴模式）：

```tsx
const TEMPLATES: Record<string, string> = {
  代码评审: `---\nname: code-review\ndescription: 逐文件评审代码变更，输出结构化问题清单与修复建议\ntriggers:\n  - 评审\n  - code review\n---\n\n## 评审步骤\n1. ...\n2. ...`,
  写作风格: `---\nname: writing-style\ndescription: 以简洁技术写作风格润色文本\n---\n\n## 风格要点\n- ...`,
  翻译规范: `---\nname: translation\n description: 中英互译时保留术语与代码标识符原文\n---\n\n## 规范\n- ...`,
}
```

（frontmatter 与正文骨架以上述为准，占位内容执行时可润色，但三个 key 与 frontmatter 字段不变。）`SkillFormModal.test.tsx` 追加：点击"代码评审" chip → 粘贴 textarea 值包含 `name: code-review`。

- [ ] **Step 8.5: 确认 + Commit**

Run: `pnpm --filter web test && pnpm --filter web exec tsc --noEmit && pnpm --filter web lint` 全绿。

```bash
git add apps/web/src/store apps/web/src/components apps/web/src/views/settings/SkillsPage.tsx
git commit -m "feat(web): AI-generate skill entry (draft handoff), create templates, always badge"
```

---

### Task 9: 全量验证 + 文档收尾

- [ ] **Step 9.1: 全量**

`pnpm typecheck`（仅预存 plugin 错误）→ `pnpm --filter server test && pnpm --filter web test && pnpm --filter shared test` → `pnpm lint`。已知基线外零失败。

- [ ] **Step 9.2: 手动验收（pnpm dev）**

1. 建 2 个 skill（一个普通 + 一个 frontmatter `always: true`）→ 发消息 → 观察 server 日志/模型行为：普通 skill 只出现清单行、always 出现全文
2. 对话输入 "https://github.com/anthropics/skills 帮我装个处理 PDF 的" → agent 调 `list_github_skills` → 呈报/选择 → `install_skill` 触发审批弹窗 → 批准 → 技能管理页出现新 skill
3. 技能管理页"让 AI 生成"→ 跳转会话且 Sender 预填模板提示词
4. "导入 ZIP"与既有编辑/附属文件功能回归

- [ ] **Step 9.3: 文档状态 + Commit**

设计文档状态行更新为含 P2；`.env.example` 补 `SKILL_IMPORT_ALLOWED_HOSTS` / `SKILL_IMPORT_MAX_MB` 注释行。

```bash
git add docs .env.example 2>/dev/null || git add docs
git commit -m "docs: skill system P2 delivered (progressive disclosure + github import + agent self-install)"
```

---

## 规格覆盖自查（写给执行者）

| 设计文档条目 | 任务 |
|---|---|
| 清单注入 + read_skill 指引 + always 全文例外 | Task 4（SkillInjection 扩展）+ Task 3（工具） |
| `always` frontmatter → 持久化全链路 | Task 1（类型/解析）+ Task 2（迁移/repo/sync/路由）|
| `GET /github/manifest` / `POST /import/github` | Task 5（服务）+ Task 6（路由）|
| 域名白名单 + 归档上限（开放问题 5 决策） | Task 5 |
| `list_github_skills`(safe) / `install_skill`(restricted) | Task 7 |
| 多候选裁决（开放问题 7：≤3 呈报 / >3 自选） | Task 7 install_skill description（提示词层约束）+ Task 5 错误兜底 |
| AI 生成入口（独立入口 → 模板会话形态） | Task 8（draftStore + 按钮 + install_skill content 闭环）|
| 模板 2-3 个 | Task 8 chips |
| always 徽标展示 | Task 8 |

**明确不在本计划:** `agent_skills` 白名单过滤接入 read_skill/install_skill 可见集（归 diy-agent 计划）、GitHub 分支选择（`/tree/branch` URL 解析，v1 恒 HEAD）、聚合站 registry API 浏览（Skillselion 等，另行评估）、`version` 更新提示（开放问题 2 未决）。

**类型一致性自查:** `SkillFrontmatter.always` / `SkillMeta.always` / `Create|UpdateSkillParams.always`（Task 1-2）→ `SkillInjection.always`（Task 4）→ `createSkill({ always })` 消费（Task 2/5/7）——同名字段同一布尔语义；`listRepoSkills/importRepoSkill/parseGithubRepoUrl` 导出名在 Task 5/6/7 三处引用一致。
