# 模型能力探测（三态 + 学习闭环）实施计划

> **执行记录（2026-10-01，分支 `model-capability`）：** 计划 Task 1-10 已执行完毕（Task 10.2 手动验收留待用户）。与原文的偏差：
> - **probe.ts 走正式多模态通道**：计划撰写时 A 未落地故用受控 cast 借道序列化；执行时 A 已合并，`ChatMessage.images` 为正式类型，探测消息改用 `{ role:'user', content, images:[{url}] }`（零 cast），测试断言不变
> - **学习闭环抽为共享单点 `capability/learning.ts`**：计划的异步接线点（worker handler）拿不到 `AgentLoopResult.cause`（`runAgentLoopAsJob` 返回可 JSON 化的 job record，cause 对象会丢）——改为 `applyVisionLearningLoop` 纯函数，lifecycle（同步）与 `runAgentLoopAsJob` 内部（异步，context 增 `modelId`）各接一次，并补 8 条单测（强于计划的 4 条 lifecycle 用例）
> - **`learning.ts` 的 ProviderError 从 `llm/base.js` 导入**（非 index barrel）：instanceof 判定要求构造方与判定方共享类定义，也规避了 lifecycle.test 的 async-factory mock 提升问题（vi.mock 异步 factory 在顶层 const 初始化前执行 → TDZ）
> - **分类器两处盲区修复**（计划正则的缺陷）：复数形 "Images" 不匹配 `\bimage\b` → 名词侧 `images?/modalit(y|ies)`；JSON details 的 snake_case（`unsupported_modality`）→ 匹配前下划线/连字符归一为空格
> - **迁移计数测试 8→9**（0009 加入，house 惯例）；cache 测试的 mock 改 `mockImplementation`（Response body 单次消费）
> - 全量验证：typecheck ✓ / server 928 tests ✓ / web 227 tests ✓ / lint 0 error（1 既有 warning：PluginCardHost，非本计划）
>
> **修复（2026-10-01，用户报告：deepseek-v4-pro 被误判 yes，会话 290a7ec1）：** 根因为 DeepSeek 对非 vision 模型走 200 + SSE + 模型侧 "Unsupported Image" 占位降级（DB 实证：模型回复原文明确说出占位），"流成功/请求成功"不构成图片被感知的证据。修正：
> - **probe.ts 重写**：判定改为答案验证——无依赖 PNG 编码器（node:zlib + CRC32）生成 32×32 随机**不常见**纯色（teal/maroon/olive/lime/fuchsia/navy/silver/beige，盲猜高频色 red/blue/green 刻意排除），提示要求精确色名，回答命中中英同义词表 → yes，否则 → no；maxTokens 256 容纳 reasoning 模型；pickColor 可注入保测试确定性
> - **learning.ts 收紧**：成功出站不再升格 yes（删除升格分支），仅保留 400 能力性降级；升格只走探测（答案验证）与手动
> - 端点/测试/文案同步：路由 verdict 直写；lifecycle 与 learning 测试改为"成功不写"断言；Sender 弱提示改为指向设置页实测
> - 验证：定向 58/58 绿（capability + 路由 + lifecycle）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 `Model` 落地三态图片输入能力标记（`yes / no / unknown`）与来源标注（`manual / catalog / provider / probe`），实现四层解析算法、设置页探测按钮、adapter 层错误分类器与学习闭环反写。

**Architecture:** 数据层在 `models` 表新增 `capabilities` JSON 列（迁移 0009，存量 `'{}'` = 全 unknown，零数据迁移），repo 层以 `setModelVisionCapability` 收口全部写入并强制 manual 锁；解析链为纯函数 `resolveVisionCapability`（manual > ollama `/api/show` provider > 目录规则 > unknown），目录表随 `@my-copilot/shared` 发布；错误分类器落 adapter 层输出稳定错误码 `CAPABILITY_VISION_UNSUPPORTED`；探测端点 `POST /api/models/:id/probe-vision` 经既有 provider adapter 发一张 1×1 base64 PNG 实测。前端在设置页模型行提供徽标 / 探测按钮 / 手动覆盖，并导出 `useModelVisionCapability` hook 供 Sender 门控消费。

**Tech Stack:** Hono 4 + better-sqlite3（server）、React 19 + @testing-library/react（web）、Vitest（三环境）、`@my-copilot/shared` 类型与目录常量。**无新增第三方依赖。**

**规格来源:** `docs/2026-09-30-model-capability-design.md`（已获用户批准；其全部决策记录在本计划中视为已锁定）

**关键设计决策（已锁定，源自设计文档决策记录 + 实施细化）:**

- **三态 + 四来源**：`CapabilityState = 'yes' | 'no' | 'unknown'`，`CapabilitySource = 'manual' | 'catalog' | 'provider' | 'probe'`；unknown 是新模型常态（deepseek 实证），不是异常态
- **manual 锁**：repo 层 `setModelVisionCapability` 强制"现存 source=manual 且本次来源非 manual 时拒绝写入"——手动是最终仲裁，**探测按钮与学习闭环同样受锁约束**（探测命中锁时返回 `locked: true`，不写库、不发请求）
- **解析优先级**：manual > provider（仅 ollama `POST /api/show` 读 `capabilities` 数组；**明确不含 `vision` 时回落 catalog 判定**，因 show 可能滞后于模型替换）> catalog（前缀规则表，只收确认条目，宁缺毋滥）> 默认 unknown
- **探测按钮（L4，v1 纳入，用户已确认）**：`openai` 类型 provider 走**真实小图 chat 探测**（经 `getAdapter(provider.type)` → `chatCompletionStream`，写 source=`probe`）；`ollama` 类型走 `/api/show`（provider 原生信息即确定性判定，写 source=`provider`；且 ollama chat 消息格式不支持 OpenAI content array，不做 chat 探测）
- **学习闭环**：出站含 image part 且请求成功 → 升 `yes`（source=`probe`）；**仅 HTTP 400 且错误分类器判定为能力性** → 降 `no`（source=`probe`）；网络/鉴权/限流（401/403/429/5xx）一律不反写。分类器落 adapter 层，输出稳定错误码（对齐 `PluginLifecycleError.errorCode` 先例）
- **catalog 规则语义细化**：设计文档的 `/^llava|qwen.*-vl|glm-4v/` 统一收紧为**前缀匹配**（`^(llava|qwen[\w.-]*-vl|glm-4v)`）并对模型名做小写归一，避免 alternation 把 `qwen.*-vl` 泄漏成子串匹配
- **ollama `/api/show` 惰性探测**（设计开放问题 3 的建议方案）：首次解析时调用 + 内存 TTL 缓存（5 分钟），不做后台批量扫描、不在模型列表刷新时扫描

**与附件资产层计划（A）的执行顺序协调（重要）:**

- **前置依赖**：`docs/2026-09-30-attachment-assets-multimodal-design.md`（实施计划 `2026-09-30-attachment-assets-multimodal-plan.md`，并行编写中）。其引入 `MessagePart`（`{ type: 'image'; assetId; detail? }`）、`Message.parts` 与出口图片组装管道
- **本计划 Task 1–8、10 不依赖 A**，可先行执行；**仅 Task 9（学习闭环接线）前置 A**——其代码读取 `userMessage.parts`，A 落地前无法通过类型检查。执行到 Task 9 时若 A 未执行，跳过并留待 A 执行后补做
- **迁移编号竞态**：当前磁盘最新迁移为 `0007_skill_always.sql`；A 计划（assets 表 + messages.parts）占用 **0008**，本计划使用 **`0009_model_capabilities.sql`**。若执行时 0008/0009 已被其他并行计划占用，本迁移文件改为下一可用编号，**内容不变**（先例：2026-08-22 计划的 0005 → 0006）
- **对 A 的接口承诺**：本计划交付 `resolveVisionCapability(model, provider)` / `resolveAndPersistVision(model, provider)` / `setModelVisionCapability` / `CAPABILITY_VISION_UNSUPPORTED` / `ProviderError.errorCode` / `useModelVisionCapability`，A 的出口门控（vision=no 降级、unknown 直发）与"事后"UX 直接消费
- **类型归属**：`MessagePart` / `AttachmentMeta.assetId` / `assets` 表归 A 所有，本计划一律按名引用、不定义不改动

**已知既有问题（本计划不修复，仅备案）:** web 侧 `real.ts` 的 `updateModel` / `deleteModel` 走扁平 `PATCH|DELETE /api/models/:id`，而服务端仅挂载了 `/api/providers/:providerId/models/:id`（`apps/server/src/index.ts:75`）——既有模型"编辑/删除"链路疑似 404。本计划新增端点挂载在独立的 `modelCapabilitiesApp`（`app.route('/api/models', ...)`），与内联 `GET /api/models` 及上述既有路径互不冲突；该既有问题应另行任务修复。

**新依赖说明（项目规则要求）:** 无新依赖。探测用 1×1 PNG 为内联 base64 常量；ollama `/api/show` 与探测请求均用原生 `fetch`。

**命令约定（均在仓库根 `F:\MyProjects\MyCopilot` 执行）:**
- 定向测试：`pnpm --filter server exec vitest run <路径>` / `pnpm --filter web exec vitest run <路径>` / `pnpm --filter shared exec vitest run <路径>`
- 全量验证：`pnpm typecheck && pnpm --filter shared test && pnpm --filter server test && pnpm --filter web test && pnpm lint`
- 每个 Task 完成且定向测试通过后提交一次（conventional commit）；若所在会话约定不自动提交，跳过 commit 步骤

---

### Task 1: Shared 类型 + catalog 规则表

**Files:**
- Create: `packages/shared/src/capability.ts`
- Modify: `packages/shared/src/provider.ts`（`Model` 接口加 `capabilities` 字段）
- Modify: `packages/shared/src/index.ts`（barrel 加一行）
- Test: `packages/shared/src/__tests__/capability.test.ts`

**说明:** 类型定义逐字采用设计文档"数据模型"章节。shared 既有 `export const` 常量先例（`ApiStatusCode`、`DEFAULT_BUDGET_CONFIG`），目录规则表作为纯数据常量落入 shared 符合"catalog 随宿主版本发布"的设计决策；`matchVisionCatalog` 为无副作用纯函数。`ProbeVisionResponse` 供 Task 5（server 路由）与 Task 6（web 客户端）共用，与 `provider.ts` 的 `Model` 形成 type-only 双向引用（`import type`，运行时无环）。

- [ ] **Step 1.1: 写失败测试**

创建 `packages/shared/src/__tests__/capability.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { VISION_CATALOG_RULES, matchVisionCatalog } from '../capability.js';

describe('matchVisionCatalog', () => {
  it('matches confirmed prefix rules (yes)', () => {
    expect(matchVisionCatalog('gpt-4o')).toBe('yes');
    expect(matchVisionCatalog('gpt-4o-mini-2024-07-18')).toBe('yes');
    expect(matchVisionCatalog('deepseek-flash')).toBe('yes');
    expect(matchVisionCatalog('deepseek-flash-vision-exp')).toBe('yes'); // 同族前缀命中
  });

  it('matches confirmed prefix rules (no)', () => {
    expect(matchVisionCatalog('deepseek-v4-pro')).toBe('no');
  });

  it('normalizes case and surrounding whitespace before matching', () => {
    expect(matchVisionCatalog('GPT-4O')).toBe('yes');
    expect(matchVisionCatalog('  DeepSeek-Flash  ')).toBe('yes');
  });

  it('matches ollama-style local vision model families', () => {
    expect(matchVisionCatalog('llava:13b')).toBe('yes');
    expect(matchVisionCatalog('qwen2.5-7b-instruct-vl')).toBe('yes');
    expect(matchVisionCatalog('glm-4v-plus')).toBe('yes');
  });

  it('returns undefined for unconfirmed names (宁缺毋滥：漏判优于错判)', () => {
    expect(matchVisionCatalog('gpt-4')).toBeUndefined();      // 非 4o，无 vision 结论
    expect(matchVisionCatalog('deepseek-v4')).toBeUndefined();
    expect(matchVisionCatalog('llama3.1:8b')).toBeUndefined();
    expect(matchVisionCatalog('')).toBeUndefined();
    expect(matchVisionCatalog('   ')).toBeUndefined();
  });

  it('exposes rules as ordered prefix regexes', () => {
    expect(VISION_CATALOG_RULES.length).toBeGreaterThanOrEqual(4);
    for (const [pattern] of VISION_CATALOG_RULES) {
      // 全部规则必须是前缀语义（^ 开头）
      expect(pattern.source.startsWith('^')).toBe(true);
    }
  });
});
```

- [ ] **Step 1.2: 运行确认失败**

Run: `pnpm --filter shared exec vitest run src/__tests__/capability.test.ts`
Expected: FAIL（`Cannot find module '../capability.js'`）

- [ ] **Step 1.3: 创建 capability.ts**

创建 `packages/shared/src/capability.ts`：

