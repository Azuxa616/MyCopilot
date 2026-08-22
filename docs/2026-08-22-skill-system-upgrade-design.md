# Skill 系统升级（目录包 + 渐进披露 + Agent 绑定作用域）设计

**日期：** 2026-08-22
**状态：** P0+P1 已实施并终审通过（分支 `skill-system-upgrade`，实施计划 `docs/2026-08-22-skill-system-upgrade-plan.md`，迁移实际编号 `0006_skill_files.sql`）；P2/P3 待排期
**分支：** dev
**来源：** "Skill 新建交互不合理"讨论（三个痛点）+ 业界 agent 产品调研

## 背景与动机

现有 Skill 功能（`apps/server/src/skills/`、`repo/skill.ts`、`routes/skills.ts`、`SkillsPage`）存在一个隐藏缺陷和三个交互层面的痛点：

| # | 问题 | 代码级事实 |
|---|------|-----------|
| 0 | **Skills 在生产链路未生效**（隐藏缺陷，最优先） | `prompt/assembler.ts` 支持 `skills` 注入参数，但 `streaming/lifecycle.ts` 与 `jobs/worker.ts` 均未传入——skills 目前只有管理 UI，从未进入任何一次真实对话。`docs/2026-08-15-diy-agent-design.md` §后端行为已承认此缺口 |
| 1 | **Skill 被建模为单文件** | `skills` 表仅有 `body` 一列；`scanner.ts` 只扫描平铺的单层 `*.md`；插件 RFC（`plugin-manifest-lifecycle.md`）的 `provides.skills` 同样只允许单文件路径 |
| 2 | **创建路径以手写为主** | 新建弹窗仅"上传单个 .md / 粘贴文本"两种模式，要求用户理解 frontmatter；`PATCH /api/skills/:id` 存在但前端无编辑 UI（只能删除重建）；无 ZIP / URL / 仓库导入，无 AI 生成入口；frontmatter 的 `triggers` / `version` 被解析后丢弃，未持久化 |
| 3 | **无作用域概念** | 仅有全局 `enabled` 开关，server 无"工作区/项目"实体，skill 对所有会话一刀切 |

## 业界调研摘要

调研了 7 个产品的 skill / rule / 自定义指令机制，完整对比：

| 产品 | 存储形态 | 作用域 | 创建/导入 | 激活机制 |
|------|---------|--------|-----------|---------|
| Claude Code | `~/.claude/skills/` + `.claude/skills/`，**skill = 目录**（`SKILL.md` + `scripts/` + `references/` + `assets/`） | 个人 / 项目 / 插件 / claude.ai ZIP | 手写、GitHub 市场安装、ZIP 上传、agent 生成（官方 skill-creator） | **三级渐进披露**：L1 元数据常驻（~100 token/skill）→ L2 正文按需（<5k）→ L3 资源按需；`/skill-name` 手动调用 |
| opencode | `~/.config/opencode/skills/` + `.opencode/skills/`，目录形态 | 个人 / 项目 / 插件 | 手写、插件分发 | 同 Claude Code 式渐进披露 |
| Cursor | `.cursor/rules/*.mdc` 单文件 + frontmatter | 项目 / 用户 / 团队（Dashboard） | **`/create-rule` agent 生成**、GUI、GitHub 批量导入 | **四象限**：Always / 智能匹配（description）/ glob 文件匹配 / 仅 @ 手动 |
| Codex CLI | `AGENTS.md` + `~/.codex/prompts/` | 项目 / 全局 | 纯手写 | 全量注入；手动调用 |
| Gemini CLI | `GEMINI.md` + `~/.gemini/settings.json` | 项目 / 全局 | 纯手写 | 全量注入；`/command` 手动 |
| GitHub Copilot | `.github/copilot-instructions.md` + `.github/instructions/*.instructions.md`（按路径/glob 限定） | 仓库 / 组织 / 个人 | 手写、网页设置 | 按文件路径匹配自动附加 |
| Windsurf | `windsurf/rules/` + `windsurf/workflows/` | 项目 / 企业 MDM | 手写、GUI | 自动 + 手动触发 |

提炼出五个设计模式：

