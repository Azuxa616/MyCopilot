# 附件资产层与多模态消息（图片上传）实施计划

> **执行记录（2026-09-30，分支 `attachment-assets-multimodal`）：** 计划 Task 1-11 已执行完毕（Task 11.2 手动 E2E 留待用户以真实 vision 模型验证）。与原文的偏差：
> - **shared types-only 约束**：`projectPartsToText` 移至 server `attachment/projection.ts`（shared 的 AGENTS.md 禁止运行时函数）；`SendMessageParams` 预占 `assetIds?` 字段（计划 D 契约）
> - **pdf-parse v2**：实际安装 2.4.5 为 class API（`new PDFParse({data}).getText()`），计划假设的 v1 函数式作废；测试用 `__controls` 静态句柄 mock（注意 vi.mock factory 内本地类名不得与模块级 import 同名，否则 TDZ）
> - **路由形态**：路由文件用相对路径（`/`、`/:id/meta`）挂载于 `app.route('/api/assets', assetsApp)`，计划代码块的绝对路径写法作废；响应包络为 `{code, msg, data}`
> - **新增列表端点** `GET /api/assets?name=&limit=`（输入命令计划发现的缺口，已回填本计划 Task 5）
> - **useAssetUrl hook**（计划未预见）：`/api/assets/:id/raw` 受 tokenAuth 保护，`<img src>` 无法带 Authorization——新增 `common/hooks/useAssetUrl.ts`（fetchWithAuth → blob → objectURL，id 配对防陈旧外泄）；eslint react-hooks 新规禁止 effect 内同步 setState，已合规
> - **vitest 环境事实**：`svg?react` 在测试环境解析为 data URL 字符串（非组件），渲染 MessageCard 须 mock 全部叶子（MarkdownRenderer/Avatar/MessageActions/AgentTimeline/icon 资产），且 vi.mock 路径相对**测试文件**；vitest 未开 globals → RTL 需手动 cleanup
> - **迁移计数测试**：runner.test 的 7→8（0008 加入）
> - **既有 bug 备案**：web `updateModel`/`deleteModel` 走扁平 `PATCH|DELETE /api/models/:id`，服务端仅挂载 provider 作用域路径（能力探测计划已备案，另行修复）
> - 全量验证：typecheck ✓ / server 874 tests ✓ / web 212 tests ✓ / lint 0 error（1 既有 warning：PluginCardHost exhaustive-deps，非本任务）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 附件升级为文件系统持久化资产（`assets` 表 + `DATA_DIR/attachments/`），消息支持 content parts 数组化（方案 B），图片经 OpenAI 兼容 `image_url` block 端到端发给模型，历史图片按 `detail` 分级降级。

**Architecture:** 资产先上传（`POST /api/assets` multipart → 落盘 + 元数据入库），发送消息改为 JSON（`{content, assetIds?}`），服务端把文本类资产解析为既有 `AttachmentText` 注入、图片类资产解析为 `MessagePart` 存入 `messages.parts`；`content` 永远维护为 parts 的纯文本投影（`[图片: name]` 占位）。多模态出口收敛在 assembler（当前轮 parts 参数 + 历史 parts 的 detail 策略），adapter 只做哑序列化（`ChatMessage.images` 已是解析后的 data URL）。

**Tech Stack:** Hono 4 + better-sqlite3（server）、pdf-parse（新增，server）、React 19 + Zustand（web）、Vitest（双环境）、`@my-copilot/shared` 类型。

**规格来源:** `docs/2026-09-30-attachment-assets-multimodal-design.md`（已获用户批准，全量范围）

**关键设计决策（已锁定，源自设计文档决策记录）:**
- 存储：文件系统 `DATA_DIR/attachments/<assetId>`，DB 只存元数据；存量消息不迁移（excerpt-only 原样保留）
- 方案 B：`messages.parts` 可选 JSON 列；读侧"parts 优先、content 投影兜底"——除渲染层外所有消费方继续读投影，零改造
- 图片编码：base64 `data:` URL 内联进 `image_url` block；`image` part 仅允许 user 角色（发送前校验）
- 历史图片策略：当轮 `detail` 原值；最近 N=5 个 user 轮内降 `low`；超出仅保留投影占位（不发字节）
- 能力门控：本计划独立可交付——Sender 侧图片入口默认按 `unknown` 处理（允许上传）；能力探测计划（`2026-09-30-model-capability-plan.md`）落地后接入门控 hook

**跨计划协调（重要）:**
- **迁移编号**：本计划使用 `0008_assets_and_parts.sql`（当前磁盘最新为 0007）。若执行时 0008 已被占用，改取下一可用编号，内容不变（house 先例见 2026-08-22 计划头部）。
- **发送 API JSON 化是计划 D（input-commands）的前置**：D 在本计划切换后的 JSON body 上追加 `enforcedSkillIds` / `referencedSessionIds`。本计划保留 multipart files 兼容分支一个版本周期。
- **能力学习闭环（计划 B）依赖本计划的图片出站链路**（`currentUserParts` → `ChatMessage.images`）；本计划在 runner 出口预留"本次请求是否含图片"的判定函数。

**新依赖说明（项目规则要求）:** `pdf-parse`（server）——基于 pdf.js 的纯文本提取薄封装，API 简单（`pdf(buffer)` → text），无传递依赖地狱；备选 `pdfjs-dist` 服务端直接用（API 偏浏览器场景、需自管 worker 配置，对"只提文本"过重），备选 `mammoth` 不支持 PDF。注意：pdf-parse 自带极简 d.ts，若类型缺失用 `declare module 'pdf-parse'` 兜底（仅此一处允许）。