```ts
import type { Model } from './provider.js';

/** 单项能力的取值。 */
export type CapabilityState = 'yes' | 'no' | 'unknown';

/** 能力值的来源。 */
export type CapabilitySource = 'manual' | 'catalog' | 'provider' | 'probe';

export interface ModelCapabilities {
  /** 图片输入能力。缺省视为 unknown。 */
  vision?: CapabilityState;
  /** 各能力的来源标注（键同名）。 */
  sources?: Partial<Record<'vision', CapabilitySource>>;
  /** 探测时间戳（source = probe 时有意义）。 */
  probedAt?: number;
}

/**
 * 内置"已知模型名 → vision 能力"目录规则（设计：只收录确认过的条目，宁缺毋滥，
 * 错判 no 比漏判 yes 更伤——直接禁用了入口）。随宿主版本发布，不做热更新。
 *
 * 语义：对 trim + 小写归一后的模型名做**前缀匹配**，按数组顺序首个命中生效。
 */
export const VISION_CATALOG_RULES: ReadonlyArray<readonly [RegExp, CapabilityState]> = [
  [/^gpt-4o/, 'yes'],
  [/^deepseek-flash/, 'yes'],
  [/^deepseek-v4-pro/, 'no'],
  [/^(llava|qwen[\w.-]*-vl|glm-4v)/, 'yes'],
];

/** 目录匹配：命中返回能力值，未命中返回 undefined（= unknown，交给上层解析链）。 */
export function matchVisionCatalog(modelName: string): CapabilityState | undefined {
  const name = modelName.trim().toLowerCase();
  if (!name) return undefined;
  for (const [pattern, state] of VISION_CATALOG_RULES) {
    if (pattern.test(name)) return state;
  }
  return undefined;
}

/** POST /api/models/:id/probe-vision 的响应载荷。 */
export interface ProbeVisionResponse {
  /** 探测后的最新模型记录（manual 锁命中时为原记录）。 */
  model: Model;
  probe: {
    /** 探测方式：chat = 真实小图请求；provider-show = ollama /api/show；skipped = manual 锁命中。 */
    method: 'chat' | 'provider-show' | 'skipped';
    vision: CapabilityState;
    source?: CapabilitySource;
    /** true = 手动锁命中，本次探测未写库。 */
    locked?: boolean;
    /** 失败判定（vision = no）时的上游错误摘要。 */
    message?: string;
  };
}
```

- [ ] **Step 1.4: Model 接口加 capabilities 字段**

`packages/shared/src/provider.ts` 顶部加 import，`Model` 接口加字段（其余内容不动）：

```ts
import type { ModelCapabilities } from './capability.js';

export interface Model {
  id: string;
  providerId: string;
  name: string;
  displayName?: string;
  enabled: boolean;
  /** 三态能力标记（图片输入等）。缺省 = 全 unknown（存量数据零迁移）。 */
  capabilities?: ModelCapabilities;
  createdAt: number;
  updatedAt: number;
}
```

- [ ] **Step 1.5: barrel 导出**

`packages/shared/src/index.ts` 在 `export * from './provider.js';` 之后加一行：

```ts
export * from './capability.js';
```

- [ ] **Step 1.6: 运行确认通过**

Run: `pnpm --filter shared exec vitest run src/__tests__/capability.test.ts`
Expected: PASS（6 个用例）

Run: `pnpm typecheck`
Expected: PASS（新增字段全部可选，既有消费方零破坏）

- [ ] **Step 1.7: Commit**

```bash
git add packages/shared/src/capability.ts packages/shared/src/provider.ts packages/shared/src/index.ts packages/shared/src/__tests__/capability.test.ts
git commit -m "feat(shared): model capability types and vision catalog rules"
```

---

### Task 2: 迁移 0009 + repo 扩展（capabilities 读写 + manual 锁）

**Files:**
- Create: `apps/server/src/migration/sql/0009_model_capabilities.sql`
- Create: `apps/server/src/migration/__tests__/0009-model-capabilities.test.ts`
- Modify: `apps/server/src/repo/model.ts`
- Test: `apps/server/src/repo/__tests__/model.test.ts`（追加用例）

**说明:** 全部能力写入收敛到 `setModelVisionCapability` / `clearModelVisionCapability` 两个函数（解析链持久化、探测端点、学习闭环、手动设置全部经此入口），manual 锁在 repo 层强制，调用方无法绕过。既有 `updateModel` 的 UPDATE 语句不触碰 `capabilities` 列，天然保留；只需在返回对象里补解析。

- [ ] **Step 2.1: 写失败测试（迁移）**

创建 `apps/server/src/migration/__tests__/0009-model-capabilities.test.ts`：

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initDatabase, getDb } from '../../db/index.js';
import { createProvider } from '../../repo/provider.js';
import { createModel } from '../../repo/model.js';

describe('migration 0009 model capabilities', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'migration-0009-'));
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

  it('adds capabilities column to models with JSON default {}', () => {
    const cols = getDb().prepare('PRAGMA table_info(models)').all() as Array<{ name: string }>;
    expect(cols.map((c) => c.name)).toContain('capabilities');

    const provider = createProvider({
      name: 'T',
      type: 'openai',
      baseUrl: 'https://api.openai.com',
      apiKey: '',
    });
    createModel(provider.id, { name: 'gpt-4o' });
    const row = getDb()
      .prepare("SELECT capabilities FROM models WHERE name = 'gpt-4o'")
      .get() as { capabilities: string };
    expect(row.capabilities).toBe('{}'); // 存量语义：空对象 = 全 unknown
  });
});
```

- [ ] **Step 2.2: 运行确认失败**

Run: `pnpm --filter server exec vitest run src/migration/__tests__/0009-model-capabilities.test.ts`
Expected: FAIL（`cols.map(...)` 不含 `capabilities`）

- [ ] **Step 2.3: 写迁移**

创建 `apps/server/src/migration/sql/0009_model_capabilities.sql`（⚠️ 若 0008/0009 已被并行计划占用，改为下一可用编号，内容不变）：

```sql
-- 模型能力探测（设计 docs/2026-09-30-model-capability-design.md）
-- 三态能力标记 + 来源标注，JSON 存储；存量 '{}' = 全 unknown，零数据迁移。
ALTER TABLE models ADD COLUMN capabilities TEXT NOT NULL DEFAULT '{}';
```

- [ ] **Step 2.4: 运行确认迁移测试通过**

Run: `pnpm --filter server exec vitest run src/migration/__tests__/0009-model-capabilities.test.ts`
Expected: PASS（1 个用例；启动日志出现 `Migration 0009_model_capabilities.sql applied`）

- [ ] **Step 2.5: 写失败测试（repo 扩展）**

在 `apps/server/src/repo/__tests__/model.test.ts` 的 `describe('ModelRepo', ...)` 内追加（import 区的 model.js import 补 `setModelVisionCapability, clearModelVisionCapability`）：

```ts
  it('getModel reads capabilities; legacy "{}" parses to undefined', () => {
    const provider = createProvider({
      name: 'T',
      type: 'openai',
      baseUrl: 'https://api.openai.com',
      apiKey: '',
    });
    const model = createModel(provider.id, { name: 'gpt-4o' });

    // 新建模型走列默认 '{}' → capabilities 为 undefined（= unknown）
    expect(getModel(model.id)?.capabilities).toBeUndefined();

    setModelVisionCapability(model.id, 'yes', 'catalog');
    expect(getModel(model.id)?.capabilities).toEqual({
      vision: 'yes',
      sources: { vision: 'catalog' },
    });
  });

  it('setModelVisionCapability writes source=probe with probedAt', () => {
    const provider = createProvider({
      name: 'T',
      type: 'openai',
      baseUrl: 'https://api.openai.com',
      apiKey: '',
    });
    const model = createModel(provider.id, { name: 'deepseek-flash' });

    const updated = setModelVisionCapability(model.id, 'no', 'probe');
    expect(updated?.capabilities).toMatchObject({
      vision: 'no',
      sources: { vision: 'probe' },
    });
    expect(updated?.capabilities?.probedAt).toBeGreaterThan(0);
  });

  it('setModelVisionCapability enforces the manual lock', () => {
    const provider = createProvider({
      name: 'T',
      type: 'openai',
      baseUrl: 'https://api.openai.com',
      apiKey: '',
    });
    const model = createModel(provider.id, { name: 'gpt-4o' });

    setModelVisionCapability(model.id, 'yes', 'manual');

    // 非manual 来源（probe / catalog / provider）一律不得覆盖 manual
    const afterProbe = setModelVisionCapability(model.id, 'no', 'probe');
    expect(afterProbe?.capabilities).toEqual({
      vision: 'yes',
      sources: { vision: 'manual' },
    });

    // manual 自身可以改判
    const afterManual = setModelVisionCapability(model.id, 'no', 'manual');
    expect(afterManual?.capabilities).toMatchObject({
      vision: 'no',
      sources: { vision: 'manual' },
    });
  });

  it('clearModelVisionCapability removes the record (back to unknown)', () => {
    const provider = createProvider({
      name: 'T',
      type: 'openai',
      baseUrl: 'https://api.openai.com',
      apiKey: '',
    });
    const model = createModel(provider.id, { name: 'gpt-4o' });

    setModelVisionCapability(model.id, 'yes', 'manual');
    const cleared = clearModelVisionCapability(model.id);
    expect(cleared?.capabilities).toBeUndefined();
    expect(getModel(model.id)?.capabilities).toBeUndefined();

    expect(clearModelVisionCapability('no-such-model')).toBeUndefined();
  });

  it('updateModel preserves the capabilities column', () => {
    const provider = createProvider({
      name: 'T',
      type: 'openai',
      baseUrl: 'https://api.openai.com',
      apiKey: '',
    });
    const model = createModel(provider.id, { name: 'gpt-4o', displayName: 'GPT-4o' });

    setModelVisionCapability(model.id, 'yes', 'probe');
    const updated = updateModel(model.id, { name: 'gpt-4o-2024' });

    expect(updated?.name).toBe('gpt-4o-2024');
    expect(updated?.capabilities).toMatchObject({
      vision: 'yes',
      sources: { vision: 'probe' },
    });
    expect(getModel(model.id)?.capabilities?.probedAt).toBeGreaterThan(0);
  });
```

- [ ] **Step 2.6: 运行确认失败**

Run: `pnpm --filter server exec vitest run src/repo/__tests__/model.test.ts`
Expected: 新用例 FAIL（`setModelVisionCapability is not a function`），既有用例 PASS

- [ ] **Step 2.7: 扩展 repo/model.ts**

`apps/server/src/repo/model.ts` 修改点：

1. import 区替换为：

```ts
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
```

2. `ModelRow` 加一列：

```ts
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
```

3. `rowToModel` 之前新增解析辅助（fail-soft，坏数据按无记录处理）：

```ts
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
```

4. `rowToModel` 返回对象加一个字段：

```ts
    enabled: Boolean(row.enabled),
    capabilities: parseCapabilities(row.capabilities),
    createdAt: row.created_at,