1. **Skill 是目录，不是文件**（Claude Code / opencode）：`SKILL.md` 是清单和入口，references（按需阅读）、scripts（不占上下文的可执行能力）、assets 是一等公民。单文件只是最简退化形态。
2. **渐进式披露是 token 经济学核心**：常驻注入仅 name + description，正文和资源触发后才进上下文。MyCopilot 当前设计为"所有 enabled skills 全文注入"，skill 数量增长后必然撞上下文预算（context-management-v2 RFC 的 system 桶仅 5-10%）。
3. **作用域 = 分层叠加**：个人/全局 ↔ 项目 ↔ 团队/插件。"项目"的本质是**对话发生的工作上下文**，不一定是文件目录。
4. **手写是少数派路径**：成熟产品创建入口排序为 *agent 生成* > *导入* > *模板* > 手写。
5. **激活类型显式化**（Cursor 四象限最典型）：always / 智能匹配 / 按上下文匹配 / 手动。MyCopilot 已解析但丢弃的 `triggers` 字段正是这个方向的原型。

### 与项目定位的适配约束

- **Web UI + SQLite 自托管，面向普通用户 + 小团队**——用户不懂 frontmatter，主路径不能是"写带 YAML 头的 markdown"。
- **没有 IDE / 文件树上下文**——Cursor 式 glob 文件作用域在此无意义（不存在"正在编辑的文件"），不照搬。
- **已有两条既定演进线**：DIY agent（`agent_skills` 白名单，设计已定稿）与插件系统 RFC——本设计必须与它们咬合，不另造概念。
- **已有三级工具安全体系**（safe/restricted/danger + 审批流）——直接决定"skill 携带可执行脚本"不可行。

## 目标

1. **修复 P0 缺口**：skills 真正注入生产链路（lifecycle + job worker）。
2. **Skill 升级为目录包**：`SKILL.md` 入口 + 附属文件（references/assets），与 Claude Code 生态格式兼容，社区 skill 仓库可原样导入。
3. **创建交互重排**：导入（ZIP）与 AI 生成为主路径，手写降级为高级选项；补齐编辑 UI。
4. **作用域落地**：复用 DIY agent 的 `agent_skills` 白名单绑定作为作用域机制，`enabled` 保持全局总闸语义，不新建 workspace 实体。
5. **渐进式披露**：注入给模型的常驻内容收敛为 skill 清单（name + description + triggers），正文与附属文件通过内置工具 `read_skill` 按需读取。

## 非目标

- **不引入 workspace / 项目实体**——多项目需求出现时再评估（届时 `skills` 加 `workspace_id` 列即可平滑演进，见"未来演进"）。
- **不支持 skill 携带可执行脚本**（Claude Code 的 `scripts/`）——skill 脚本等于绕过工具安全白名单向会话注入任意代码执行能力，与三级工具安全体系直接冲突。目录同步与 ZIP 导入均跳过 `scripts/`。未来若需要，应将 skill script 注册为受安全体系管控的 Tool，而非 skill 私有能力。
- **不做 glob 文件作用域**（Cursor 式）——Web chat 产品无"正在编辑的文件"上下文。
- **不改 SSE 协议、不改 `agent_skills` 绑定语义**（后者由 diy-agent 设计所有，本设计只消费其结果）。
- **不做 skill 市场 / 分发 / 评分**——分发归插件系统 RFC（T4/T5）管辖，本设计只负责把 `provides.skills` 的规格从单文件升级为目录包（P3）。
- **v1 不追求 claude.ai ZIP 全兼容**（如嵌套 marketplace 结构），只兼容"目录包含 `SKILL.md`"的最小形态。

## 决策记录（建议，随本设计一并待批）

| 决策点 | 建议 | 备选与理由 |
|---|---|---|
| skill 形态 | 目录包：`skills.body` 存 `SKILL.md` 正文（保持现有语义），附属文件入新表 `skill_files` | 备选"全部文件入 skill_files、body 冗余"——迁移成本高且旧数据无收益；方案 A 单文件 skill 零迁移 |
| 生态格式 | 对齐 Claude Code：入口文件名 `SKILL.md`，frontmatter 含 `name`/`description` | 买到"直接导入社区 skill 仓库"的兼容红利 |
| 作用域 | 不新建 workspace；`agent_skills` 白名单 = 作用域，`enabled` = 全局总闸 | 与工具的"总闸 + agent 白名单"完全同构，用户心智统一 |
| 注入策略 | 默认仅清单（manifest）+ `read_skill` 按需读取；短小且恒相关的 skill 可标记全文注入 | 备选"维持全文注入"——skill 数量增长后撞 system 桶预算（5-10%）；备选"每 skill 全文"——token 成本失控 |
| `read_skill` 安全级 | `safe`（只读、无副作用），且只能读取"绑定 ∩ 全局启用"的有效集 | 与 agent 白名单过滤一致性对齐；输出截断复用 context-management-v2 工具输出降级链 |
| 导入来源落库 | ZIP / GitHub 导入创建可编辑副本，`source = 'upload'` | 备选新增 `'import'` 枚举——`CHECK` 约束与前端徽标都要改，收益仅是来源展示，改用导入时间戳区分即可（见开放问题 4） |
| 目录同步兼容 | 同时支持新目录包（`<name>/SKILL.md`）与旧平铺 `*.md`，不做破坏切换 | 平铺形态继续可用，scanner 双模式识别 |
| 附属文件限制 | 单文件 ≤ 256 KB、每 skill ≤ 20 个、总 ≤ 1 MB；仅文本文件；超限跳过 + 计数 + warn | 防 SQLite 膨胀与注入超长内容；数值可配置后再收紧 |