**命令约定（均在仓库根 `F:\MyProjects\MyCopilot` 执行）:**
- 定向测试：`pnpm --filter server exec vitest run <路径>` / `pnpm --filter web exec vitest run <路径>`
- 全量验证：`pnpm typecheck && pnpm --filter server test && pnpm --filter web test && pnpm lint`
- 每个 Task 完成且定向测试通过后提交一次（conventional commit）；若所在会话约定不自动提交，跳过 commit 步骤

---

### Task 1: Shared 类型扩展（跨计划契约，最先落地）

**Files:**
- Create: `packages/shared/src/attachment.ts`
- Modify: `packages/shared/src/session.ts`
- Modify: `packages/shared/src/index.ts`（如存在 barrel 导出；否则核实导出方式）
- Test: `packages/shared/src/__tests__/attachment.test.ts`

- [ ] **Step 1.1: 写失败测试**

```ts
// packages/shared/src/__tests__/attachment.test.ts
import { describe, it, expect } from 'vitest';
import type { Asset, AssetKind, MessagePart } from '../attachment';

describe('attachment shared types', () => {
  it('AssetKind 覆盖设计枚举', () => {
    const kinds: AssetKind[] = ['text', 'markdown', 'csv', 'docx', 'pdf', 'image', 'code'];
    expect(kinds).toHaveLength(7);
  });
  it('MessagePart image 形状（assetId + 可选 detail）', () => {
    const part: MessagePart = { type: 'image', assetId: 'a1', detail: 'low' };
    expect(part.type).toBe('image');
  });
  it('Asset 形状', () => {
    const a: Asset = {
      id: 'a1', name: 'x.png', mimeType: 'image/png', size: 1,
      kind: 'image', sha256: 'h', source: 'upload', createdAt: 1, updatedAt: 1,
    };
    expect(a.kind).toBe('image');
  });
});
```

- [ ] **Step 1.2: 运行确认失败**

Run: `pnpm --filter @my-copilot/shared exec vitest run src/__tests__/attachment.test.ts`
Expected: FAIL（无法解析 `../attachment`）

- [ ] **Step 1.3: 实现 `packages/shared/src/attachment.ts`（全量新建）**

```ts
/** 资产种类，对齐 context-management-v2 RFC 的 AttachmentKind（audio 预留）。 */
export type AssetKind = 'text' | 'markdown' | 'csv' | 'docx' | 'pdf' | 'image' | 'code';

export type AssetSource = 'upload' | 'agent' | 'plugin';

/** 持久化附件资产（原始字节在 DATA_DIR/attachments/<id>，元数据在 assets 表）。 */
export interface Asset {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  kind: AssetKind;
  sha256: string;
  source: AssetSource;
  createdAt: number;
  updatedAt: number;
}

export type ImageDetail = 'low' | 'high' | 'original' | 'auto';

/** 多模态消息内容块。content 永远维护为 parts 的纯文本投影。 */
export type MessagePart =
  | { type: 'text'; text: string }
  | { type: 'image'; assetId: string; detail?: ImageDetail };

/** Wire 层已解析图片（data URL），由 assembler 产出、adapter 消费。 */
export interface WireImagePart {
  url: string;
  detail?: ImageDetail;
}

/** parts → 纯文本投影（图片/未知块替换为占位符）。 */
export function projectPartsToText(parts: MessagePart[], nameOf: (assetId: string) => string): string {
  return parts
    .map((p) => (p.type === 'text' ? p.text : `[图片: ${nameOf(p.assetId)}]`))
    .join('\n');
}
```

- [ ] **Step 1.4: 扩展 `packages/shared/src/session.ts`**

`AttachmentMeta` 增加可选 `assetId?: string;`（旧数据无此字段，语义不变）；`Message` 增加可选 `parts?: MessagePart[];`（顶部 `import type { MessagePart } from './attachment.js'`，注意项目 `verbatimModuleSyntax`）。在 shared 的导出入口把 `attachment.ts` 一并导出（核实 `index.ts` 现有导出方式后同构添加）。

- [ ] **Step 1.5: 运行测试通过**

Run: `pnpm --filter @my-copilot/shared exec vitest run src/__tests__/attachment.test.ts && pnpm --filter @my-copilot/shared exec tsc --noEmit`
Expected: PASS / 无类型错误

- [ ] **Step 1.6: Commit**

```bash
git add packages/shared/src/attachment.ts packages/shared/src/__tests__/attachment.test.ts packages/shared/src/session.ts
git commit -m "feat(shared): asset & multimodal message part types"
```

---

### Task 2: 迁移 0008 + repo/asset.ts

**Files:**
- Create: `apps/server/src/migration/sql/0008_assets_and_parts.sql`
- Create: `apps/server/src/repo/asset.ts`
- Test: `apps/server/src/repo/__tests__/asset.test.ts`

- [ ] **Step 2.1: 迁移文件（编号竞态见头部协调）**

```sql
-- 资产层 + 多模态 parts（设计：docs/2026-09-30-attachment-assets-multimodal-design.md）
CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  kind TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'upload',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

ALTER TABLE messages ADD COLUMN parts TEXT;
```