```

5. `updateModel` 的返回对象加一个字段（UPDATE 语句不动——`capabilities` 列不被触碰即保留）：

```ts
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
```

6. 文件末尾导出两个新函数：

```ts
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
```

- [ ] **Step 2.8: 运行确认通过**

Run: `pnpm --filter server exec vitest run src/repo/__tests__/model.test.ts src/migration/__tests__/0009-model-capabilities.test.ts`
Expected: 全部 PASS（既有 5 用例 + 迁移 1 用例 + 新增 5 用例）

- [ ] **Step 2.9: Commit**

```bash
git add apps/server/src/migration/sql/0009_model_capabilities.sql apps/server/src/migration/__tests__/0009-model-capabilities.test.ts apps/server/src/repo/model.ts apps/server/src/repo/__tests__/model.test.ts
git commit -m "feat(server): models.capabilities column with manual-locked repo writers"
```

---

### Task 3: 四层解析链（manual > provider > catalog > unknown）

**Files:**
- Create: `apps/server/src/capability/resolve.ts`
- Create: `apps/server/src/capability/__tests__/resolve.test.ts`

**说明:** `resolveVisionCapability` 是纯决策函数——provider 探测经 `ResolveIo` 注入（单测零网络）；`fetchOllamaShowCapabilities` 是 server 侧 provider 层实现（惰性 + 5 分钟内存 TTL 缓存，设计开放问题 3）；`resolveAndPersistVision` 组合"解析 + 持久化"，供探测端点 ollama 分支与 A 计划的出口门控复用（写入经 Task 2 的 `setModelVisionCapability`，manual 锁双保险）。server 为扁平模块结构，新增顶层 `capability/` 目录与 `llm/`、`skills/` 平级。

- [ ] **Step 3.1: 写失败测试**

创建 `apps/server/src/capability/__tests__/resolve.test.ts`：

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Model, Provider } from '@my-copilot/shared';
import { initDatabase, getDb } from '../../db/index.js';
import { createProvider } from '../../repo/provider.js';
import { createModel, getModel, setModelVisionCapability } from '../../repo/model.js';
import {
  resolveVisionCapability,
  resolveAndPersistVision,
  fetchOllamaShowCapabilities,
  clearOllamaShowCache,
} from '../resolve.js';
import { ProviderError } from '../../llm/index.js';

function makeModel(over: Partial<Model> = {}): Model {
  return {
    id: 'm1',
    providerId: 'p1',
    name: 'some-model',
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
}

function makeProvider(over: Partial<Provider> = {}): Provider {
  return {
    id: 'p1',
    name: 'P',
    type: 'openai',
    baseUrl: 'https://api.example.com/v1',
    apiKey: '',
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
}

describe('resolveVisionCapability (pure decision)', () => {
  it('layer 1: manual source short-circuits everything', async () => {
    const model = makeModel({
      capabilities: { vision: 'no', sources: { vision: 'manual' } },
    });
    const provider = makeProvider({ type: 'ollama' });
    const fetchOllamaShow = vi.fn();

    const result = await resolveVisionCapability(model, provider, { fetchOllamaShow });
    expect(result).toEqual({ vision: 'no', source: 'manual' });
    expect(fetchOllamaShow).not.toHaveBeenCalled(); // 手动仲裁，不再探测
  });

  it('layer 2: ollama /api/show containing vision → yes (source=provider)', async () => {
    const model = makeModel({ name: 'llama3.2-vision' }); // 故意不命中 catalog
    const provider = makeProvider({ type: 'ollama' });
    const fetchOllamaShow = vi.fn().mockResolvedValue(['completion', 'vision']);

    expect(await resolveVisionCapability(model, provider, { fetchOllamaShow })).toEqual({
      vision: 'yes',
      source: 'provider',
    });
  });

  it('layer 2: show 明确不含 vision → 回落 catalog 判定（show 可能滞后于模型替换）', async () => {
    const model = makeModel({ name: 'gpt-4o' }); // catalog 命中 yes
    const provider = makeProvider({ type: 'ollama' });
    const fetchOllamaShow = vi.fn().mockResolvedValue(['completion']);

    expect(await resolveVisionCapability(model, provider, { fetchOllamaShow })).toEqual({
      vision: 'yes',
      source: 'catalog',
    });
  });

  it('layer 2: provider 探测失败（网络/404）不阻塞解析，落入 catalog', async () => {
    const model = makeModel({ name: 'gpt-4o' });
    const provider = makeProvider({ type: 'ollama' });
    const fetchOllamaShow = vi.fn().mockRejectedValue(new ProviderError('show failed', 502));

    expect(await resolveVisionCapability(model, provider, { fetchOllamaShow })).toEqual({
      vision: 'yes',
      source: 'catalog',
    });
  });

  it('layer 2: openai 类型 provider 无原生信息，直接跳过', async () => {
    const model = makeModel({ name: 'deepseek-flash' });
    const provider = makeProvider({ type: 'openai' });
    const fetchOllamaShow = vi.fn();

    expect(await resolveVisionCapability(model, provider, { fetchOllamaShow })).toEqual({
      vision: 'yes',
      source: 'catalog',
    });
    expect(fetchOllamaShow).not.toHaveBeenCalled();
  });

  it('layer 4: 无任何信息 → unknown（无来源）', async () => {
    const model = makeModel({ name: 'totally-unknown-model' });
    const provider = makeProvider({ type: 'openai' });

    expect(await resolveVisionCapability(model, provider)).toEqual({ vision: 'unknown' });
  });
});

describe('fetchOllamaShowCapabilities (provider layer + cache)', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    clearOllamaShowCache();
  });

  it('POSTs {baseUrl}/api/show and returns the capabilities array', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ capabilities: ['completion', 'vision'] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const provider = makeProvider({
      id: 'p-ollama',
      type: 'ollama',
      baseUrl: 'http://localhost:11434/',
    });
    await expect(fetchOllamaShowCapabilities(provider, 'llava:13b')).resolves.toEqual([
      'completion',
      'vision',
    ]);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:11434/api/show'); // 尾斜杠归一
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ model: 'llava:13b' });
  });

  it('caches per (provider, model) within TTL; clearOllamaShowCache forces refetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ capabilities: ['completion'] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const provider = makeProvider({ id: 'p-ollama', type: 'ollama' });
    await fetchOllamaShowCapabilities(provider, 'llama3');
    await fetchOllamaShowCapabilities(provider, 'llama3');
    expect(fetchMock).toHaveBeenCalledTimes(1); // 命中缓存

    clearOllamaShowCache();
    await fetchOllamaShowCapabilities(provider, 'llama3');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('non-200 → ProviderError (调用方在解析链中按"无信息"处理)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'model not found' }), { status: 404 }),
    ) as unknown as typeof fetch;

    const provider = makeProvider({ id: 'p-ollama', type: 'ollama' });
    await expect(fetchOllamaShowCapabilities(provider, 'nope')).rejects.toThrow(ProviderError);
  });
});

describe('resolveAndPersistVision (resolve + persist)', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'capability-resolve-'));
    initDatabase(testDir);
  });

  afterEach(() => {
    try {
      getDb().close();
    } catch {
      // ignore
    }
    if (testDir) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('persists a catalog hit with source=catalog', async () => {
    const provider = createProvider({
      name: 'P',
      type: 'openai',
      baseUrl: 'https://api.example.com/v1',
      apiKey: '',
    });
    const model = createModel(provider.id, { name: 'gpt-4o' });

    const updated = await resolveAndPersistVision(model, provider);
    expect(updated?.capabilities).toEqual({
      vision: 'yes',
      sources: { vision: 'catalog' },
    });
    expect(getModel(model.id)?.capabilities?.vision).toBe('yes');
  });

  it('leaves manual-locked models untouched (repo 锁兜底)', async () => {
    const provider = createProvider({
      name: 'P',
      type: 'openai',
      baseUrl: 'https://api.example.com/v1',
      apiKey: '',
    });
    const model = createModel(provider.id, { name: 'gpt-4o' });
    setModelVisionCapability(model.id, 'no', 'manual');

    const updated = await resolveAndPersistVision(model, provider);
    expect(updated?.capabilities).toEqual({
      vision: 'no',
      sources: { vision: 'manual' },
    });
  });

  it('returns the model unchanged when resolution is unknown', async () => {
    const provider = createProvider({
      name: 'P',
      type: 'openai',
      baseUrl: 'https://api.example.com/v1',
      apiKey: '',
    });
    const model = createModel(provider.id, { name: 'totally-unknown' });

    const updated = await resolveAndPersistVision(model, provider);
    expect(updated?.id).toBe(model.id);
    expect(updated?.capabilities).toBeUndefined();
  });
});
```

- [ ] **Step 3.2: 运行确认失败**

Run: `pnpm --filter server exec vitest run src/capability/__tests__/resolve.test.ts`
Expected: FAIL（`Cannot find module '../resolve.js'`）

- [ ] **Step 3.3: 实现 resolve.ts**

创建 `apps/server/src/capability/resolve.ts`：

```ts
import type {
  CapabilitySource,
  CapabilityState,
  Model,
  ModelCapabilities,
  Provider,
} from '@my-copilot/shared';
import { matchVisionCatalog } from '@my-copilot/shared';
import { setModelVisionCapability } from '../repo/model.js';
import { ProviderError } from '../llm/index.js';

/** 解析结果：vision = unknown 时无来源标注。 */
export interface VisionResolution {
  vision: CapabilityState;
  source?: CapabilitySource;
}

/** 注入的 provider 探测实现（纯函数单测零网络）。 */
export interface ResolveIo {
  fetchOllamaShow?: (provider: Provider, modelName: string) => Promise<string[] | undefined>;
}

/**
 * 四层解析（设计"解析算法"章节）：
 *   1. manual   —— capabilities.sources.vision = manual 时直接返回（最终仲裁）
 *   2. provider —— ollama POST /api/show 读 capabilities 数组；含 'vision' → yes；
 *                  明确不含 → 保持 catalog 判定（show 可能滞后于模型替换）
 *   3. catalog  —— 内置前缀规则表（@my-copilot/shared，随版本发布）
 *   4. 默认     —— unknown
 */
export async function resolveVisionCapability(
  model: Model,
  provider: Provider,
  io: ResolveIo = {},
): Promise<VisionResolution> {
  const caps: ModelCapabilities | undefined = model.capabilities;

  // 1. manual
  if (caps?.sources?.vision === 'manual' && caps.vision) {
    return { vision: caps.vision, source: 'manual' };
  }

  // 2. provider（仅 ollama 有原生能力信息；openai 兼容生态 /models 不携带）
  if (provider.type === 'ollama' && io.fetchOllamaShow) {
    try {
      const shown = await io.fetchOllamaShow(provider, model.name);
      if (shown?.includes('vision')) {
        return { vision: 'yes', source: 'provider' };
      }
    } catch {
      // provider 层失败不阻塞解析，落入 catalog
    }
  }

  // 3. catalog
  const catalogState = matchVisionCatalog(model.name);
  if (catalogState) {
    return { vision: catalogState, source: 'catalog' };
  }

  // 4. 默认 unknown
  return { vision: 'unknown' };
}

// ---------------------------------------------------------------------------
// provider 层实现：ollama /api/show（惰性探测 + 内存 TTL 缓存）
// ---------------------------------------------------------------------------

const SHOW_CACHE_TTL_MS = 5 * 60 * 1000;
const SHOW_TIMEOUT_MS = 5_000;

const showCache = new Map<string, { capabilities: string[]; fetchedAt: number }>();

/** 清空 /api/show 缓存（测试与手动刷新用）。 */
export function clearOllamaShowCache(): void {
  showCache.clear();
}

/** POST {baseUrl}/api/show {"model": name} → capabilities 数组（官方 docs/api.md）。 */
export async function fetchOllamaShowCapabilities(
  provider: Provider,
  modelName: string,
): Promise<string[] | undefined> {
  const key = `${provider.id}:${modelName}`;
  const cached = showCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < SHOW_CACHE_TTL_MS) {
    return cached.capabilities;
  }

  const normalized = provider.baseUrl.endsWith('/')
    ? provider.baseUrl.slice(0, -1)
    : provider.baseUrl;
  const response = await fetch(`${normalized}/api/show`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: modelName }),
    signal: AbortSignal.timeout(SHOW_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new ProviderError(`Ollama /api/show failed: HTTP ${response.status}`, 502);
  }
  const body = (await response.json()) as { capabilities?: string[] };
  const capabilities = Array.isArray(body.capabilities) ? body.capabilities : [];
  showCache.set(key, { capabilities, fetchedAt: Date.now() });
  return capabilities;
}

/**
 * 解析 + 持久化：供探测端点 ollama 分支与附件资产层（A 计划）的出口门控复用。
 * 写入经 repo 层 manual 锁；解析为 unknown 时不写库。
 */
export async function resolveAndPersistVision(
  model: Model,
  provider: Provider,
): Promise<Model | undefined> {
  const resolution = await resolveVisionCapability(model, provider, {
    fetchOllamaShow: fetchOllamaShowCapabilities,
  });
  if (resolution.vision === 'unknown' || !resolution.source) {
    return model;
  }
  if (
    model.capabilities?.vision === resolution.vision &&
    model.capabilities?.sources?.vision === resolution.source
  ) {
    return model; // 幂等
  }
  return setModelVisionCapability(model.id, resolution.vision, resolution.source);
}
```

- [ ] **Step 3.4: 运行确认通过**

Run: `pnpm --filter server exec vitest run src/capability/__tests__/resolve.test.ts`
Expected: 全部 PASS（12 个用例）

- [ ] **Step 3.5: Commit**

```bash
git add apps/server/src/capability/resolve.ts apps/server/src/capability/__tests__/resolve.test.ts
git commit -m "feat(server): four-layer vision capability resolution with lazy ollama show cache"
```

---

### Task 4: 错误分类器 + ProviderError 稳定错误码

**Files:**
- Create: `apps/server/src/capability/classify.ts`
- Create: `apps/server/src/capability/__tests__/classify.test.ts`
- Modify: `apps/server/src/llm/base.ts`（`ProviderError` 加 `errorCode`）
- Modify: `apps/server/src/llm/openai.ts`（`handleErrorResponse` 分类）
- Modify: `apps/server/src/llm/ollama.ts`（`handleErrorResponse` 分类）
- Test: `apps/server/src/llm/__tests__/openai.test.ts`（追加用例）
- Test: `apps/server/src/llm/__tests__/ollama.test.ts`（追加用例）

**说明:** 设计决策："仅 HTTP 400 + 能力性错误结构反写 no；网络/鉴权/限流错误不反写"。分类器是纯函数（供探测端点直接调用），同时落 adapter 层为 `ProviderError` 附加稳定错误码 `errorCode`（对齐 `PluginLifecycleError.errorCode` 先例，`packages/shared/src/plugin.ts:229`）——因为 `runAgentLoop` 的 catch 会把错误对象stringify 成 `result.error: string`（`agent-loop/runner.ts:756-779`），学习闭环需要对象上的错误码才能判定。

- [ ] **Step 4.1: 写失败测试（分类器）**

创建 `apps/server/src/capability/__tests__/classify.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { CAPABILITY_VISION_UNSUPPORTED, isVisionCapabilityError } from '../classify.js';

describe('isVisionCapabilityError', () => {
  it('classifies vision-capability 400s by message keywords', () => {
    expect(
      isVisionCapabilityError({
        statusCode: 400,
        message: 'Invalid content type. image_url is only supported by vision models.',
      }),
    ).toBe(true);
    expect(
      isVisionCapabilityError({
        statusCode: 400,
        message: 'This model does not support image input.',
      }),
    ).toBe(true);
    expect(
      isVisionCapabilityError({ statusCode: 400, message: 'Unsupported input modality: image' }),
    ).toBe(true);
    expect(
      isVisionCapabilityError({ statusCode: 400, message: 'Images are not supported by this model' }),
    ).toBe(true);
  });

  it('classifies by structured details when the message alone is generic', () => {
    expect(
      isVisionCapabilityError({
        statusCode: 400,
        message: 'HTTP 400: Bad Request',
        details: { error: { code: 'unsupported_modality', message: 'image modality not allowed' } },
      }),
    ).toBe(true);
  });

  it('rejects non-400 status codes (网络/鉴权/限流一律不反写)', () => {
    expect(isVisionCapabilityError({ statusCode: 401, message: 'image ... not supported' })).toBe(false);
    expect(isVisionCapabilityError({ statusCode: 403, message: 'Invalid content type' })).toBe(false);
    expect(isVisionCapabilityError({ statusCode: 429, message: 'Rate limited: image requests' })).toBe(false);
    expect(isVisionCapabilityError({ statusCode: 502, message: 'Unsupported input modality' })).toBe(false);
  });

  it('rejects unrelated 400s (防止把普通参数错误误记成"不支持图片")', () => {
    expect(isVisionCapabilityError({ statusCode: 400, message: 'max_tokens must be at least 1' })).toBe(false);
    expect(isVisionCapabilityError({ statusCode: 400, message: 'Invalid request: missing field role' })).toBe(false);
    expect(isVisionCapabilityError({ statusCode: 400, message: 'Context length exceeded' })).toBe(false);
  });

  it('exposes the stable error code constant', () => {
    expect(CAPABILITY_VISION_UNSUPPORTED).toBe('capability_vision_unsupported');
  });
});
```

- [ ] **Step 4.2: 运行确认失败**

Run: `pnpm --filter server exec vitest run src/capability/__tests__/classify.test.ts`
Expected: FAIL（module not found）

- [ ] **Step 4.3: 实现 classify.ts**

创建 `apps/server/src/capability/classify.ts`：