## 总体方案

三根支柱分别回应痛点 1 / 2 / 3，渐进披露同时回应痛点 3 与 token 预算。

### 支柱一：目录包数据模型

```
skills/<skill-name>/
├── SKILL.md          # 必需：入口（frontmatter: name, description, triggers?, version?, always?）
├── references/       # 可选：按需阅读的参考文档（.md/.txt）
└── assets/           # 可选：模板类文本资源
```

- `skills.body` = `SKILL.md` 去除 frontmatter 的正文（语义不变）；frontmatter 各字段持久化到 `skills` 行（新增 `triggers` 列；`version`、`always` 见开放问题）。
- `skill_files` 存附属文件（相对路径 + 文本内容）；`SKILL.md` 本身不入 `skill_files`，避免双写。
- `scanner.ts` 升级为双模式：目录包（子目录含 `SKILL.md`，递归收集 references/assets 文本文件，跳过 `scripts/` 与二进制）+ 旧平铺 `*.md`（行为不变，不产生附属文件）。
- `sync.ts` 对附属文件做与主文件相同的 create/update/delete diff（哈希对比）。

### 支柱二：创建交互重排

| 入口 | 优先级 | 说明 |
|------|--------|------|
| 导入 ZIP | 主（P1） | `POST /api/skills/import`（multipart），服务端解压、定位 `SKILL.md`、解析 frontmatter、校验限额后落库；兼容"ZIP 内单个 .md"旧形态 |
| 让 AI 生成 | 主（P2） | 复用现有 agent loop：预设系统提示模板（产出符合目录包格式的 `SKILL.md` 草稿）+ 用户描述 → 预览 → 保存。chat-first 产品的天然优势，CLI 工具做不到的体验 |
| 编辑 | 补齐（P1） | 复用 `SkillFormModal` 扩展编辑模式（`PATCH /api/skills/:id` 已存在，纯前端工作）；directory 来源保持只读 |
| 手写 / 粘贴 | 高级选项（保留） | 现有弹窗不删除，降级为第三入口 |
| GitHub URL 导入 | P2 | `POST /api/skills/import/github`，拉取仓库中指定 skill 目录 |
| 模板 | P2 | 2-3 个内置示例（如"代码评审"、"写作风格"） |

详情视图增加附属文件列表与预览（只读，编辑逐文件进行）。

### 支柱三：作用域 = agent 绑定 + 渐进披露

- **有效 skill 集 = `agent_skills` 绑定 ∩ 全局 `enabled`**（无 agent 绑定时 = 全部 enabled，向后兼容），与工具有效集（`agent_tools` ∩ 全局启用）完全同构。
- **清单注入**（assembler 改造）：

  ```
  The following skills are available. To use one, read its full
  instructions with the read_skill tool before following them.

  - name: code-review
    description: 逐文件评审代码并输出结构化报告
    triggers: 评审, code review, review
  ```

  常驻成本每 skill 约两三行，替代现状的全文注入。
- **新增内置工具 `read_skill`**（`tools/registry.ts`，`safe` 级）：
  - 入参：`{ name: string, path?: string }`——无 `path` 返回 `SKILL.md` 正文，有 `path` 返回指定附属文件内容。
  - 只能读取当前会话有效 skill 集内的条目，越权返回明确错误（不泄露正文）。
  - 输出截断复用 context-management-v2 工具输出降级链（`TOOL_OUTPUT_MAX_CHARS`）。
- **全文注入例外**：frontmatter `always: true` 的 skill 绕过清单、直接全文注入（对应 Cursor 的 Always 规则类型），供短小的 persona/风格类 skill 使用（字段命名见开放问题 1）。

## 数据模型与迁移

### 新表 `skill_files`