核实 `migration/runner.ts` 的注册方式（文件名扫描或显式清单），按其约定接入。执行后用 server 启动或 runner 单测确认两列生效。

- [ ] **Step 2.2: 写失败测试（repo CRUD，参照 `repo/__tests__/plugin.test.ts` 的 db 测试基建）**

```ts
// apps/server/src/repo/__tests__/asset.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
// 按 plugin.test.ts 现有方式初始化测试 db（内存或临时文件），下述伪导入按实际调整
import { createAsset, getAsset } from '../asset';
import type { Asset } from '@my-copilot/shared';

describe('repo/asset', () => {
  it('create + get 往返', () => {
    const a = createAsset({ name: 'a.png', mimeType: 'image/png', size: 3, kind: 'image', sha256: 'h' });
    expect(a.id).toBeTruthy();
    const got = getAsset(a.id);
    expect(got?.kind).toBe('image');
    expect(got?.source).toBe('upload');
  });
  it('get 不存在返回 undefined', () => {
    expect(getAsset('nope')).toBeUndefined();
  });
});
```

Run 确认 FAIL（模块不存在）。

- [ ] **Step 2.3: 实现 `repo/asset.ts`**

```ts
import type { Asset, AssetKind, AssetSource } from '@my-copilot/shared';
import { getDb } from '../db/index.js';
import { generateId, now } from './base.js';

interface AssetRow {
  id: string; name: string; mime_type: string; size: number;
  kind: string; sha256: string; source: string; created_at: number; updated_at: number;
}

function rowToAsset(row: AssetRow): Asset {
  return {
    id: row.id, name: row.name, mimeType: row.mime_type, size: row.size,
    kind: row.kind as AssetKind, sha256: row.sha256, source: row.source as AssetSource,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export function createAsset(params: {
  name: string; mimeType: string; size: number; kind: AssetKind; sha256: string;
  source?: AssetSource;
}): Asset {
  const db = getDb();
  const id = generateId();
  const ts = now();
  db.prepare(
    `INSERT INTO assets (id, name, mime_type, size, kind, sha256, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, params.name, params.mimeType, params.size, params.kind, params.sha256,
        params.source ?? 'upload', ts, ts);
  return { id, ...params, source: params.source ?? 'upload', createdAt: ts, updatedAt: ts };
}

export function getAsset(id: string): Asset | undefined {
  const row = getDb().prepare('SELECT * FROM assets WHERE id = ?').get(id) as AssetRow | undefined;
  return row ? rowToAsset(row) : undefined;
}

/** 最近资产列表（@file 引用与资产库的候选源，按创建时间倒序）。 */
export function listRecentAssets(limit = 50): Asset[] {
  const rows = getDb().prepare('SELECT * FROM assets ORDER BY created_at DESC LIMIT ?')
    .all(limit) as AssetRow[];
  return rows.map(rowToAsset);
}
```

- [ ] **Step 2.4: 测试通过 + Commit**

Run: `pnpm --filter server exec vitest run src/repo/__tests__/asset.test.ts`
Expected: PASS

```bash
git add apps/server/src/migration/sql/0008_assets_and_parts.sql apps/server/src/repo/asset.ts apps/server/src/repo/__tests__/asset.test.ts
git commit -m "feat(server): assets table, migration 0008 and asset repo"
```

---

### Task 3: 存储层 attachment/storage.ts + kind 判定

**Files:**
- Create: `apps/server/src/attachment/storage.ts`
- Create: `apps/server/src/attachment/kind.ts`
- Test: `apps/server/src/attachment/__tests__/kind.test.ts`

- [ ] **Step 3.1: 写失败测试（魔数判定）**

```ts
// apps/server/src/attachment/__tests__/kind.test.ts
import { describe, it, expect } from 'vitest';
import { detectImageMime, detectKind } from '../kind';

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const gif = Buffer.from([0x47, 0x49, 0x46, 0x38]);
const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')]);

describe('kind detection', () => {
  it('图片魔数', () => {
    expect(detectImageMime(jpeg)).toBe('image/jpeg');
    expect(detectImageMime(png)).toBe('image/png');
    expect(detectImageMime(gif)).toBe('image/gif');
    expect(detectImageMime(webp)).toBe('image/webp');
    expect(detectImageMime(Buffer.from('hello'))).toBeUndefined();
  });
  it('detectKind 按内容优先、扩展名兜底', () => {
    expect(detectKind('a.png', '', png)).toBe('image');
    expect(detectKind('a.md', 'text/markdown', Buffer.from('# t'))).toBe('markdown');
    expect(detectKind('a.docx', '', Buffer.from([0x50, 0x4b]))).toBe('docx');
    expect(detectKind('a.pdf', '', Buffer.from('%PDF-1.7'))).toBe('pdf');
  });
});
```

- [ ] **Step 3.2: 实现 `attachment/kind.ts`**

```ts
import type { AssetKind } from '@my-copilot/shared';
import { extname } from 'node:path';

/** 按魔数判定图片类型（内容优先于文件名/声明 mime——对齐 DeepSeek 行为说明）。 */
export function detectImageMime(buf: Buffer): string | undefined {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.length >= 4 && buf.subarray(0, 3).toString('ascii') === 'GIF') return 'image/gif';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return undefined;
}

const EXT_KIND: Record<string, AssetKind> = {
  '.md': 'markdown', '.markdown': 'markdown', '.txt': 'text', '.csv': 'csv',
  '.docx': 'docx', '.pdf': 'pdf', '.json': 'code', '.ts': 'code', '.tsx': 'code',
  '.js': 'code', '.mjs': 'code', '.py': 'code', '.rs': 'code', '.go': 'code',
};