```ts
/** 学习闭环"能力性错误"分类器的输入（对齐 ProviderError 的可序列化字段）。 */
export interface ProviderErrorInput {
  statusCode: number;
  message: string;
  details?: unknown;
}

/**
 * 稳定错误码：provider 400 且判定为图片能力性错误时附加到 ProviderError
 * （对齐 PluginLifecycleError.errorCode 先例，供学习闭环等消费方复用）。
 */
export const CAPABILITY_VISION_UNSUPPORTED = 'capability_vision_unsupported';

/**
 * 图片能力性错误关键词（设计："unsupported modality / invalid content type 类关键词或结构"）。
 * 只做保守匹配——错判 no 会直接禁用图片入口，宁漏勿错。
 */
const VISION_ERROR_PATTERNS: readonly RegExp[] = [
  /\b(?:not supported|unsupported|does not support|don't support)\b[^.]{0,80}\b(?:image|vision|multimodal|modality)\b/i,
  /\b(?:image|vision|multimodal|modality)\b[^.]{0,80}\b(?:not supported|unsupported)\b/i,
  /invalid content type/i,
  /unsupported (?:input )?modality/i,
  /\bimage_url\b[^.]{0,80}\b(?:invalid|not (?:supported|allowed))\b/i,
];

/**
 * 判定一个 provider 错误是否为"模型不支持图片输入"的能力性错误。
 *
 * 设计决策：仅 HTTP 400 反写 no——401/403（鉴权）、429（限流）、5xx（网络/上游）
 * 与图片能力无关，反写会把断网误记成"不支持"。
 */
export function isVisionCapabilityError(input: ProviderErrorInput): boolean {
  if (input.statusCode !== 400) return false;
  const haystacks = [input.message];
  if (input.details !== undefined) {
    try {
      haystacks.push(JSON.stringify(input.details));
    } catch {
      // details 不可序列化时仅按 message 判定
    }
  }
  return haystacks.some((h) => VISION_ERROR_PATTERNS.some((p) => p.test(h)));
}
```

- [ ] **Step 4.4: 运行确认通过**

Run: `pnpm --filter server exec vitest run src/capability/__tests__/classify.test.ts`
Expected: PASS（5 个用例）

- [ ] **Step 4.5: ProviderError 加 errorCode 字段**

`apps/server/src/llm/base.ts` 的 `ProviderError` 类整体替换为：

```ts
/** Provider error with HTTP status code */
export class ProviderError extends Error {
  public statusCode: number;
  public details?: unknown;
  /** 稳定错误码（如 CAPABILITY_VISION_UNSUPPORTED），对齐 PluginLifecycleError.errorCode 先例。 */
  public errorCode?: string;

  constructor(message: string, statusCode: number, details?: unknown, errorCode?: string) {
    super(message);
    this.name = 'ProviderError';
    this.statusCode = statusCode;
    this.details = details;
    this.errorCode = errorCode;
  }
}
```

- [ ] **Step 4.6: adapter 层接线（openai.ts）**

`apps/server/src/llm/openai.ts`：

1. 文件顶部 import 区加：

```ts
import { CAPABILITY_VISION_UNSUPPORTED, isVisionCapabilityError } from '../capability/classify.js';
```

2. `handleErrorResponse` 整体替换为（保留解析出的响应体作 `details`，供分类与上游透出）：

```ts
async function handleErrorResponse(response: Response): Promise<never> {
  let message = `HTTP ${response.status}: ${response.statusText}`;
  let details: unknown;

  try {
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      details = await response.json();
      const errorBody = details as { error?: { message?: string }; message?: string };
      const errorMsg = errorBody?.error?.message ?? errorBody?.message;
      if (errorMsg) message = errorMsg;
    } else {
      const text = await response.text();
      if (text) message = text;
    }
  } catch {
    // ignore body parsing errors
  }

  const statusCode =
    response.status >= 400 && response.status < 600 ? response.status : 502;

  // 能力性 400 → 稳定错误码（学习闭环反写 no 的判定依据）
  if (
    response.status === 400 &&
    isVisionCapabilityError({ statusCode: response.status, message, details })
  ) {
    throw new ProviderError(
      `OpenAI request failed: ${message}`,
      statusCode,
      details,
      CAPABILITY_VISION_UNSUPPORTED,
    );
  }

  // Map common OpenAI errors
  if (response.status === 401 || response.status === 403) {
    throw new ProviderError(`Authentication failed: ${message}`, statusCode);
  }
  if (response.status === 429) {
    throw new ProviderError(`Rate limited: ${message}`, statusCode);
  }

  throw new ProviderError(`OpenAI request failed: ${message}`, statusCode);
}
```

- [ ] **Step 4.7: adapter 层接线（ollama.ts）**

`apps/server/src/llm/ollama.ts` 同样处理：

1. 文件顶部 import 区加：

```ts
import { CAPABILITY_VISION_UNSUPPORTED, isVisionCapabilityError } from '../capability/classify.js';
```

2. `handleErrorResponse` 整体替换为：

```ts
async function handleErrorResponse(response: Response): Promise<never> {
  let message = `HTTP ${response.status}: ${response.statusText}`;
  let details: unknown;

  try {
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      details = await response.json();
      // Ollama error format: { "error": "model not found" }
      const errorBody = details as { error?: string; message?: string };
      const errorMsg = errorBody?.error ?? errorBody?.message;
      if (errorMsg) message = errorMsg;
    } else {
      const text = await response.text();
      if (text) message = text;
    }
  } catch {
    // ignore body parsing errors
  }

  const statusCode =
    response.status >= 400 && response.status < 600 ? response.status : 502;

  if (
    response.status === 400 &&
    isVisionCapabilityError({ statusCode: response.status, message, details })
  ) {
    throw new ProviderError(
      `Ollama request failed: ${message}`,
      statusCode,
      details,
      CAPABILITY_VISION_UNSUPPORTED,
    );
  }

  throw new ProviderError(`Ollama request failed: ${message}`, statusCode);
}
```

- [ ] **Step 4.8: 写失败测试（adapter 错误码）**

在 `apps/server/src/llm/__tests__/openai.test.ts` 的 `describe('OpenAIAdapter', ...)` 内追加（import 区补 `import { CAPABILITY_VISION_UNSUPPORTED } from '../../capability/classify.js';`）：

```ts
  it('HTTP 400 capability error → ProviderError(errorCode=capability_vision_unsupported)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { message: 'Invalid content type. image_url is only supported by vision models.' },
        }),
        { status: 400, headers: { 'content-type': 'application/json' } },
      ),
    );

    const adapter = new OpenAIAdapter();
    try {
      for await (const _chunk of adapter.chatCompletionStream(messages, createConfig())) {
        void _chunk;
      }
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError);
      expect((err as ProviderError).statusCode).toBe(400);
      expect((err as ProviderError).errorCode).toBe(CAPABILITY_VISION_UNSUPPORTED);
    }
  });

  it('HTTP 429 → no capability errorCode (限流不反写)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'image requests rate limited' } }), {
        status: 429,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const adapter = new OpenAIAdapter();
    try {
      for await (const _chunk of adapter.chatCompletionStream(messages, createConfig())) {
        void _chunk;
      }
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError);
      expect((err as ProviderError).statusCode).toBe(429);
      expect((err as ProviderError).errorCode).toBeUndefined();
    }
  });
```

在 `apps/server/src/llm/__tests__/ollama.test.ts` 的 `describe('OllamaAdapter', ...)` 内追加同构用例（按该文件既有的 fetch mock 与消息构造风格对齐，核心断言如下）：

```ts
  it('HTTP 400 capability error → ProviderError(errorCode=capability_vision_unsupported)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'model does not support image input' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const adapter = new OllamaAdapter();
    try {
      for await (const _chunk of adapter.chatCompletionStream(messages, createConfig())) {
        void _chunk;
      }
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError);
      expect((err as ProviderError).statusCode).toBe(400);
      expect((err as ProviderError).errorCode).toBe(CAPABILITY_VISION_UNSUPPORTED);
    }
  });
```

（`messages` / `createConfig` 沿用 ollama.test.ts 文件内已有的同名测试夹具；import 区补 `CAPABILITY_VISION_UNSUPPORTED`。）

- [ ] **Step 4.9: 运行确认通过 + llm 回归**

Run: `pnpm --filter server exec vitest run src/llm src/capability/__tests__/classify.test.ts`
Expected: 全部 PASS（既有 llm 套件零回归 + 新增 3 用例）

- [ ] **Step 4.10: Commit**

```bash
git add apps/server/src/capability/classify.ts apps/server/src/capability/__tests__/classify.test.ts apps/server/src/llm/base.ts apps/server/src/llm/openai.ts apps/server/src/llm/ollama.ts apps/server/src/llm/__tests__/openai.test.ts apps/server/src/llm/__tests__/ollama.test.ts
git commit -m "feat(server): vision capability error classifier with stable ProviderError.errorCode"
```

---

### Task 5: 探测端点 + 手动设置端点

**Files:**
- Create: `apps/server/src/capability/probe.ts`
- Create: `apps/server/src/capability/__tests__/probe.test.ts`
- Modify: `apps/server/src/routes/models.ts`（新增 `modelCapabilitiesApp`）
- Modify: `apps/server/src/index.ts`（挂载）
- Test: `apps/server/src/routes/__tests__/modelCapabilities.test.ts`

**说明:** 现有 `modelsApp` 挂载在 `/api/providers/:providerId/models`，而 `/api/models` 仅有一条内联 GET（`index.ts:94-97`）；探测/手动设置端点以独立的 `modelCapabilitiesApp` 挂到 `/api/models`，与两者互不冲突。探测流程：manual 锁命中 → `skipped`（不写库不发请求）；ollama → `resolveAndPersistVision`（`/api/show`，写 source=`provider`）；openai → `probeVisionByChat` 真实小图请求（首个流事件即判定成功，写 source=`probe`；能力性 400 → 写 `no`；其余错误 → 502 不写库）。

- [ ] **Step 5.1: 写失败测试（probe 模块）**

创建 `apps/server/src/capability/__tests__/probe.test.ts`：

```ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import type { Provider } from '@my-copilot/shared';
import { probeVisionByChat, PROBE_IMAGE_DATA_URL } from '../probe.js';
import { ProviderError } from '../../llm/index.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function createProvider(over: Partial<Provider> = {}): Provider {
  return {
    id: 'p1',
    name: 'P',
    type: 'openai',
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'sk-test',
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
}

function createSSEResponse(lines: string[], status = 200): Response {
  const body = lines.join('\n') + '\n';
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      controller.enqueue(encoder.encode(body));
      controller.close();
    },
  });
  return new Response(stream, { status, headers: { 'content-type': 'text/event-stream' } });
}

describe('probeVisionByChat', () => {
  it('PROBE_IMAGE_DATA_URL is a valid tiny PNG data URL', () => {
    expect(PROBE_IMAGE_DATA_URL.startsWith('data:image/png;base64,')).toBe(true);
    const bytes = Buffer.from(PROBE_IMAGE_DATA_URL.slice('data:image/png;base64,'.length), 'base64');
    expect(bytes.length).toBeGreaterThanOrEqual(60); // 1×1 PNG ≈ 67–70 B
    expect(bytes.subarray(1, 4).toString('ascii')).toBe('PNG'); // PNG 魔数
    // ⚠️ 若本断言失败：用任意工具重生成一张 1×1 PNG 替换常量（探测只需 provider 接受 image block）
  });

  it('returns yes on the first stream event (provider accepted the image)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      createSSEResponse([
        'data: {"choices":[{"delta":{"content":"ok"}}]}',
        'data: [DONE]',
      ]),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(probeVisionByChat(createProvider(), 'deepseek-flash')).resolves.toBe('yes');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.example.com/v1/chat/completions');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string) as {
      model: string;
      max_tokens: number;
      messages: Array<{
        role: string;
        content: Array<{ type: string; image_url?: { url: string } }>;
      }>;
    };
    expect(body.model).toBe('deepseek-flash');
    expect(body.max_tokens).toBe(64); // 小额输出，保证"几秒出结果"
    const parts = body.messages[0].content;
    expect(parts.some((p) => p.type === 'text')).toBe(true);
    const imagePart = parts.find((p) => p.type === 'image_url');
    expect(imagePart?.image_url?.url.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('throws ProviderError when the stream ends without any event (超时/中断)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(createSSEResponse([])) as unknown as typeof fetch;

    await expect(probeVisionByChat(createProvider(), 'm')).rejects.toThrow(ProviderError);
  });

  it('propagates provider errors (能力性 400 由端点分类)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { message: 'Invalid content type. image_url is only supported by vision models.' },
        }),
        { status: 400, headers: { 'content-type': 'application/json' } },
      ),
    ) as unknown as typeof fetch;

    const err = await probeVisionByChat(createProvider(), 'deepseek-v4-pro').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).statusCode).toBe(400);
  });

  it('rejects non-openai providers (ollama 走 /api/show，chat 消息格式不支持 content array)', async () => {
    await expect(probeVisionByChat(createProvider({ type: 'ollama' }), 'llava:13b')).rejects.toThrow(
      /openai/,
    );
  });
});
```

- [ ] **Step 5.2: 运行确认失败**

Run: `pnpm --filter server exec vitest run src/capability/__tests__/probe.test.ts`
Expected: FAIL（module not found）

- [ ] **Step 5.3: 实现 probe.ts**

创建 `apps/server/src/capability/probe.ts`：