```sql
CREATE TABLE skill_files (
  id TEXT PRIMARY KEY,
  skill_id TEXT NOT NULL,
  path TEXT NOT NULL,            -- 相对路径，如 'references/api.md'
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE,
  UNIQUE (skill_id, path)
);
```

### `skills` 加列

```sql
ALTER TABLE skills ADD COLUMN triggers TEXT NOT NULL DEFAULT '[]';  -- JSON string[]
```

### 迁移编号

现有迁移为 `0001`–`0004`（`0004_memories.sql`）。diy-agent 设计文档中的"`0004_diy_agents.sql`"编号已过时，实际落地时与本次 skill 迁移按落地顺序顺延（如 diy-agents 先行则占 `0005`、本设计占 `0006`），以实施时最新序号为准。

### Shared 类型变更（`packages/shared/src/skill.ts`）

- `SkillFrontmatter`：增加 `always?: boolean`（解析层）
- `SkillMeta`：增加 `triggers?: string[]`、`fileCount?: number`
- `SkillDetail`：增加 `files?: SkillFileMeta[]`（`{ path, size }`；内容按需经 `GET /api/skills/:id/files/:path` 获取）
- `CreateSkillParams`：增加 `files?: { path: string; content: string }[]`
- `SkillSource`：枚举不变（`'directory' | 'upload'`）

## 后端行为

| 位置 | 改动 |
|---|---|
| `streaming/lifecycle.ts` + `jobs/worker.ts` | **P0：补齐 skills 注入链路**——调用 assembler 时传入有效 skill 集（无 agent 时 = `listEnabledSkills()`；有 agent 时按 `agent_skills` 过滤） |
| `prompt/assembler.ts` | skills 注入从"全文拼接"改为"清单 + read_skill 指引"；`always: true` 的 skill 保留全文注入块；注入顺序与缓存稳定性遵循 context-management-v2 §3（按 `createdAt` 排序） |
| `tools/registry.ts` | 注册 `read_skill`（`safe` 级），executor 校验有效集 |
| `skills/scanner.ts` | 双模式扫描（目录包 + 平铺）；跳过 `scripts/`、二进制、超限文件 |
| `skills/sync.ts` | 附属文件 diff 同步；`SyncResult` 增加 `filesCreated/filesUpdated/filesDeleted/skippedOversized` 计数 |
| `skills/parser.ts` | 解析并返回 `triggers` / `always`（`version` 暂存元数据不参与行为） |
| `repo/skill.ts` | `skill_files` CRUD；`createSkill`/`updateSkill` 接受 `files` 全量替换；`triggers` 读写 |
| `routes/skills.ts` | 新增 `POST /import`（multipart ZIP）、`GET /:id/files/:path`（路径穿越校验）；`POST /rescan` 行为不变 |
| `routes/skills.ts`（P2） | `POST /import/github` |

## 前端设计

| 组件 | 内容 |
|---|---|
| `SkillsPage` | 创建入口改为三选（导入 ZIP / 让 AI 生成(P2) / 手写高级）；行内增加"编辑"按钮；展示附属文件计数徽标 |
| `SkillFormModal` | 扩展编辑模式（回填、保存调 `PATCH`）；directory 来源保持只读提示 |
| `SkillDetailDrawer`（新） | 附属文件列表 + 内容预览（`GET /:id/files/:path`） |
| AI 生成入口（P2） | 跳转到一个预置模板会话，产出草稿后经预览组件保存 |
| `AgentManager` 绑定器 | 由 diy-agent 设计覆盖（`agent_skills` 多选），本设计不重复 |

## 错误处理

| 场景 | 行为 |
|---|---|
| ZIP 中无 `SKILL.md` / frontmatter 缺 `name` | 400，指明缺失项 |
| 附属文件超限（>256 KB / >20 个 / 总 >1 MB） | 导入：400 列出超限项；目录同步：跳过 + warn + 计数 |
| `read_skill` 访问未绑定 / 未启用 skill | 返回明确错误信息（该 skill 不在当前会话可用集内），不泄露正文 |
| `GET /:id/files/:path` 路径穿越（`..`、绝对路径） | 400 |
| 附属文件被磁盘删除后 rescan | 对应 `skill_files` 行删除 |
| frontmatter `always` 值非法 | 回退 `false` + warn |
| `triggers` 非数组 | 解析为空数组（现有 parser 容错行为不变） |

## 测试策略