/** 内容魔数优先（图片/PDF/DOCX zip 头），扩展名兜底。 */
export function detectKind(name: string, declaredMime: string, data: Buffer): AssetKind {
  const img = detectImageMime(data);
  if (img) return 'image';
  if (data.subarray(0, 5).toString('ascii') === '%PDF-') return 'pdf';
  if (data.subarray(0, 2).toString('ascii') === 'PK' && extname(name).toLowerCase() === '.docx') return 'docx';
  if (declaredMime.startsWith('text/') || declaredMime === 'application/json') {
    const byExt = EXT_KIND[extname(name).toLowerCase()];
    if (byExt) return byExt;
    return 'text';
  }
  return EXT_KIND[extname(name).toLowerCase()] ?? 'text';
}
```

- [ ] **Step 3.3: 实现 `attachment/storage.ts`**

```ts
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

/** DATA_DIR 解析（对齐 db/index.ts 的 DATA_DIR 约定；核实后如已有工具函数则复用）。 */
export function attachmentsDir(): string {
  const dataDir = process.env.DATA_DIR?.trim() || './data';
  return resolve(dataDir, 'attachments');
}

export async function writeAssetFile(id: string, data: Buffer): Promise<void> {
  const dir = attachmentsDir();
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, id), data);
}

export async function readAssetFile(id: string): Promise<Buffer> {
  return readFile(join(attachmentsDir(), id));
}
```

- [ ] **Step 3.4: 测试通过 + Commit**

Run: `pnpm --filter server exec vitest run src/attachment/__tests__/kind.test.ts`
Expected: PASS

```bash
git add apps/server/src/attachment/kind.ts apps/server/src/attachment/storage.ts apps/server/src/attachment/__tests__/kind.test.ts
git commit -m "feat(server): asset storage layer and content-based kind detection"
```

---

### Task 4: parser 升级（资产化 + pdf-parse + 图片元信息）

**Files:**
- Modify: `apps/server/src/attachment/parser.ts`
- Test: `apps/server/src/attachment/__tests__/parser.test.ts`（扩展既有文件）

- [ ] **Step 4.1: 扩展测试**

```ts
// 追加到 parser.test.ts（沿用现有 describe/import 风格）
it('图片：成功但无文本', async () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(8)]);
  const r = await parseAttachment({ name: 'a.png', type: 'image/png', data: png });
  expect(r.success).toBe(true);
  expect(r.text).toBeUndefined();
  expect(r.meta?.type).toBe('image/png');
});

it('pdf：提取文本', async () => {
  // 构造最小 PDF 的 fixture 见下；断言 success 且 text 为 string
});
```

PDF fixture：测试目录放一个几字节的合法 PDF（可用现有任意测试资源，或运行时用 `pdf-parse` 仓库示例字节）；若构造困难，改用集成层手动验证并在单测中 mock `pdf-parse`（`vi.mock('pdf-parse', ...)`）只测分支路由。

- [ ] **Step 4.2: 实现升级**

`parseAttachment` 保持签名与 fail-soft 语义，内部改为：

```ts
import { detectKind, detectImageMime } from './kind.js';
// 顶部新增 import pdfParse from 'pdf-parse'（类型缺失时仅此处 declare module 兜底）

// TEXT_EXTENSIONS 分支之前插入：
const imgMime = detectImageMime(file.data);
if (imgMime) {
  const meta: AttachmentMeta = { name: file.name, type: imgMime, size: file.data.length };
  return { success: true, meta };            // 图片无 text
}
if (ext === '.pdf') {
  const text = (await pdfParse(file.data)).text;
  const meta: AttachmentMeta = { name: file.name, type: file.type || 'application/pdf', size: file.data.length, textExcerpt: text.slice(0, MAX_EXCERPT) };
  return { success: true, meta, text };
}
// 原 .md/.txt/.csv 与 .docx 分支保持不变（detectKind 未启用前兜底路径不变）
```

- [ ] **Step 4.3: 测试通过 + Commit**

Run: `pnpm --filter server exec vitest run src/attachment`
Expected: PASS（含既有用例零回归）

```bash
git add apps/server/src/attachment/parser.ts apps/server/src/attachment/__tests__/parser.test.ts apps/server/package.json pnpm-lock.yaml
git commit -m "feat(server): parse image and pdf attachments via content detection"
```

---

### Task 5: 资产路由 routes/assets.ts

**Files:**
- Create: `apps/server/src/routes/assets.ts`
- Modify: `apps/server/src/index.ts`（路由注册点，核实现有 `route()` 注册方式后同构添加）
- Test: `apps/server/src/routes/__tests__/assets.test.ts`

- [ ] **Step 5.1: 写失败测试（参照 `routes/__tests__/messages.test.ts` 的 app 测试基建）**

```ts
// apps/server/src/routes/__tests__/assets.test.ts
// 沿用 messages.test.ts 的 app 构造 + auth 头方式
describe('POST /api/assets', () => {
  it('上传图片 → 201 + Asset', async () => {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0])], { type: 'image/png' }), 'a.png');
    const res = await app.request('/api/assets', { method: 'POST', headers: auth(form), body: form });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.kind).toBe('image');
  });
  it('超限拒绝（复用 MAX_ATTACHMENT_SIZE_MB 逻辑）', async () => { /* 断言 413 */ });
});
describe('GET /api/assets/:id/raw', () => {
  it('返回原始字节与 Content-Type', async () => { /* 上传后取 raw，断言 200 + image/png */ });
});
describe('GET /api/assets（列表，@file 候选源）', () => {
  it('name 子串过滤 + limit 封顶', async () => { /* 上传两个资产后 GET /api/assets?name=a，断言只含匹配项 */ });
});
```

- [ ] **Step 5.2: 实现路由**

```ts
import { Hono } from 'hono';
import { createHash } from 'node:crypto';
import type { Asset } from '@my-copilot/shared';
import { createAsset, getAsset, listRecentAssets } from '../repo/asset.js';
import { writeAssetFile, readAssetFile } from '../attachment/storage.js';
import { detectKind } from '../attachment/kind.js';