```ts
import type { Provider } from '@my-copilot/shared';
import { getAdapter, ProviderError } from '../llm/index.js';
import type { ChatMessage } from '../llm/index.js';

/**
 * 1×1 透明 PNG（探测只需 provider 接受 image block，像素内容无关紧要；
 * 单测校验 PNG 魔数，若替换请用任意工具重生成 1×1 PNG）。
 */
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

/** 探测请求内嵌的小图 data URL。 */
export const PROBE_IMAGE_DATA_URL = `data:image/png;base64,${TINY_PNG_BASE64}`;

const PROBE_PROMPT = 'Reply with the single word: ok';
const PROBE_MAX_TOKENS = 64;
const PROBE_TIMEOUT_MS = 20_000;

/**
 * 用真实小图 chat 请求实测 vision 能力（设计 L4"测试图片输入"，openai 类型专用）。
 *
 * 经既有 provider adapter 发送（getAdapter → chatCompletionStream）；OpenAI 兼容
 * 多模态 content block 经一次受控 cast 借道既有序列化直通（serializeMessage 对
 * 非 null content 原样放入 JSON body）。ChatMessage.content 的正式 content-parts
 * 类型化归附件资产层计划（A）的出口组装所有，落地后本 cast 可移除。
 *
 * @returns 'yes' —— 首个流事件即证明 provider 接受了图片输入
 * @throws ProviderError —— 能力性 400（由调用方分类为 no）或网络/上游错误
 */
export async function probeVisionByChat(provider: Provider, modelName: string): Promise<'yes'> {
  if (provider.type !== 'openai') {
    throw new Error('probeVisionByChat only supports openai-type providers (ollama 走 /api/show)');
  }

  const messages = [
    {
      role: 'user' as const,
      content: [
        { type: 'text' as const, text: PROBE_PROMPT },
        { type: 'image_url' as const, image_url: { url: PROBE_IMAGE_DATA_URL } },
      ],
    },
  ] as unknown as ChatMessage[];

  const adapter = getAdapter(provider.type);
  for await (const _event of adapter.chatCompletionStream(
    messages,
    { baseUrl: provider.baseUrl, apiKey: provider.apiKey, model: modelName },
    { maxTokens: PROBE_MAX_TOKENS, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) },
  )) {
    return 'yes'; // 首个事件即判定成功，不再消费后续流
  }
  throw new ProviderError('探测请求未返回任何事件（超时或被中断）', 502);
}
```

- [ ] **Step 5.4: 运行确认通过**

Run: `pnpm --filter server exec vitest run src/capability/__tests__/probe.test.ts`
Expected: PASS（5 个用例）

- [ ] **Step 5.5: 写失败测试（路由）**

创建 `apps/server/src/routes/__tests__/modelCapabilities.test.ts`：

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { Model, Provider } from '@my-copilot/shared';
import { errorMiddleware } from '../../middleware/error.js';
import { modelCapabilitiesApp } from '../models.js';
import { ProviderError } from '../../llm/index.js';

vi.mock('../../repo/model.js', () => ({
  listModelsByProvider: vi.fn(),
  getModel: vi.fn(),
  createModel: vi.fn(),
  updateModel: vi.fn(),
  deleteModel: vi.fn(),
  setModelVisionCapability: vi.fn(),
  clearModelVisionCapability: vi.fn(),
}));
vi.mock('../../repo/provider.js', () => ({
  getProvider: vi.fn(),
}));
vi.mock('../../capability/probe.js', () => ({
  probeVisionByChat: vi.fn(),
}));
vi.mock('../../capability/resolve.js', () => ({
  resolveAndPersistVision: vi.fn(),
}));

import { getModel, setModelVisionCapability, clearModelVisionCapability } from '../../repo/model.js';
import { getProvider } from '../../repo/provider.js';
import { probeVisionByChat } from '../../capability/probe.js';
import { resolveAndPersistVision } from '../../capability/resolve.js';

type ApiResponse = {
  code: number;
  msg: string;
  data: Record<string, unknown>;
};

function createTestApp() {
  const app = new Hono();
  app.onError(errorMiddleware());
  app.route('/models', modelCapabilitiesApp);
  return app;
}

function mockModel(over: Partial<Model> = {}): Model {
  return {
    id: 'm1',
    providerId: 'p1',
    name: 'deepseek-flash',
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
}

function mockProvider(over: Partial<Provider> = {}): Provider {
  return {
    id: 'p1',
    name: 'P',
    type: 'openai',
    baseUrl: 'https://api.example.com/v1',
    apiKey: '',
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
}

describe('modelCapabilities routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /:id/probe-vision', () => {
    it('returns 404 when the model does not exist', async () => {
      vi.mocked(getModel).mockReturnValue(undefined);

      const app = createTestApp();
      const res = await app.request('/models/m1/probe-vision', { method: 'POST' });
      expect(res.status).toBe(404);
    });

    it('returns 404 when the provider is missing', async () => {
      vi.mocked(getModel).mockReturnValue(mockModel());
      vi.mocked(getProvider).mockReturnValue(undefined);

      const app = createTestApp();
      const res = await app.request('/models/m1/probe-vision', { method: 'POST' });
      expect(res.status).toBe(404);
    });

    it('skips and reports locked=true when manual lock is set (不写库不发请求)', async () => {
      vi.mocked(getModel).mockReturnValue(
        mockModel({ capabilities: { vision: 'no', sources: { vision: 'manual' } } }),
      );
      vi.mocked(getProvider).mockReturnValue(mockProvider());

      const app = createTestApp();
      const res = await app.request('/models/m1/probe-vision', { method: 'POST' });
      expect(res.status).toBe(200);
      const body = (await res.json()) as ApiResponse;
      const probe = body.data.probe as { method: string; vision: string; locked: boolean };
      expect(probe).toMatchObject({ method: 'skipped', vision: 'no', locked: true });
      expect(probeVisionByChat).not.toHaveBeenCalled();
      expect(setModelVisionCapability).not.toHaveBeenCalled();
    });

    it('ollama provider → resolveAndPersistVision (/api/show), method=provider-show', async () => {
      const updated = mockModel({
        capabilities: { vision: 'yes', sources: { vision: 'provider' } },
      });
      vi.mocked(getModel).mockReturnValue(mockModel());
      vi.mocked(getProvider).mockReturnValue(mockProvider({ type: 'ollama' }));
      vi.mocked(resolveAndPersistVision).mockResolvedValue(updated);

      const app = createTestApp();
      const res = await app.request('/models/m1/probe-vision', { method: 'POST' });
      expect(res.status).toBe(200);
      const body = (await res.json()) as ApiResponse;
      expect(body.data.model).toEqual(updated);
      expect(body.data.probe).toMatchObject({
        method: 'provider-show',
        vision: 'yes',
        source: 'provider',
      });
      expect(vi.mocked(resolveAndPersistVision).mock.calls[0][0].id).toBe('m1');
      expect(probeVisionByChat).not.toHaveBeenCalled();
    });

    it('openai provider + successful chat probe → writes yes with source=probe', async () => {
      const updated = mockModel({
        capabilities: { vision: 'yes', sources: { vision: 'probe' } },
      });
      vi.mocked(getModel).mockReturnValue(mockModel());
      vi.mocked(getProvider).mockReturnValue(mockProvider());
      vi.mocked(probeVisionByChat).mockResolvedValue('yes');
      vi.mocked(setModelVisionCapability).mockReturnValue(updated);

      const app = createTestApp();
      const res = await app.request('/models/m1/probe-vision', { method: 'POST' });
      expect(res.status).toBe(200);
      const body = (await res.json()) as ApiResponse;
      expect(body.data.model).toEqual(updated);
      expect(body.data.probe).toMatchObject({ method: 'chat', vision: 'yes', source: 'probe' });
      expect(setModelVisionCapability).toHaveBeenCalledWith('m1', 'yes', 'probe');
    });

    it('openai provider + capability 400 → writes no with source=probe and 200', async () => {
      const updated = mockModel({
        capabilities: { vision: 'no', sources: { vision: 'probe' } },
      });
      vi.mocked(getModel).mockReturnValue(mockModel());
      vi.mocked(getProvider).mockReturnValue(mockProvider());
      vi.mocked(probeVisionByChat).mockRejectedValue(
        new ProviderError(
          'OpenAI request failed: Invalid content type. image_url is only supported by vision models.',
          400,
        ),
      );
      vi.mocked(setModelVisionCapability).mockReturnValue(updated);

      const app = createTestApp();
      const res = await app.request('/models/m1/probe-vision', { method: 'POST' });
      expect(res.status).toBe(200);
      const body = (await res.json()) as ApiResponse;
      expect(body.data.probe).toMatchObject({ method: 'chat', vision: 'no', source: 'probe' });
      expect((body.data.probe as { message?: string }).message).toContain('Invalid content type');
      expect(setModelVisionCapability).toHaveBeenCalledWith('m1', 'no', 'probe');
    });

    it('openai provider + network error → 502, no capability write', async () => {
      vi.mocked(getModel).mockReturnValue(mockModel());
      vi.mocked(getProvider).mockReturnValue(mockProvider());
      vi.mocked(probeVisionByChat).mockRejectedValue(
        new ProviderError('Failed to connect to OpenAI API: ECONNREFUSED', 502),
      );

      const app = createTestApp();
      const res = await app.request('/models/m1/probe-vision', { method: 'POST' });
      expect(res.status).toBe(502);
      const body = (await res.json()) as ApiResponse;
      expect(body.msg).toContain('ECONNREFUSED');
      expect(setModelVisionCapability).not.toHaveBeenCalled();
    });
  });

  describe('PATCH /:id/capabilities', () => {
    it('sets manual capability (vision=yes)', async () => {
      const updated = mockModel({
        capabilities: { vision: 'yes', sources: { vision: 'manual' } },
      });
      vi.mocked(setModelVisionCapability).mockReturnValue(updated);

      const app = createTestApp();
      const res = await app.request('/models/m1/capabilities', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vision: 'yes' }),
      });
      expect(res.status).toBe(200);
      expect(setModelVisionCapability).toHaveBeenCalledWith('m1', 'yes', 'manual');
      const body = (await res.json()) as ApiResponse;
      expect(body.data).toEqual(updated);
    });

    it('clears the manual lock (vision=null)', async () => {
      const updated = mockModel();
      vi.mocked(clearModelVisionCapability).mockReturnValue(updated);

      const app = createTestApp();
      const res = await app.request('/models/m1/capabilities', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vision: null }),
      });
      expect(res.status).toBe(200);
      expect(clearModelVisionCapability).toHaveBeenCalledWith('m1');
    });

    it('returns 400 for invalid vision values', async () => {
      const app = createTestApp();
      const res = await app.request('/models/m1/capabilities', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vision: 'maybe' }),
      });
      expect(res.status).toBe(400);
    });

    it('returns 404 when the repo reports missing', async () => {
      vi.mocked(setModelVisionCapability).mockReturnValue(undefined);

      const app = createTestApp();
      const res = await app.request('/models/m1/capabilities', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vision: 'yes' }),
      });
      expect(res.status).toBe(404);
    });
  });
});
```

Run: `pnpm --filter server exec vitest run src/routes/__tests__/modelCapabilities.test.ts`
Expected: FAIL（`modelCapabilitiesApp` 未导出，import 报错）

- [ ] **Step 5.6: 实现路由**

`apps/server/src/routes/models.ts`：

1. import 区替换/追加为：

```ts
import { Hono } from 'hono';
import {
  listModelsByProvider,
  getModel,
  createModel,
  updateModel,
  deleteModel,
  setModelVisionCapability,
  clearModelVisionCapability,
} from '../repo/model.js';
import { getProvider } from '../repo/provider.js';
import { successResponse } from '../utils/response.js';
import { HttpError } from '../middleware/error.js';
import { ProviderError } from '../llm/index.js';
import { probeVisionByChat } from '../capability/probe.js';
import { resolveAndPersistVision } from '../capability/resolve.js';
import { isVisionCapabilityError } from '../capability/classify.js';
import type { CreateModelParams, ProbeVisionResponse } from '@my-copilot/shared';
```

2. 文件末尾（既有 `modelsApp.delete('/:id', ...)` 之后）追加：

```ts
// ---------------------------------------------------------------------------
// Model capability endpoints — 挂载于 /api/models（见 index.ts）：
//   POST  /:id/probe-vision   设置页"测试图片输入"（设计 L4）
//   PATCH /:id/capabilities   手动设置/清除能力（source=manual 锁）
// ---------------------------------------------------------------------------

export const modelCapabilitiesApp = new Hono();

modelCapabilitiesApp.post('/:id/probe-vision', async (c) => {
  const id = c.req.param('id');
  const model = getModel(id);
  if (!model) {
    throw new HttpError(404, 'Model not found');
  }
  const provider = getProvider(model.providerId);
  if (!provider) {
    throw new HttpError(404, 'Provider not found');
  }

  // manual 锁：手动是最终仲裁，探测不覆盖（locked 标记供 UI 提示）。
  if (model.capabilities?.sources?.vision === 'manual') {
    const payload: ProbeVisionResponse = {
      model,
      probe: {
        method: 'skipped',
        vision: model.capabilities.vision ?? 'unknown',
        source: 'manual',
        locked: true,
      },
    };
    return successResponse(c, payload);
  }

  // ollama：provider 原生 /api/show 即确定性判定（chat 消息格式不支持 content array）。
  if (provider.type === 'ollama') {
    const updated = (await resolveAndPersistVision(model, provider)) ?? model;
    const caps = updated.capabilities;
    const payload: ProbeVisionResponse = {
      model: updated,
      probe: {
        method: 'provider-show',
        vision: caps?.vision ?? 'unknown',
        ...(caps?.sources?.vision ? { source: caps.sources.vision } : {}),
      },
    };
    return successResponse(c, payload);
  }

  // openai 兼容：真实小图请求（设计 L4"测试图片输入"）。
  try {
    await probeVisionByChat(provider, model.name);
    const updated = setModelVisionCapability(id, 'yes', 'probe') ?? model;
    const payload: ProbeVisionResponse = {
      model: updated,
      probe: { method: 'chat', vision: 'yes', source: 'probe' },
    };
    return successResponse(c, payload);
  } catch (err) {
    if (
      err instanceof ProviderError &&
      isVisionCapabilityError({ statusCode: err.statusCode, message: err.message, details: err.details })
    ) {
      const updated = setModelVisionCapability(id, 'no', 'probe') ?? model;
      const payload: ProbeVisionResponse = {
        model: updated,
        probe: { method: 'chat', vision: 'no', source: 'probe', message: err.message },
      };
      return successResponse(c, payload);
    }
    throw new HttpError(502, `探测失败：${err instanceof Error ? err.message : String(err)}`);
  }
});