**server（Vitest / node）**
- `scanner`：目录包识别、平铺兼容、`scripts/` 与二进制跳过、超限跳过
- `parser`：`triggers` / `always` 解析与容错
- `sync`：附属文件 create/update/delete diff、计数正确性
- `repo/skill`：`skill_files` 全量替换语义、级联删除
- `routes`：ZIP 导入（合法 / 缺 SKILL.md / 超限）、files 路径穿越校验
- `read_skill`：有效集过滤（绑定 ∩ 启用）、输出截断、错误信息
- `assembler`：清单格式、`always` 全文例外、排序稳定性
- **P0 集成测试**：lifecycle / worker 传参后，skills 内容出现在一次真实对话的 prompt 中

**web（Vitest / jsdom）**
- `SkillFormModal` 编辑模式回填与校验
- `SkillsPage` 三入口渲染与权限（directory 只读）

**手动验收**
- 导入一个 Claude Code 生态 skill 仓库的 ZIP → 绑定到 agent → 会话中模型经 `read_skill` 读取正文与 references 完成任务

## 迁移与兼容

- 单文件 skill 零迁移：无附属文件即现状，`triggers` 默认 `'[]'`。
- `SKILLS_DIR` 平铺目录继续工作；目录包为增量识别。
- 注入策略从全文改为清单是一次可感知的行为变化——P2 落地前在发布说明中标注；`always: true` 为存量短 skill 提供逃生门。
- 插件 RFC（`plugin-manifest-lifecycle.md`）的 `provides.skills` 规格需同步升级为目录包（P3，见下），清单 schema 的 `path` 约束从 `skills/*.md` 扩展为 `skills/**`。

## 分阶段路线

| 阶段 | 内容 | 依赖 |
|---|---|---|
| **P0（立即）** | lifecycle / worker 补齐 skills 传参，现有功能先真正生效 | 无（diy-agent 设计已计划顺带修，先行者交付） |
| **P1** | `skill_files` 表 + scanner 双模式 + triggers 持久化 + 编辑 UI + ZIP 导入 + `agent_skills` 绑定生效 | 建议与 DIY agent 同期（一次迁移、一套绑定过滤） |
| **P2** | 渐进披露（清单注入 + `read_skill` + `always`）+ GitHub URL 导入 + AI 生成入口 + 模板 | P1 的目录包模型 |
| **P3** | 插件 RFC `provides.skills` 升级为目录包，沿用 `pluginId:resourceName` 命名空间 | 插件系统实施 |

## 开放问题

1. **全文注入标记的字段命名**：`always: true`（仿 Cursor）还是 `inject: always`？是否同时提供 UI 开关（而非仅 frontmatter）？
2. **`version` 字段的用途**：仅展示，还是参与目录同步的更新提示（本地已改、上游有新版本）？
3. **AI 生成 skill 的交互形态**：独立入口（设置页按钮 → 模板会话）还是对话中 `@生成skill` 触发？v1 建议前者。
4. **导入来源的可见性**：`source` 保持两值、以导入时间戳区分，是否满足"从哪来"的展示需求？
5. **GitHub 导入的安全边界**：拉取任意仓库 URL 的 SSRF / 内容注入风险面——按"可信用户"威胁模型记录即可，还是加域名白名单配置？
6. **多语言清单**：注入清单中的 name/description 保持原文（skill 作者语言），还是允许用户侧覆盖翻译？（建议 v1 原文）

## 未来演进

- **workspace 实体**：真实多项目需求出现时（如按代码仓库组织对话），`skills` 加 `workspace_id` 列、`agent_skills` 语义不变即可平滑演进，现在不预付成本。
- **skill script**：若未来支持，路径是将脚本注册为受三级安全体系管控的 Tool（带 safe/restricted/danger 定级与审批流），而非 skill 私有执行能力。
- **分发**：由插件系统 RFC（T4/T5/T6）承接，目录包是其 `provides.skills` 的自然载荷。

## 参考文献

- [Claude Code Skills 文档](https://code.claude.com/docs/en/skills)
- [Anthropic Agent Skills 概览（渐进披露三级模型）](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview)
- [anthropics/skills 官方仓库（目录包布局）](https://github.com/anthropics/skills)
- [Cursor Rules 文档（四象限激活类型）](https://cursor.com/docs/rules)
- `docs/2026-08-15-diy-agent-design.md`（agent_skills 白名单语义、P0 缺口记录、模型/工具同构关系）
- `docs/rfc/plugin-manifest-lifecycle.md`（provides.skills 规格升级对象）
- `docs/rfc/context-management-v2.md`（system 桶预算、工具输出降级链、缓存稳定性约束）