export const assetsRoute = new Hono();

/** 上传即资产化：校验 → 落盘 → 元数据入库。 */
assetsRoute.post('/api/assets', async (c) => {
  const form = await c.req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) return c.json({ msg: '缺少 file 字段' }, 400);
  const maxBytes = (Number(process.env.MAX_ATTACHMENT_SIZE_MB) || 10) * 1024 * 1024;
  if (file.size > maxBytes) return c.json({ msg: `文件超过 ${maxBytes / 1024 / 1024} MB 上限` }, 413);
  const data = Buffer.from(await file.arrayBuffer());
  const kind = detectKind(file.name, file.type, data);
  const asset = createAsset({
    name: file.name,
    mimeType: file.type || 'application/octet-stream',
    size: data.length,
    kind,
    sha256: createHash('sha256').update(data).digest('hex'),
  });
  await writeAssetFile(asset.id, data);
  return c.json({ data: asset }, 201);
});

/** 资产列表（@file 引用选择器与资产库的候选源；name 为可选的文件名子串过滤）。 */
assetsRoute.get('/api/assets', (c) => {
  const name = c.req.query('name')?.trim().toLowerCase();
  const limit = Math.min(Number(c.req.query('limit')) || 50, 200);
  const all = listRecentAssets(limit);
  const data = name ? all.filter((a) => a.name.toLowerCase().includes(name)) : all;
  return c.json({ data });
});

assetsRoute.get('/api/assets/:id/meta', (c) => {
  const asset = getAsset(c.req.param('id'));
  return asset ? c.json({ data: asset }) : c.json({ msg: '资产不存在' }, 404);
});