modelCapabilitiesApp.patch('/:id/capabilities', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{ vision: 'yes' | 'no' | null }>();

  if (body.vision !== 'yes' && body.vision !== 'no' && body.vision !== null) {
    throw new HttpError(400, "vision must be 'yes', 'no' or null");
  }

  const updated =
    body.vision === null
      ? clearModelVisionCapability(id)
      : setModelVisionCapability(id, body.vision, 'manual');
  if (!updated) {
    throw new HttpError(404, 'Model not found');
  }
  return successResponse(c, updated);
});
```

3. `apps/server/src/index.ts`：

import 区（`modelsApp` import 之后）加：

```ts
import { modelCapabilitiesApp } from './routes/models.js';
```

在 `app.get('/api/models', ...)` 内联路由（第 94-97 行）之后加挂载：

```ts
// Model capability endpoints（probe / manual set）— 与上方内联 GET /api/models 不冲突
app.route('/api/models', modelCapabilitiesApp);
```

- [ ] **Step 5.7: 运行确认通过 + 路由回归**

Run: `pnpm --filter server exec vitest run src/routes/__tests__/modelCapabilities.test.ts src/routes/__tests__/models.test.ts`
Expected: 全部 PASS（新 11 用例 + 既有 models 路由零回归）

- [ ] **Step 5.8: Commit**

```bash
git add apps/server/src/capability/probe.ts apps/server/src/capability/__tests__/probe.test.ts apps/server/src/routes/models.ts apps/server/src/routes/__tests__/modelCapabilities.test.ts apps/server/src/index.ts
git commit -m "feat(server): POST /api/models/:id/probe-vision and PATCH /api/models/:id/capabilities"
```

---

### Task 6: Web API 客户端 + 能力标签工具

**Files:**
- Modify: `apps/web/src/api/real.ts`（Model APIs 区块追加两个函数）
- Create: `apps/web/src/utils/capability.ts`
- Create: `apps/web/src/utils/capability.test.ts`

**前置确认:** `api/index.ts` barrel 为 `import * as real from './real'; export const api = real;`——real.ts 新函数自动经 `api.*` 可用，barrel 零改动。

- [ ] **Step 6.1: real.ts 追加 API 函数**

`apps/web/src/api/real.ts`：

1. 文件顶部 shared 类型 import 补 `ProbeVisionResponse`：

```ts
import type {
  Session, SessionSummary, CreateSessionParams,
  Provider, CreateProviderParams, Model, CreateModelParams,
  Message,
  AuthInfo,
  Tool, UpdateToolParams,
  SkillMeta, SkillDetail, CreateSkillParams, UpdateSkillParams,
  Mcp, CreateMcpParams, UpdateMcpParams, McpConfig, TestMcpConfigResult,
  PluginRecord, PluginLifecycleEvent,
  ProbeVisionResponse,
} from '@my-copilot/shared';
```

2. Model APIs 区块（`deleteModel` 之后）追加：

```ts
/**
 * Probe model vision capability with a tiny real image request
 * POST /api/models/:id/probe-vision
 *
 * 服务端探测超时 20s，客户端放宽到 45s 容纳排队与代理。
 */
export async function probeModelVision(id: string): Promise<ProbeVisionResponse> {
    const response = await enhancedFetch<{ data: ProbeVisionResponse }>(`/api/models/${id}/probe-vision`, {
        method: 'POST',
        timeout: 45000,
    });
    return response.data;
}

/**
 * Manually set / clear model vision capability (writes the source=manual lock)
 * PATCH /api/models/:id/capabilities — vision: 'yes' | 'no' | null（null = 清除，回到 unknown）
 */
export async function setModelVision(id: string, vision: 'yes' | 'no' | null): Promise<Model> {
    const response = await enhancedFetch<{ data: Model }>(`/api/models/${id}/capabilities`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vision }),
        timeout: 30000,
    });
    return response.data;
}
```

- [ ] **Step 6.2: 写失败测试（标签工具）**

创建 `apps/web/src/utils/capability.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import type { ModelCapabilities } from '@my-copilot/shared';
import { describeVisionCapability, VISION_SOURCE_LABELS, VISION_STATE_LABELS } from './capability';

describe('describeVisionCapability', () => {
  it('defaults to unknown with no source label', () => {
    expect(describeVisionCapability(undefined)).toEqual({ vision: 'unknown', source: undefined, label: '未知' });
    expect(describeVisionCapability({})).toEqual({ vision: 'unknown', source: undefined, label: '未知' });
  });

  it('combines state and source labels', () => {
    const caps: ModelCapabilities = { vision: 'yes', sources: { vision: 'probe' } };
    expect(describeVisionCapability(caps)).toEqual({
      vision: 'yes',
      source: 'probe',
      label: '支持·探测',
    });
  });

  it('covers every source with a Chinese label', () => {
    expect(describeVisionCapability({ vision: 'yes', sources: { vision: 'manual' } }).label).toBe('支持·手动');
    expect(describeVisionCapability({ vision: 'yes', sources: { vision: 'catalog' } }).label).toBe('支持·目录');
    expect(describeVisionCapability({ vision: 'yes', sources: { vision: 'provider' } }).label).toBe('支持·服务方');
    expect(describeVisionCapability({ vision: 'no', sources: { vision: 'probe' } }).label).toBe('不支持·探测');
  });

  it('exposes complete label maps', () => {
    expect(VISION_STATE_LABELS).toEqual({ yes: '支持', no: '不支持', unknown: '未知' });
    expect(VISION_SOURCE_LABELS).toEqual({ manual: '手动', probe: '探测', catalog: '目录', provider: '服务方' });
  });
});
```

- [ ] **Step 6.3: 运行确认失败**

Run: `pnpm --filter web exec vitest run src/utils/capability.test.ts`
Expected: FAIL（module not found）

- [ ] **Step 6.4: 实现 capability.ts**

创建 `apps/web/src/utils/capability.ts`：

```ts
import type { CapabilitySource, CapabilityState, ModelCapabilities } from '@my-copilot/shared'

/** 来源徽标文案（设计 UX 章节的手动/探测/目录/未知；provider 来源细化为"服务方"）。 */
export const VISION_SOURCE_LABELS: Record<CapabilitySource, string> = {
  manual: '手动',
  probe: '探测',
  catalog: '目录',
  provider: '服务方',
}

/** 三态文案。 */
export const VISION_STATE_LABELS: Record<CapabilityState, string> = {
  yes: '支持',
  no: '不支持',
  unknown: '未知',
}

export interface VisionCapabilityInfo {
  vision: CapabilityState
  source?: CapabilitySource
  /** 组合徽标文案，如 "支持·探测"；无来源时仅状态词（"未知"）。 */
  label: string
}

/** 从 ModelCapabilities 派生三态 + 来源 + 徽标文案（缺省 = unknown）。 */
export function describeVisionCapability(caps: ModelCapabilities | undefined): VisionCapabilityInfo {
  const vision = caps?.vision ?? 'unknown'
  const source = caps?.sources?.vision
  const label = source ? `${VISION_STATE_LABELS[vision]}·${VISION_SOURCE_LABELS[source]}` : VISION_STATE_LABELS[vision]
  return { vision, source, label }
}
```

- [ ] **Step 6.5: 运行确认通过 + 类型检查**

Run: `pnpm --filter web exec vitest run src/utils/capability.test.ts && pnpm --filter web exec tsc --noEmit`
Expected: PASS

- [ ] **Step 6.6: Commit**

```bash
git add apps/web/src/api/real.ts apps/web/src/utils/capability.ts apps/web/src/utils/capability.test.ts
git commit -m "feat(web): capability API client and vision label helpers"
```

---

### Task 7: 设置页模型行 —— 徽标 / 探测按钮 / 手动覆盖

**Files:**
- Modify: `apps/web/src/views/settings/ProviderDetailPage.tsx`
- Create: `apps/web/src/views/settings/ProviderDetailPage.test.tsx`

**说明:** 设计 UX："设置页模型行'测试图片输入'"（探测按钮）+ "能力值可查看来源徽标（手动/探测/目录/未知），用户可将猜测升格为 manual"。徽标与三态下拉均落在 `ProviderDetailPage` 的模型行内（该页即模型列表编辑入口，`provider.type` 可用于按钮提示）。样式 token 以 `index.css` 实际为准，可微调；测试断言以文本为准。

- [ ] **Step 7.1: 写失败测试**

创建 `apps/web/src/views/settings/ProviderDetailPage.test.tsx`：

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { Model, Provider } from '@my-copilot/shared';
import { ProviderDetailPage } from './ProviderDetailPage';

vi.mock('../../api', () => ({
  api: {
    fetchProvider: vi.fn(),
    fetchModelsByProvider: vi.fn(),
    createModel: vi.fn(),
    updateModel: vi.fn(),
    deleteModel: vi.fn(),
    probeModelVision: vi.fn(),
    setModelVision: vi.fn(),
  },
}));
vi.mock('../../components/common/Alert/alertUtils', () => ({
  showMessageAlert: { success: vi.fn(), error: vi.fn() },
}));

import { api } from '../../api';
import { showMessageAlert } from '../../components/common/Alert/alertUtils';

const provider: Provider = {
  id: 'p1',
  name: 'DeepSeek',
  type: 'openai',
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: 'sk-x',
  enabled: true,
  createdAt: 1,
  updatedAt: 1,
};

function makeModel(over: Partial<Model> = {}): Model {
  return {
    id: 'm1',
    providerId: 'p1',
    name: 'deepseek-flash',
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
}

function renderPage(models: Model[]) {
  vi.mocked(api.fetchProvider).mockResolvedValue(provider);
  vi.mocked(api.fetchModelsByProvider).mockResolvedValue(models);
  return render(
    <MemoryRouter initialEntries={['/providers/p1']}>
      <Routes>
        <Route path="/providers/:id" element={<ProviderDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ProviderDetailPage vision capability UI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the vision badge with state and source label', async () => {
    renderPage([
      makeModel({ capabilities: { vision: 'yes', sources: { vision: 'probe' } } }),
    ]);
    expect(await screen.findByText('图片 支持·探测')).toBeTruthy();
  });

  it('renders 未知 badge for models without capability records', async () => {
    renderPage([makeModel()]);
    expect(await screen.findByText('图片 未知')).toBeTruthy();
  });

  it('probe button calls api.probeModelVision and refreshes the row', async () => {
    renderPage([makeModel()]);
    const probed = makeModel({
      capabilities: { vision: 'yes', sources: { vision: 'probe' }, probedAt: 2 },
    });
    vi.mocked(api.probeModelVision).mockResolvedValue({
      model: probed,
      probe: { method: 'chat', vision: 'yes', source: 'probe' },
    });

    fireEvent.click(await screen.findByText('测试图片输入'));

    await waitFor(() => {
      expect(api.probeModelVision).toHaveBeenCalledWith('m1');
      expect(screen.getByText('图片 支持·探测')).toBeTruthy();
    });
    expect(showMessageAlert.success).toHaveBeenCalledWith('探测成功：该模型支持图片输入');
  });

  it('probe result locked=true explains the manual lock', async () => {
    renderPage([
      makeModel({ capabilities: { vision: 'no', sources: { vision: 'manual' } } }),
    ]);
    vi.mocked(api.probeModelVision).mockResolvedValue({
      model: makeModel({ capabilities: { vision: 'no', sources: { vision: 'manual' } } }),
      probe: { method: 'skipped', vision: 'no', source: 'manual', locked: true },
    });

    fireEvent.click(await screen.findByText('测试图片输入'));

    await waitFor(() => {
      expect(showMessageAlert.error).toHaveBeenCalledWith(
        expect.stringContaining('手动锁定'),
      );
    });
  });

  it('selecting 支持 writes manual capability via api.setModelVision', async () => {
    renderPage([makeModel()]);
    vi.mocked(api.setModelVision).mockResolvedValue(
      makeModel({ capabilities: { vision: 'yes', sources: { vision: 'manual' } } }),
    );

    const select = await screen.findByLabelText('deepseek-flash 图片输入能力');
    fireEvent.change(select, { target: { value: 'yes' } });

    await waitFor(() => {
      expect(api.setModelVision).toHaveBeenCalledWith('m1', 'yes');
      expect(screen.getByText('图片 支持·手动')).toBeTruthy();
    });
  });

  it('selecting 未知 clears the manual lock (null)', async () => {
    renderPage([
      makeModel({ capabilities: { vision: 'no', sources: { vision: 'manual' } } }),
    ]);
    vi.mocked(api.setModelVision).mockResolvedValue(makeModel());

    const select = await screen.findByLabelText('deepseek-flash 图片输入能力');
    fireEvent.change(select, { target: { value: 'unknown' } });

    await waitFor(() => {
      expect(api.setModelVision).toHaveBeenCalledWith('m1', null);
      expect(screen.getByText('图片 未知')).toBeTruthy();
    });
  });
});
```

- [ ] **Step 7.2: 运行确认失败**

Run: `pnpm --filter web exec vitest run src/views/settings/ProviderDetailPage.test.tsx`
Expected: FAIL（找不到"测试图片输入"按钮 / 徽标文本）

- [ ] **Step 7.3: 扩展 ProviderDetailPage**

`apps/web/src/views/settings/ProviderDetailPage.tsx` 修改点：

1. import 区调整：

```tsx
import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import type { Provider, Model, ModelCapabilities } from '@my-copilot/shared'
import { api } from '../../api'
import { describeVisionCapability } from '../../utils/capability'
import ModelFormModal from '../../components/ModelFormModal'
import { ProviderTypeBadge, StatusBadge } from '../../components/common/Badge'
import { showMessageAlert } from '../../components/common/Alert/alertUtils'
```

2. state 区追加：

```tsx
  const [probingId, setProbingId] = useState<string | null>(null)
```

3. 处理函数（`handleDelete` 之后）：

```tsx
  const handleProbe = async (model: Model) => {
    setProbingId(model.id)
    try {
      const { model: updated, probe } = await api.probeModelVision(model.id)
      setModels((prev) => prev.map((m) => (m.id === updated.id ? updated : m)))
      if (probe.locked) {
        showMessageAlert.error('该模型能力已被手动锁定；如需改判，请先将"图片输入"选为"未知"清除锁定')
      } else if (probe.vision === 'yes') {
        showMessageAlert.success('探测成功：该模型支持图片输入')
      } else if (probe.vision === 'no') {
        showMessageAlert.success('探测完成：该模型不支持图片输入（已记录）')
      } else {
        showMessageAlert.success('探测完成：未能确定（保持未知）')
      }
    } catch (error) {
      console.error('Failed to probe vision capability:', error)
      showMessageAlert.error(error instanceof Error ? error.message : '探测失败')
    } finally {
      setProbingId(null)
    }
  }

  const handleVisionChange = async (model: Model, vision: 'yes' | 'no' | 'unknown') => {
    try {
      const updated = await api.setModelVision(model.id, vision === 'unknown' ? null : vision)
      setModels((prev) => prev.map((m) => (m.id === updated.id ? updated : m)))
      showMessageAlert.success(vision === 'unknown' ? '已清除能力设置（回到未知）' : '已手动设置；此后不再被自动反写覆盖')
    } catch (error) {
      console.error('Failed to set vision capability:', error)
      showMessageAlert.error('设置失败')
    }
  }
```

4. 模型行 `<StatusBadge enabled={model.enabled} />` 之后追加徽标：

```tsx
                  <VisionBadge capabilities={model.capabilities} />
```

5. 模型行右侧按钮组（"编辑"按钮之前）追加探测按钮与手动下拉：

```tsx
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleProbe(model)}
                    disabled={probingId === model.id}
                    title={provider.type === 'ollama' ? '经 Ollama /api/show 查询原生能力信息' : '向该模型发送一张小图实测图片输入'}
                    className="px-3 py-1.5 text-xs bg-bg-secondary border border-border-base text-text-primary rounded-lg hover:border-primary-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {probingId === model.id ? '探测中…' : '测试图片输入'}
                  </button>
                  <select
                    aria-label={`${model.name} 图片输入能力`}
                    value={describeVisionCapability(model.capabilities).vision}
                    onChange={(e) => handleVisionChange(model, e.target.value as 'yes' | 'no' | 'unknown')}
                    title="手动设置后成为最终判定，不再被自动反写覆盖；选「未知」清除设置"
                    className="px-2 py-1.5 text-xs bg-bg-secondary border border-border-base text-text-primary rounded-lg"
                  >
                    <option value="unknown">图片输入：未知</option>
                    <option value="yes">图片输入：支持</option>
                    <option value="no">图片输入：不支持</option>
                  </select>
                  <button
                    onClick={() => handleEdit(model)}
                    className="px-3 py-1.5 text-xs bg-bg-primary border border-border-base text-text-primary rounded-lg hover:bg-bg-hover transition-colors"
                  >
                    编辑
                  </button>
                  <button
                    onClick={() => handleDelete(model.id)}
                    className="px-3 py-1.5 text-xs bg-error-50 border border-error-200 text-error-600 rounded-lg hover:bg-error-100"
                  >
                    删除
                  </button>
                </div>
```

6. 文件底部（组件外）追加徽标子组件：

```tsx
/** 图片输入能力徽标：三态 × 来源（手动/探测/目录/服务方；未知无来源）。 */
function VisionBadge({ capabilities }: { capabilities?: ModelCapabilities }) {
  const { vision, label } = describeVisionCapability(capabilities)
  const tone =
    vision === 'yes'
      ? 'text-primary-600 bg-bg-secondary border-primary-200'
      : vision === 'no'
        ? 'text-text-tertiary bg-bg-secondary border-border-base'
        : 'text-text-secondary bg-bg-secondary border-border-base'
  return (
    <span className={`px-2 py-0.5 text-xs rounded-full border ${tone}`}>
      图片 {label}
    </span>
  )
}
```

⚠️ 样式 token（`primary-200` 等）以 `apps/web/src/index.css` 实际 token 为准，可等价替换；测试断言只依赖文本（`图片 支持·探测` 等）。

- [ ] **Step 7.4: 运行确认通过**

Run: `pnpm --filter web exec vitest run src/views/settings/ProviderDetailPage.test.tsx`
Expected: PASS（6 个用例）

- [ ] **Step 7.5: web 回归 + 类型检查**

Run: `pnpm --filter web exec vitest run src/views/settings && pnpm --filter web exec tsc --noEmit`
Expected: 全部 PASS（含既有 settings 页面测试零回归）

- [ ] **Step 7.6: Commit**

```bash
git add apps/web/src/views/settings/ProviderDetailPage.tsx apps/web/src/views/settings/ProviderDetailPage.test.tsx
git commit -m "feat(web): model row vision badge, probe button and manual override"
```

---

### Task 8: useModelVisionCapability hook（供 Sender 门控消费）

**Files:**
- Create: `apps/web/src/components/Sender/hooks/useModelVisionCapability.ts`
- Create: `apps/web/src/components/Sender/hooks/useModelVisionCapability.test.ts`

**说明:** hooks 归属组件目录（web 约定），Sender 是设计指定的消费方。**Sender 侧三段式 UX（事前置灰 / 事中警告 / 事后转译）本计划不接线**——其数据前提（图片 parts 出站）由附件资产层计划（A）提供，标记前置；本任务只交付数据 + 动作入口。

- [ ] **Step 8.1: 写失败测试**

创建 `apps/web/src/components/Sender/hooks/useModelVisionCapability.test.ts`：

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { Model } from '@my-copilot/shared';
import { useModelVisionCapability } from './useModelVisionCapability';

vi.mock('../../../api', () => ({
  api: {
    probeModelVision: vi.fn(),
    setModelVision: vi.fn(),
  },
}));

import { api } from '../../../api';

function makeModel(over: Partial<Model> = {}): Model {
  return {
    id: 'm1',
    providerId: 'p1',
    name: 'deepseek-flash',
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
}

describe('useModelVisionCapability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('derives unknown for models without records', () => {
    const { result } = renderHook(() => useModelVisionCapability(makeModel()));
    expect(result.current.vision).toBe('unknown');
    expect(result.current.source).toBeUndefined();
    expect(result.current.label).toBe('未知');
  });

  it('derives state and source labels from stored capabilities', () => {
    const { result } = renderHook(() =>
      useModelVisionCapability(
        makeModel({ capabilities: { vision: 'no', sources: { vision: 'manual' } } }),
      ),
    );
    expect(result.current.vision).toBe('no');
    expect(result.current.source).toBe('manual');
    expect(result.current.label).toBe('不支持·手动');
  });

  it('probe() snapshots the server-returned model and tracks pending state', async () => {
    const { result } = renderHook(() => useModelVisionCapability(makeModel()));
    const probed = makeModel({
      capabilities: { vision: 'yes', sources: { vision: 'probe' }, probedAt: 5 },
    });
    let resolveProbe: (value: {
      model: Model;
      probe: { method: 'chat'; vision: 'yes'; source: 'probe' };
    }) => void = () => {};
    vi.mocked(api.probeModelVision).mockReturnValue(
      new Promise((resolve) => {
        resolveProbe = resolve;
      }) as ReturnType<typeof api.probeModelVision>,
    );

    let pending: Promise<unknown> | undefined;
    act(() => {
      pending = result.current.probe();
    });
    expect(result.current.isProbing).toBe(true);

    await act(async () => {
      resolveProbe({ model: probed, probe: { method: 'chat', vision: 'yes', source: 'probe' } });
      await pending;
    });

    expect(result.current.isProbing).toBe(false);
    expect(result.current.vision).toBe('yes');
    expect(result.current.source).toBe('probe');
    expect(result.current.label).toBe('支持·探测');
  });

  it('setVision() snapshots the manually-set model', async () => {
    const { result } = renderHook(() => useModelVisionCapability(makeModel()));
    vi.mocked(api.setModelVision).mockResolvedValue(
      makeModel({ capabilities: { vision: 'no', sources: { vision: 'manual' } } }),
    );

    await act(async () => {
      await result.current.setVision('no');
    });

    expect(api.setModelVision).toHaveBeenCalledWith('m1', 'no');
    expect(result.current.vision).toBe('no');
    expect(result.current.source).toBe('manual');
  });

  it('switching to another model discards the stale snapshot', async () => {
    const initial = makeModel();
    const { result, rerender } = renderHook(({ model }) => useModelVisionCapability(model), {
      initialProps: { model: initial },
    });

    // 先产生一份探测快照
    const probed = makeModel({
      capabilities: { vision: 'yes', sources: { vision: 'probe' } },
    });
    vi.mocked(api.probeModelVision).mockResolvedValue({
      model: probed,
      probe: { method: 'chat', vision: 'yes', source: 'probe' },
    });
    await act(async () => {
      await result.current.probe();
    });
    expect(result.current.vision).toBe('yes');

    // 切换模型（id 变化）→ 快照失效，回到新模型自身的记录
    const other = makeModel({ id: 'm2', name: 'other-model' });
    rerender({ model: other });

    expect(result.current.model?.id).toBe('m2');
    expect(result.current.vision).toBe('unknown');
  });
});
```

- [ ] **Step 8.2: 运行确认失败**

Run: `pnpm --filter web exec vitest run src/components/Sender/hooks/useModelVisionCapability.test.ts`
Expected: FAIL（module not found）

- [ ] **Step 8.3: 实现 hook**

创建 `apps/web/src/components/Sender/hooks/useModelVisionCapability.ts`：

```ts
import { useCallback, useMemo, useState } from 'react'
import { api } from '../../../api'
import { describeVisionCapability } from '../../../utils/capability'
import type { CapabilitySource, CapabilityState, Model } from '@my-copilot/shared'

export type { VisionCapabilityInfo } from '../../../utils/capability'

export type SetVisionValue = 'yes' | 'no' | null

/**
 * 模型图片输入能力的消费入口（设计"UX 三段式防御"的数据源）。
 *
 * 传入当前生效模型（DIY agent 链路上为最终生效模型——设计"与现有系统的咬合"），
 * 返回三态/来源/徽标文案与两个动作；动作成功后本地快照服务端返回的最新 Model，
 * 外部切换模型（id 变化）时快照自动失效。
 *
 * Sender 侧门控（事前置灰/事中警告/事后提示）由附件资产层计划（A）接线，本 hook
 * 只负责数据与动作。
 */
export function useModelVisionCapability(model: Model | undefined) {
  const [snapshot, setSnapshot] = useState<Model | null>(null)
  const [isProbing, setIsProbing] = useState(false)

  const effective = snapshot && model && snapshot.id === model.id ? snapshot : model
  const info = useMemo(() => describeVisionCapability(effective?.capabilities), [effective])

  const probe = useCallback(async () => {
    if (!effective) throw new Error('No model selected')
    setIsProbing(true)
    try {
      const { model: updated } = await api.probeModelVision(effective.id)
      setSnapshot(updated)
      return updated
    } finally {
      setIsProbing(false)
    }
  }, [effective])

  const setVision = useCallback(async (vision: SetVisionValue) => {
    if (!effective) throw new Error('No model selected')
    const updated = await api.setModelVision(effective.id, vision)
    setSnapshot(updated)
    return updated
  }, [effective])

  return {
    model: effective,
    vision: info.vision,
    source: info.source,
    label: info.label,
    isProbing,
    probe,
    setVision,
  }
}
```

- [ ] **Step 8.4: 运行确认通过**

Run: `pnpm --filter web exec vitest run src/components/Sender/hooks/useModelVisionCapability.test.ts`
Expected: PASS（5 个用例）

- [ ] **Step 8.5: web 全量回归 + 类型检查**

Run: `pnpm --filter web test && pnpm --filter web exec tsc --noEmit`
Expected: 全部 PASS

- [ ] **Step 8.6: Commit**

```bash
git add apps/web/src/components/Sender/hooks/useModelVisionCapability.ts apps/web/src/components/Sender/hooks/useModelVisionCapability.test.ts
git commit -m "feat(web): useModelVisionCapability hook for sender-side vision gating"
```

---

### Task 9: 学习闭环接线（前置：附件资产层计划 A 已执行）

> **⚠️ 前置条件：`docs/2026-09-30-attachment-assets-multimodal-plan.md` 已执行完毕。**
> 本任务读取 `userMessage.parts`（`MessagePart`，A 计划所有）并要求 job payload 携带 `modelId`——A 落地前本任务无法通过类型检查。若 A 未执行，跳过本任务并在执行记录中备注"A 落地后补做"。
>
> A 落地时的对接点（写入 A 的协调记录）：`streamMessageHandler` 异步分支的 `createJob` payload 需含 `modelId: model.id` 与当轮 `parts`；`Message` shared 类型含 `parts?: MessagePart[]`。

**Files:**
- Modify: `apps/server/src/agent-loop/runner.ts`（错误结果保留原始错误对象）
- Modify: `apps/server/src/streaming/lifecycle.ts`（同步路径接线）
- Modify: `apps/server/src/jobs/worker.ts`（异步路径接线）
- Test: `apps/server/src/streaming/__tests__/lifecycle.test.ts`（追加用例）

**说明:** `runAgentLoop` 的 catch 会把 `ProviderError` stringify 成 `result.error: string`（`runner.ts:756-779`），学习闭环需要对象上的 `statusCode + errorCode` 才能做"仅 400 + 能力性"判定，故先给 `AgentLoopResult` 的 error 分支加 `cause`。反写全部经 `setModelVisionCapability`（manual 锁 + 幂等由 repo 保证）。

- [ ] **Step 9.1: 写失败测试（lifecycle 学习闭环）**

在 `apps/server/src/streaming/__tests__/lifecycle.test.ts` 追加（沿用该文件既有的 mock 结构与 `streamMessageHandler` 调用方式；`repo/model.js` 的 mock 需补 `setModelVisionCapability: vi.fn()`）。核心用例：

```ts
  it('成功出站含 image part 且 vision 非 yes → 反写 yes (source=probe)', async () => {
    // userMessage 带 image part（A 落地后的 Message.parts 形态）
    vi.mocked(getModel).mockReturnValue(mockModelOf('m1')); // 学习闭环取 model.id
    // ... 按 lifecycle.test.ts 既有夹具构造 streamMessageHandler 调用：
    // model.capabilities 为 undefined（unknown），userMessage.parts = [{ type: 'image', assetId: 'a1' }]
    // runAgentLoop mock 返回 { status: 'completed', content: 'ok', messages: [] }

    await runHandler();

    expect(setModelVisionCapability).toHaveBeenCalledWith('m1', 'yes', 'probe');
  });

  it('能力性 400（errorCode=capability_vision_unsupported）→ 反写 no', async () => {
    // runAgentLoop mock 返回 {
    //   status: 'error', content: '', messages: [],
    //   error: 'OpenAI request failed: Invalid content type...',
    //   cause: new ProviderError('...', 400, undefined, CAPABILITY_VISION_UNSUPPORTED),
    // }
    await runHandler();

    expect(setModelVisionCapability).toHaveBeenCalledWith('m1', 'no', 'probe');
  });

  it('非能力性错误（429 限流）不反写', async () => {
    // cause: new ProviderError('Rate limited', 429)
    await runHandler();

    expect(setModelVisionCapability).not.toHaveBeenCalled();
  });

  it('manual 锁模型成功出站不覆盖（repo 锁兜底，调用层仍会尝试）', async () => {
    // model.capabilities = { vision: 'no', sources: { vision: 'manual' } }，成功出站
    await runHandler();

    // 调用层按设计条件（vision !== 'yes'）发起写入，repo 锁拒绝：
    expect(setModelVisionCapability).toHaveBeenCalledWith('m1', 'yes', 'probe');
    // 真实 repo 会原样返回 manual 记录（Task 2 用例已锁定），此处只锁调用层语义。
  });