assetsRoute.get('/api/assets/:id/raw', async (c) => {
  const asset = getAsset(c.req.param('id'));
  if (!asset) return c.json({ msg: '资产不存在' }, 404);
  const buf = await readAssetFile(asset.id);
  return new Response(new Uint8Array(buf), {
    headers: { 'Content-Type': asset.mimeType, 'Cache-Control': 'private, max-age=31536000, immutable' },
  });
});
```

在 `index.ts` 按现有路由注册方式挂载（`/api/assets` 前缀走既有 auth 中间件路径，核实后同构）。

- [ ] **Step 5.3: 测试通过 + Commit**

Run: `pnpm --filter server exec vitest run src/routes/__tests__/assets.test.ts`
Expected: PASS

```bash
git add apps/server/src/routes/assets.ts apps/server/src/routes/__tests__/assets.test.ts apps/server/src/index.ts
git commit -m "feat(server): asset upload/meta/raw routes"
```

---

### Task 6: Wire 层——ChatMessage.images 与双 adapter 序列化

**Files:**
- Modify: `apps/server/src/llm/base.ts`（`ChatMessage` 增加可选 `images?: WireImagePart[]`，import 自 shared）
- Modify: `apps/server/src/llm/openai.ts`
- Modify: `apps/server/src/llm/ollama.ts`
- Test: `apps/server/src/llm/__tests__/openai.test.ts`、`ollama.test.ts`（扩展既有文件，mock fetch 按 test 现状对齐）

- [ ] **Step 6.1: 扩展测试**

```ts
// openai.test.ts 追加：携带 images 的消息序列化为 content blocks
it('images → OpenAI content blocks', async () => {
  const messages = [{
    role: 'user' as const, content: '看图',
    images: [{ url: 'data:image/png;base64,AAA', detail: 'low' as const }],
  }];
  // 按 openai.test.ts 现有 mock fetch 方式捕获请求体后：
  const body = capturedRequestBody;
  const userMsg = body.messages.find((m: any) => m.role === 'user');
  expect(Array.isArray(userMsg.content)).toBe(true);
  expect(userMsg.content[0]).toEqual({ type: 'text', text: '看图' });
  expect(userMsg.content[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/png;base64,AAA', detail: 'low' } });
});
```

ollama.test.ts 同理断言 `message.images = ['AAA']`（data URL 的 base64 段）。

- [ ] **Step 6.2: 实现**

`openai.ts` 请求体组装处（找到现有 messages 映射）：

```ts
const wireMessages = messages.map((m) => {
  if (m.images && m.images.length > 0 && m.role === 'user' && typeof m.content === 'string') {
    return {
      ...m,
      content: [
        { type: 'text', text: m.content },
        ...m.images.map((img) => ({ type: 'image_url', image_url: { url: img.url, detail: img.detail } })),
      ],
    };
  }
  return m;
});
```

`ollama.ts`（`/api/chat` 的 message 映射处）：`images` 存在时附加 `images: m.images.map((i) => i.url.replace(/^data:[^,]+,/, ''))`（Ollama 收 base64 数组）。

- [ ] **Step 6.3: 测试通过 + Commit**

Run: `pnpm --filter server exec vitest run src/llm`
Expected: PASS（含既有用例零回归——无 images 时请求体逐字节不变）

```bash
git add apps/server/src/llm/base.ts apps/server/src/llm/openai.ts apps/server/src/llm/ollama.ts apps/server/src/llm/__tests__/openai.test.ts apps/server/src/llm/__tests__/ollama.test.ts
git commit -m "feat(server): multimodal wire format for openai/ollama adapters"
```

---

### Task 7: 出口组装——assembler 图片解析与 detail 策略

**Files:**
- Create: `apps/server/src/attachment/resolve.ts`
- Modify: `apps/server/src/prompt/assembler.ts`（`AssembleV2Params` + `assembleMessagesV2`）
- Test: `apps/server/src/attachment/__tests__/resolve.test.ts`、`apps/server/src/prompt/__tests__/assembler-v2.test.ts`（扩展）

- [ ] **Step 7.1: 写失败测试（策略核心）**

```ts
// resolve.test.ts —— resolveImageParts 为纯策略 + 注入式读取器，可全量单测
import { describe, it, expect } from 'vitest';
import { applyImagePolicy } from '../resolve';

const mk = (assetId: string) => ({ type: 'image' as const, assetId });

describe('历史图片 detail 策略', () => {
  const parts = [mk('a'), mk('b')];
  it('当轮：原样', () => {
    expect(applyImagePolicy(parts, 0)).toEqual(parts);
  });
  it('N 轮内：强制 low', () => {
    expect(applyImagePolicy(parts, 3)).toEqual([
      { type: 'image', assetId: 'a', detail: 'low' },
      { type: 'image', assetId: 'b', detail: 'low' },
    ]);
  });
  it('超出 N 轮：丢弃（返回空）', () => {
    expect(applyImagePolicy(parts, 6)).toEqual([]);
  });
});
```

- [ ] **Step 7.2: 实现 `attachment/resolve.ts`**

```ts
import type { ImageDetail, MessagePart, WireImagePart } from '@my-copilot/shared';
import { getAsset } from '../repo/asset.js';
import { readAssetFile } from './storage.js';

/** 历史 user 轮的图片保留窗口（设计开放问题 1 的默认值，实施前可调）。 */
export const HISTORY_IMAGE_WINDOW = 5;

/** 纯策略：按 user 轮龄改写图片 parts。age=0 当轮原样；1..N 强制 low；>N 丢弃。 */
export function applyImagePolicy(
  parts: MessagePart[],
  userTurnAge: number,
): MessagePart[] {
  return parts.flatMap((p) => {
    if (p.type !== 'image') return [p];
    if (userTurnAge === 0) return [p];
    if (userTurnAge <= HISTORY_IMAGE_WINDOW) return [{ ...p, detail: 'low' as ImageDetail }];
    return [];
  });
}

/** 解析为 wire 图片（读资产字节 → data URL）。资产缺失时跳过（fail-soft）。 */
export async function resolveWireImages(parts: MessagePart[]): Promise<WireImagePart[]> {
  const out: WireImagePart[] = [];
  for (const p of parts) {
    if (p.type !== 'image') continue;
    const asset = getAsset(p.assetId);
    if (!asset || asset.kind !== 'image') continue;
    const buf = await readAssetFile(p.assetId);
    out.push({ url: `data:${asset.mimeType};base64,${buf.toString('base64')}`, detail: p.detail });
  }
  return out;
}

/** 本次请求是否携带图片（能力学习闭环的判定输入，供计划 B 接线）。 */
export function hasImageParts(parts: MessagePart[] | undefined): boolean {
  return !!parts?.some((p) => p.type === 'image');
}
```

- [ ] **Step 7.3: assembler 接线**

`AssembleV2Params` 增加：

```ts
/** 当前轮用户消息的多模态 parts（图片）。文本资产仍走 attachments 注入。 */
currentUserParts?: MessagePart[];
```

`assembleMessagesV2` 内部两处：
1. 历史 user 消息转换处（`historyToChatMessages` 的调用前后）：对每条 `role === 'user'` 的 `Message`，从后往前数 user 轮龄 `age`（最后一条 user 为 1，因为当前轮未入 history），对 `msg.parts` 应用 `applyImagePolicy(parts, age)` 后 `resolveWireImages`，结果挂到输出 `RunChatMessage.images`（shared 的 `RunChatMessage` 增加可选 `images?: WireImagePart[]`，与 `ChatMessage` 对齐）。
2. 最终 user 消息组装处（现有 `params.attachments` 注入的同一条消息）：`currentUserParts` 经 `applyImagePolicy(parts, 0)` + `resolveWireImages` 后挂 `images`。

V1 `assembleMessages` 不动（legacy/test-only，注释说明）。

- [ ] **Step 7.4: 测试**

`assembler-v2.test.ts` 追加：传入含图片 parts 的 history + currentUserParts（mock `resolveWireImages` 或真实注入内存资产），断言最终 messages 的 user 消息携带 `images`、历史第 6 轮图片被丢弃、轮内图片 `detail: 'low'`。

Run: `pnpm --filter server exec vitest run src/attachment/__tests__/resolve.test.ts src/prompt/__tests__/assembler-v2.test.ts`
Expected: PASS

- [ ] **Step 7.5: Commit**

```bash
git add apps/server/src/attachment/resolve.ts apps/server/src/attachment/__tests__/resolve.test.ts apps/server/src/prompt/assembler.ts apps/server/src/prompt/__tests__/assembler-v2.test.ts
git commit -m "feat(server): image part resolution with history detail policy in assembler"
```

---

### Task 8: 发送链路贯通（routes → lifecycle/worker → runner）

**Files:**
- Modify: `apps/server/src/routes/messages.ts`（读文件确认现有 multipart 解析点后改造）
- Modify: `apps/server/src/streaming/lifecycle.ts`
- Modify: `apps/server/src/jobs/worker.ts`（`AgentLoopJobPayload`）
- Modify: `apps/server/src/agent-loop/runner.ts`（`RunAgentLoopParams` + `runContext` 映射透传 `images`）
- Modify: `apps/server/src/repo/message.ts`（`createMessage`/`rowToMessage` 支持 `parts` 列）
- Test: `apps/server/src/routes/__tests__/messages.test.ts`（扩展）、`apps/server/src/streaming/__tests__/lifecycle.test.ts`（扩展）

- [ ] **Step 8.1: repo/message.ts 支持 parts**

`MessageRow` 加 `parts: string | null`；`rowToMessage` 加 `parts: row.parts ? (JSON.parse(row.parts) as MessagePart[]) : undefined`；`createMessage` 参数加 `parts?: MessagePart[]`、序列化进 INSERT（列清单加 `parts`）。

- [ ] **Step 8.2: routes/messages.ts 双分支**

- 新增 JSON 分支：`POST` body `{ content: string; assetIds?: string[] }`（content-type 为 application/json 时走此路径）。逐个 `getAsset(id)`：
  - 文本类 kind（text/markdown/csv/docx/pdf/code）→ 沿用 `parseAttachment` 语义生成 `AttachmentText` + `AttachmentMeta{assetId}`
  - image kind → `MessagePart { type: 'image', assetId }` 进 `parts`、`AttachmentMeta{assetId}` 进 attachments
- 用户消息落库：`createMessage({ ..., attachments, parts })`，`content` 若有 parts 则为 `projectPartsToText(parts, nameOf) + '\n' + content` 的组合投影（纯文本消息直接原样）。
- 既有 multipart files 分支保留（向后兼容一个版本周期，内部转为"临时资产"路径复用同一逻辑）。
- `runAgentLoop`/job payload 增加 `currentUserParts`（图片 parts 原样传入）。

- [ ] **Step 8.3: lifecycle + worker 透传**

`RunAgentLoopParams` 加 `currentUserParts?: MessagePart[]`；`runAgentLoop` 解构后传入 `assembleMessagesV2({ ..., currentUserParts })`；runner 的 `RunChatMessage → ChatMessage` 直通映射加一行 `...(m.images ? { images: m.images } : {})`。`lifecycle.ts` 同步路径与 `worker.ts` 的 `AgentLoopJobPayload` + context 构造同步透传（对齐 skills 的两链路先例，**缺一即测试失败**）。

- [ ] **Step 8.4: 测试**

`messages.test.ts`：JSON 发送含 image assetId → 201，DB 消息 `parts` 落库、`content` 含 `[图片: a.png]` 投影；`lifecycle.test.ts`：断言 `runAgentLoop` 收到 `currentUserParts`（对齐 skills 断言先例）。

Run: `pnpm --filter server exec vitest run src/routes/__tests__/messages.test.ts src/streaming/__tests__/lifecycle.test.ts src/agent-loop`
Expected: PASS

- [ ] **Step 8.5: Commit**

```bash
git add apps/server/src/routes/messages.ts apps/server/src/streaming/lifecycle.ts apps/server/src/jobs/worker.ts apps/server/src/agent-loop/runner.ts apps/server/src/repo/message.ts apps/server/src/routes/__tests__/messages.test.ts apps/server/src/streaming/__tests__/lifecycle.test.ts
git commit -m "feat(server): end-to-end multimodal send pipeline with parts persistence"
```

---

### Task 9: Web API 客户端（uploadAsset + JSON sendMessage）

**Files:**
- Modify: `apps/web/src/api/real.ts`
- Modify: `apps/web/src/api/index.ts`（含 mock 层同构 no-op/假实现，按 index.ts 现有 mock/real 切换模式处理）
- Test: `apps/web/src/api/__tests__/real.test.ts`（如无此文件，按现有 api 测试位置创建）

- [ ] **Step 9.1: 实现（先写失败测试再实现，断言 fetch 收到 JSON body 与新端点）**

```ts
/** 上传附件为资产。POST /api/assets (multipart) */
export async function uploadAsset(file: File): Promise<Asset> {
  const formData = new FormData();
  formData.append('file', file);
  const response = await fetchWithAuth('/api/assets', { method: 'POST', body: formData });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { msg?: string } | null;
    throw new Error(body?.msg ?? `上传失败（HTTP ${response.status}）`);
  }
  const body = (await response.json()) as { data: Asset };
  return body.data;
}

// sendMessage 改造：FormData → JSON
body: JSON.stringify({ content: params.content, assetIds: params.assetIds }),
headers: { 'Content-Type': 'application/json', ...authHeaders }
// 函数签名：sendMessage(sessionId: string, params: { content: string; assetIds?: string[] })
// （对齐 real.ts:87 现有签名的参数顺序——执行时以现状为准改造调用点）
```

- [ ] **Step 9.2: sessionStore 适配**

`sendMessage(params: { sessionId; content; files? })` → `{ sessionId; content; assetIds? }`（内部调用 Sender 已上传好的资产 id 列表；`files` 通道删除，两个调用点 `Sender.tsx` / `useMessageRegenerate.ts` 同步更新——regenerate 不带附件，改动最小）。

Run: `pnpm --filter web exec vitest run src/store/sessionStore.test.ts src/api`
Expected: PASS

- [ ] **Step 9.3: Commit**

```bash
git add apps/web/src/api/real.ts apps/web/src/api/index.ts apps/web/src/store/sessionStore.ts
git commit -m "feat(web): asset upload API and JSON send message"
```

---

### Task 10: Sender / 附件卡 / 消息渲染

**Files:**
- Modify: `apps/web/src/components/Sender/hooks/useAttachments.ts`（File → Asset 模式，选择即上传）
- Modify: `apps/web/src/components/Sender/Sender.tsx`（图片三入口 + 未知能力弱提示）
- Modify: `apps/web/src/components/Sender/AttachmentCard.tsx`（图片缩略图）
- Modify: `apps/web/src/components/common/MessageCard.tsx`（parts 优先渲染）
- Test: `apps/web/src/components/Sender/hooks/__tests__/useAttachments.test.ts`（新建）、`apps/web/src/components/common/__tests__/MessageCard.test.tsx`（扩展或新建，按现有测试布局）

- [ ] **Step 10.1: useAttachments 资产化（先写失败测试：addAttachment 触发 uploadAsset、失败 toast 且不入列）**

```ts
interface LocalAttachment extends AttachmentMeta { asset: Asset }

const addAttachment = useCallback(async (file: File) => {
  try {
    const asset = await uploadAsset(file);
    setAttachments((prev) => [...prev, {
      assetId: asset.id, name: asset.name, type: asset.mimeType, size: asset.size, asset,
    }]);
  } catch (err) {
    showMessageAlert.error(getErrorMessage(err));
  }
}, []);
```

（上传中状态：pending 集合 + 半透明卡片，实施时按现有 Alert/工具补齐。）

- [ ] **Step 10.2: Sender 三入口 + 弱提示**

- `FileUploadModal` accept 增加 `image/png,image/jpeg,image/gif,image/webp` 与 `.pdf`
- `onPaste`（textarea）：`e.clipboardData.files` 含图片 → `addAttachment`
- 拖拽：Sender 根节点 `onDragOver/onDrop`
- 弱提示：图片附件存在且模型能力未知（能力探测计划未落地前恒为 unknown）→ Sender 顶部一次性 dismissable 提示条「未确认该模型支持图片，首次发送将自动验证」（能力 hook 接入点留注释，消费计划 B 的 `useModelVisionCapability`）

- [ ] **Step 10.3: AttachmentCard 缩略图 + MessageCard parts 渲染**

- AttachmentCard：`attachment.asset?.kind === 'image'` 时 `<img src={/api/assets/${assetId}/raw} className="h-16 w-16 rounded object-cover" />`，其余维持现样式
- MessageCard：`message.parts` 存在 → 渲染 parts（text run 按 Markdown 既有管线、image 直显 `<img>`，点击预留内容栏打开回调 prop `onOpenAsset?`——内容面板计划接线点，默认无操作）；否则走现有 content 渲染（投影兜底）

- [ ] **Step 10.4: 测试 + 回归 + Commit**

Run: `pnpm --filter web exec vitest run src/components/Sender src/components/common`
Expected: PASS

```bash
git add apps/web/src/components/Sender apps/web/src/components/common/MessageCard.tsx
git commit -m "feat(web): image upload entries, asset attachment cards and parts rendering"
```

---

### Task 11: 全量回归 + 手动端到端验证

- [ ] **Step 11.1: 全量验证**

Run: `pnpm typecheck && pnpm --filter server test && pnpm --filter web test && pnpm lint`
Expected: 全绿（命名无关既有失败）

- [ ] **Step 11.2: 手动 E2E（真实 vision 模型，如 deepseek-flash 或本地 llava）**

`pnpm dev` → 配置 provider → 上传图片 + 提问 → 验证：缩略图显示、SSE 回复描述图片内容、刷新会话后图片重现（`/api/assets/:id/raw`）、第 6 轮后 DevTools 观察 LLM 请求体不再含历史图片字节、`detail: low` 生效。

- [ ] **Step 11.3: README 附件章节更新（附件资产化 + 图片支持 + pdf 提取）+ Commit**

```bash
git add README.md
git commit -m "docs: attachment assets and multimodal support"
```

---

## 验收清单（对照设计文档目标）

| 设计目标 | 对应任务 | 验证 |
|---------|---------|------|
| 资产层（文件系统 + assets 表） | Task 2/3/5 | repo/路由测试 + E2E 刷新重现 |
| content parts 数组化 + 投影 | Task 1/8 | parts 落库、content 投影断言 |
| 图片端到端（image_url block） | Task 6/7/8 | adapter 序列化测试 + 手动 E2E |
| 历史图片 detail 分级 | Task 7 | applyImagePolicy 单测 + E2E 请求体观察 |
| 三入口上传 + 未知能力弱提示 | Task 10 | 组件测试 + 手动验证 |