```

⚠️ `runHandler` / `mockModelOf` 等夹具按 `lifecycle.test.ts` 既有 setup 对齐（该文件已有 streamMessageHandler 的测试管线）；`runAgentLoop` 的 mock 返回值按其真实 mock 方式注入。若该文件通过真实 `streamSSE` 驱动，改用其既有的"收集 SSE 终态事件"断言方式。**用例语义以上述四条断言为准。**

- [ ] **Step 9.2: 运行确认失败**

Run: `pnpm --filter server exec vitest run src/streaming/__tests__/lifecycle.test.ts`
Expected: 新用例 FAIL（`setModelVisionCapability` 未被调用 / `cause` 字段不存在）

- [ ] **Step 9.3: runner.ts 错误结果保留 cause**

`apps/server/src/agent-loop/runner.ts`：

1. `AgentLoopResult` 接口（第 68-80 行）加一个字段：

```ts
export interface AgentLoopResult {
  status: AgentLoopStatus;
  content: string;
  messages: Message[];
  /** Populated when status === 'error'. */
  error?: string;
  /** 原始错误对象（如 ProviderError）——stringify 丢失的 statusCode/errorCode 供消费方判定。 */
  cause?: unknown;
}
```

2. catch 分支的 error 返回值（第 774-779 行）加 `cause: err`：

```ts
    return {
      status: 'error',
      content: lastIterationContent,
      messages: addedMessages,
      error: message,
      cause: err,
    };
```

- [ ] **Step 9.4: lifecycle.ts 同步路径接线**

`apps/server/src/streaming/lifecycle.ts`：

1. import 区追加：

```ts
import { setModelVisionCapability } from '../repo/model.js';
import { CAPABILITY_VISION_UNSUPPORTED } from '../capability/classify.js';
```

（`ProviderError` 经 `getAdapter` 所在的 `../llm/index.js` 补入：`import { getAdapter, ProviderError } from '../llm/index.js';`）

2. `const result = await runAgentLoop({...});` 之后、标题自动生成之前插入：

```ts
      // ─── 学习闭环（设计 docs/2026-09-30-model-capability-design.md）───
      // 出站含 image part 时，用真实请求成败反写能力记录；manual 锁与幂等由
      // repo 层 setModelVisionCapability 保证。
      const outboundHasImage = (userMessage.parts ?? []).some((p) => p.type === 'image');
      if (outboundHasImage) {
        if (result.status === 'error') {
          const cause = result.cause;
          if (
            cause instanceof ProviderError &&
            cause.statusCode === 400 &&
            cause.errorCode === CAPABILITY_VISION_UNSUPPORTED
          ) {
            // 仅 HTTP 400 + 能力性错误降 no；网络/鉴权/限流一律不反写
            setModelVisionCapability(model.id, 'no', 'probe');
          }
        } else if (result.status !== 'aborted' && model.capabilities?.vision !== 'yes') {
          // 成功（completed / length_limited / max_iterations 均证明 provider 接受了图片）
          setModelVisionCapability(model.id, 'yes', 'probe');
        }
      }
```

- [ ] **Step 9.5: worker.ts 异步路径接线**

`apps/server/src/jobs/worker.ts` 的 `registerAgentLoopHandler` 内（A 计划为 job payload 增加 `modelId` 与当轮 `parts` 后）：

1. `AgentLoopJobPayload` 接口补两个 A 计划引入的字段（若 A 已在其计划中定义则以其为准）：

```ts
  /** 学习闭环：最终生效模型（streamMessageHandler 写入）。 */
  modelId?: string;
  /** 当轮 user 消息的 content parts（附件资产层管道）。 */
  parts?: MessagePart[];
```

（`MessagePart` 自 `@my-copilot/shared` import type。）

2. handler 内 `runAgentLoopAsJob(...)` 调用改为接收结果并接线（与 lifecycle 同语义）：

```ts
  const result = await runAgentLoopAsJob(/* 既有参数不变 */);

  // ─── 学习闭环（异步链路，与 lifecycle 同语义）───
  const outboundHasImage = (payload.parts ?? []).some((p) => p.type === 'image');
  if (outboundHasImage && payload.modelId) {
    if (result.status === 'error') {
      const cause = result.cause;
      if (
        cause instanceof ProviderError &&
        cause.statusCode === 400 &&
        cause.errorCode === CAPABILITY_VISION_UNSUPPORTED
      ) {
        setModelVisionCapability(payload.modelId, 'no', 'probe');
      }
    } else if (result.status !== 'aborted') {
      setModelVisionCapability(payload.modelId, 'yes', 'probe');
    }
  }
  return result;
```

（`setModelVisionCapability` / `CAPABILITY_VISION_UNSUPPORTED` / `ProviderError` 的 import 同 Step 9.4；异步分支的 "vision 非 yes 才升" 判定因 payload 无 model 对象而省略——repo 幂等分支已覆盖"已是 yes"的场景。）

- [ ] **Step 9.6: 运行确认通过**

Run: `pnpm --filter server exec vitest run src/streaming/__tests__/lifecycle.test.ts src/agent-loop`
Expected: 全部 PASS（lifecycle 新 4 用例 + agent-loop 既有套件零回归——`cause` 为可选新增字段）

- [ ] **Step 9.7: Commit**

```bash
git add apps/server/src/agent-loop/runner.ts apps/server/src/streaming/lifecycle.ts apps/server/src/jobs/worker.ts apps/server/src/streaming/__tests__/lifecycle.test.ts
git commit -m "feat(server): learning loop — write vision outcomes from real request success/failure"
```

---

### Task 10: 全量验证 + 文档收尾

- [ ] **Step 10.1: 全仓类型检查 + 全部测试 + lint**

Run: `pnpm typecheck`
Expected: PASS

Run: `pnpm --filter shared test && pnpm --filter server test && pnpm --filter web test`
Expected: 全部 PASS（重点关注 `capability/`、`repo/model`、`routes/models`、`llm/`、`ProviderDetailPage`、`Sender/hooks`）

Run: `pnpm lint`
Expected: PASS

- [ ] **Step 10.2: 手动验收（可选但推荐）**

Run: `pnpm dev`
验收清单：
1. 设置 → Provider 详情 → openai 类型模型行：徽标显示 `图片 未知` → 点"测试图片输入" → 几秒后变 `图片 支持·探测` 或 `图片 不支持·探测`（用一个已知不支持图片的模型验证 no 路径）
2. 同页把"图片输入"下拉选"支持" → 徽标变 `图片 支持·手动` → 再点探测 → 提示"已被手动锁定"且徽标不变
3. 下拉选"未知" → 清除锁定 → 探测可再次写入
4. ollama 类型 Provider 的模型行：点探测 → 徽标变 `图片 支持·服务方`（对应 /api/show 结果；`llava`/`qwen*-vl` 模型也可验证 catalog 路径）
5. DB 抽查：`sqlite3 apps/server/data/my-copilot.db "SELECT name, capabilities FROM models"` 确认 JSON 形态与 `probedAt`
6. 断网或填错 baseUrl 后探测 → toast 显示"探测失败：…"，徽标保持不变（网络错误不反写）

- [ ] **Step 10.3: 更新设计文档状态**

`docs/2026-09-30-model-capability-design.md` 头部状态行改为：

```markdown
**状态：** 已实施（实施计划 `docs/2026-09-30-model-capability-plan.md`；学习闭环接线以附件资产层计划执行为前置）
```

- [ ] **Step 10.4: README 能力说明（一句）**

`README.md` "模型与服务配置" 小节的列表末尾追加一行：

```markdown
- **模型能力探测**：模型带三态图片输入能力标记（支持/不支持/未知）与来源（手动/探测/目录/服务方）；设置页可一键发送小图实测，日常带图请求的成败会自动修正记录。
```

- [ ] **Step 10.5: Commit**

```bash
git add docs/2026-09-30-model-capability-design.md docs/2026-09-30-model-capability-plan.md README.md
git commit -m "docs: mark model capability design as implemented and note README"
```

---

## 规格覆盖自查（写给执行者）

| 设计文档条目 | 任务 |
|---|---|
| 数据模型：`models.capabilities` JSON 列（存量 `'{}'` = 全 unknown） | Task 2（迁移 0009） |
| Shared 类型 `CapabilityState` / `CapabilitySource` / `ModelCapabilities` | Task 1 |
| 解析算法：manual > provider > catalog > unknown 四层 | Task 3（`resolveVisionCapability`）；ollama 分支复用于 Task 5 |
| provider 层：ollama `POST /api/show` 读 `capabilities`；明确不含 → 保持 catalog 判定 | Task 3（`fetchOllamaShowCapabilities` + 决策逻辑） |
| `/api/tags` families 弱信号（设计标注"可选"） | **不做**（宁缺毋滥，见"明确不在本计划内"） |
| catalog 规则表（packages/shared，随版本发布） | Task 1（`VISION_CATALOG_RULES`） |
| 学习闭环：成功升 yes / 400 能力性降 no / 网络/鉴权/限流不反写 | Task 9（前置 A；repo 锁 Task 2；分类器 Task 4） |
| 错误分类器落 adapter 层，输出稳定错误码（对齐 PluginLifecycleError.errorCode） | Task 4（`CAPABILITY_VISION_UNSUPPORTED`） |
| 探测按钮 L4（v1 纳入，用户已确认）："测试图片输入"，写 source=probe | Task 5（端点）+ Task 7（UI）；ollama 类型细化走 provider 层（source=provider，见关键设计决策） |
| 手动编辑写 source=manual，永不被自动反写覆盖 | Task 2（repo 强制）+ Task 5（PATCH 端点）+ Task 7（下拉） |
| UX 徽标（手动/探测/目录/未知） | Task 6（标签工具；provider 来源细化"服务方"）+ Task 7 |
| UX 三段式防御（事前/事中/事后）的数据消费方 | Task 8（`useModelVisionCapability`）；Sender 接线归 A/D 计划（前置） |
| unknown 允许发送（隐式探测） | 出口组装行为，归 A 计划（其门控消费本计划交付的 `resolveVisionCapability`） |
| 与 DIY agent 咬合（能力取自最终生效模型） | Task 8（hook 以 `Model` 对象为入参，由调用方传最终生效模型） |
| 开放问题 1（L4 进 v1） | 已决策：进（Task 5/7） |
| 开放问题 2（catalog 随版本 vs 热更新） | 已决策：随版本（Task 1 常量表） |
| 开放问题 3（ollama show 批量 vs 惰性） | 已决策：惰性 + 5 分钟 TTL 缓存（Task 3） |

**明确不在本计划内（防执行者顺手实现）:**
- Sender 三段式 UX 接线（事前置灰 + tooltip / 事中三选警告条 / 事后错误转译与建议模型）——前置附件资产层计划（A）与前端消费计划，消费本计划的 `useModelVisionCapability`
- `MessagePart` / `AttachmentMeta.assetId` / `assets` 表 / 出口图片组装（含 `ChatMessage.content` 的正式 content-parts 类型化）——A 计划所有
- `/api/tags` `details.families` 弱信号探测（设计标注可选）
- OpenRouter / LM Studio 按 baseUrl 特判（设计非目标：它们经 openai 类型 provider 时与标准端点无异）
- tool_use / audio 等其他能力的探测（`capabilities` 结构已预留扩展位）
- 后台自动全模型扫描、远端能力目录热更新（设计非目标）
- 修复 web `updateModel` / `deleteModel` 扁平路径 404 的既有问题（见头部"已知既有问题"，另行任务）
