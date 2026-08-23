# Context Management v2

> 状态：**Proposal** · 负责团队：server/prompt · 依赖：Agent Loop v2（`RunContext`）
> 范围：定义 MyCopilot 如何在单次运行和跨会话之间组装、预算、降级并持久化提交给 OpenAI 兼容 LLM 的上下文。

## 动机

当前的上下文流水线（`apps/server/src/prompt/`）在短对话中工作良好，但随着产品向消费级 agent 演进，暴露出三个关键限制：

1. **单一全局预算，无隔离。** `truncateHistory` 仅维护一个 `maxTokens` 数字，并优先丢弃最早的链。系统提示、工具、skills、附件和当前用户轮次共享这一个总额。当附件或工具输出膨胀时，系统会悄悄占用历史或当前轮次的预算，并且没有一等公民位置用于工具输出塑形。
2. **单一策略，硬编码。** 截断是唯一的策略。summarizer 已经存在（`summarizer.ts`），但仅由双阈值自动触发（`CONTEXT_SUMMARIZE_THRESHOLD=30000` tokens 且 `MIN_MESSAGES_TO_SUMMARIZE=5` 条消息，两者均在 `runner.ts` 中检查）。没有可插拔的策略槽位用于 head-tail preserve、anchor preserve 或基于重要性加权的选择。
3. **无跨会话记忆。** `message_summaries` 只汇总单个会话。在一个会话中学习到的用户偏好、事实和实体关系，在用户打开新会话时就会丢失，这是消费级产品的决定性缺口。

本 RFC 定义一个预算化、多策略、缓存感知、记忆支撑的上下文层，它保留现有模块作为可选基线，并保持在 `apps/server/src/AGENTS.md` 所要求的扁平函数式模块风格内。

## 目标

- 定义一个**五桶 token 预算**，每个桶有独立的配额和超预算行为，加上预留的 headroom。
- 定义一个**策略注册表**（sliding window、sliding window + summary、head-tail preserve、anchor preserve、importance preserve），具有明确的输入/输出契约和触发条件。现有的 truncator 和 summarizer 是默认策略。
- 规范 **Prompt Caching** 集成（`cache_control` 放置、粒度、命中率指导），适用于 Anthropic ephemeral 和 OpenAI implicit 缓存。
- 规范一个**跨会话记忆**层，持久化到 SQLite，具有检索协议和到插件 `plugin_data` 存储的桥接（决策 A5）。
- 将**附件**从 `.md/.txt/.csv/.docx` 扩展到 PDF、image（vision）、code snippet 和 audio（transcription），统一在一个 envelope 之下。
- 规范当一个桶超出预算时触发的**降级链**。
- 定义由 `assembleMessages()` 返回、被 Agent Loop v2 消费的 **`RunContext` 契约**。

## 非目标

以下内容明确不在本 RFC 范围内，合规实现不得引入：

- **向量数据库 / RAG 基础设施。** 不引入 embeddings 索引、ANN 存储、检索增强生成流水线。记忆检索是关键词 + 元数据过滤的 SQL（见 ADR-3）。未来的独立 RFC 可重新评估。
- **微调 / 训练流水线。** 不收集数据集、不更新模型权重、不进行 per-user adapter 训练。本 RFC 只重塑 prompt。
- **替换现有模块。** `truncator.ts`、`summarizer.ts`、`token-counter.ts` 和 `assembler.ts` 保留。v2 包装它们，不分叉。
- **`messages` 的 per-message TTL 或垃圾回收。** 记忆层只添加行；不删除聊天历史。
- **多模态输出生成。** 附件可携带图像输入，但本 RFC 不规范模型产生 image/audio *输出*。

## 规范

下文所有百分比都是该运行**模型上下文窗口**（`contextWindowTokens`，从所选模型解析）的比例。绝对 token 数在组装时推导；只配置比率。

### 1. 五桶预算模型（Five-Bucket Budget Model）

组装后的上下文被划分为五个功能桶加上预留的 headroom。每个桶有自己的配额和自己的超预算策略，因此失控的工具输出永远不会悄悄删除用户的工作轮次。

| 桶（Bucket） | 份额 | 内容 | 超预算策略 |
| --- | --- | --- | --- |
| `system` | 5-10% | 默认系统提示 + 注入的 skills + persona | `error`（绝不悄悄丢弃） |
| `tools` | 10-20% | LLM 调用的工具 schema（`tools` 数组） | `drop` 最久未用的工具 |
| `history` | 30-40% | 之前的轮次 + 汇总的 summary 消息 | 委派给活动策略（§2） |
| `toolOutputs` | 25-35% | 本次运行中工具调用的结果 | `truncate`（对每个输出做尾部截断） |
| `working` | 10-15% | 当前用户轮次 + 解析后的附件 | `error`（该轮次不可妥协） |
| `headroom` | 5-10% | 为框架 token、角色标签、回复空间预留 | 永不分配 |

形式化结构：见 `docs/rfc/context-management-v2.schema.json` 中的 `BudgetConfig` 以及 `docs/rfc/types/context-management-v2.d.ts` 中匹配的类型。六行的份额总和必须为 1.0；除非被 `modelContextWindow` 策略显式覆盖，否则组装会拒绝份额落在上述每行范围之外的配置。

分配图：`docs/rfc/diagrams/context-management-v2.mmd`，图 `budget-allocation`。

### 2. 多策略调度（Multi-Strategy Scheduling）

策略是可插拔的。每次运行只有一个策略处于活动状态，从 session config → agent preset → 全局默认（`sliding-window`）解析。每个策略实现一个契约：

```text
interface ContextStrategy {
  name: StrategyName;
  select(input: StrategyInput): StrategyOutput;
}
```

`StrategyInput` 携带分桶后的消息列表、`history` 配额、最新的 `MessageSummary` 边界以及 token 估算器。`StrategyOutput` 返回保留的消息、丢弃计数以及一个可选的 `summaryRequested` 标志，由 assembler 转换为一次 summarizer 调用。

| 策略（Strategy） | 触发条件 | 行为 | 映射到现有代码 |
| --- | --- | --- | --- |
| `sliding-window` | 默认；短会话 | 在配额内保留最近 N 个链 | `truncateHistory` |
| `sliding-window-summary` | `history` 桶超配额且 summary 可用 | 前置持久化的 summary，然后对尾部做 sliding-window | `truncateHistory` + `assembleMessages` 中的 `summary` 注入 |
| `head-tail-preserve` | 长文档问答，首条用户消息是任务规格 | 始终保留首条用户轮次 + 近期尾部，丢弃中间 | 对 `truncateHistory` 的新包装 |
| `anchor-preserve` | 标记为 `anchor: true`（置顶）的轮次 | 保留所有 anchor + 近期尾部 | 新增 |
| `importance-preserve` | 有大量工具调用的 agent 运行 | 按 recency × 工具引用计数打分，保留 top-K | 新增 |

summarizer 仍然由 `runner.ts` 中已有的双阈值自动触发（`DEFAULT_SUMMARY_THRESHOLD=30000` 且 `MIN_MESSAGES_TO_SUMMARIZE=5`）；策略只*消费* summary，不改变触发器。一个策略 MAY 设置 `summaryRequested` 来请求 assembler 在带外触发一次 summary，但 runner 阈值仍是后台 summarize 的真值来源。

### 3. Prompt Caching 适配

通过现有的 OpenAI 兼容客户端支持两家 provider：

- **Anthropic ephemeral cache**：assembler 在每个*稳定*前缀的最后一条消息上标记 `cache_control: {type: "ephemeral"}`。稳定前缀按顺序为：`system` 桶、`tools` 桶、汇总的 `summary` 系统消息。至多放置四个断点（Anthropic 每请求上限），优先级 system → tools → summary。
- **OpenAI implicit cache**：无显式标记；assembler 只保证稳定前缀以确定的字节序输出（无时间戳漂移、无重新排序的 skills），从而命中 provider 的自动前缀缓存。

缓存粒度是**桶级**的，绝不按消息，因此一次用户轮次的变更至多使 `history` 和 `working` 桶失效。命中率通过以下方式优化：(a) 上游按 `createdAt` 对 skills 排序（已完成），(b) 将 summary 作为稳定的系统消息输出（已在 `assembler.ts` 中完成），(c) 永不将易变的工具输出交错进缓存前缀。

形式化字段：schema 和类型文件中的 `CacheControlConfig`。

### 4. 记忆持久化（跨会话）

记忆是穿越会话边界存活下来的层。它**不是**向量存储；它是 SQLite 中通过关键词和元数据检索的结构化行。

**存储。** 一张新的 `memories` 表，与 `message_summaries` 同级：

```sql
CREATE TABLE IF NOT EXISTS memories (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  kind          TEXT NOT NULL,           -- preference | fact | entity_relation
  content       TEXT NOT NULL,
  entities      TEXT NOT NULL DEFAULT '[]', -- JSON array of entity names
  source_session_id TEXT,
  confidence    REAL NOT NULL DEFAULT 0.5,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX idx_memories_user_kind ON memories(user_id, kind);
CREATE INDEX idx_memories_entities ON memories(entities);
```

这遵循 `repo/summary.ts` 中的仓库约定（每个单元一行、扁平模块、无 `services/` 层）。由新的 `repo/memory.ts` 拥有。

**类型（Kinds）。**

- `preference` — 持久的用户偏好（"用中文回复"、"prefer tabs"）。
- `fact` — 关于世界或用户的单句事实。
- `entity_relation` — 一个三元组，在 `content` 中编码为 `subject | relation | object`，`entities` 列出节点以便快速过滤。

**检索协议。** 在组装时，assembler 运行一个从当前用户轮次派生的 `memoryQuery`：按空白分词，针对该用户的记忆语料按 IDF 风格加权取 top-K 关键词，然后在 `content` 和 `entities` 上运行基于 `LIKE` 的 SQL 扫描，按 `user_id` 和 `kind` 过滤。检索到的记忆作为 `system` 桶内的一条 `system` 消息注入，受该桶配额约束。无 embeddings、无向量索引。

**与插件的桥接。** 根据决策 A5，插件获得一个由 `plugin_data(plugin_id, key, value)` 支撑的 `plugin.store` API。记忆层是*系统拥有*的等价物：它由 assembler 在没有插件上下文的情况下读取，但实现 `Memory Backends` 扩展点（MAY EP，A3）的插件 MAY 注册一个包装相同 `memories` 行的自定义 retriever。

### 5. 附件增强

当前解析器（`attachment/parser.ts`）处理 `.md`、`.txt`、`.csv`、`.docx`。v2 在一个 envelope 之下新增四种类型，使预算层统一对待所有附件。

| 类型（Kind） | MIME / 扩展名 | 解析器 | 预算计费 |
| --- | --- | --- | --- |
| `text` / `markdown` / `csv` | `.txt` `.md` `.csv` | utf-8 读取（现有） | 内容的 token 数 |
| `docx` | `.docx` | `mammoth`（现有） | 内容的 token 数 |
| `pdf` | `.pdf` | 文本层提取（范围内不做 OCR） | 内容的 token 数 |
| `image` | `image/*` | 字节透传 → vision `image_url` 块 | 每张图像固定 `imageTokenCost` |
| `code` | `.ts` `.js` `.py` `.go` `.rs` ... | utf-8 读取 + 围栏渲染 | 内容的 token 数 |
| `audio` | `audio/*` | 通过配置的 provider 转录（无本地模型） | 转录文本的 token 数 |

每个附件在到达预算层之前都被包装进 `AttachmentEnvelope`（见 schema/types）。envelope 携带 `kind`、`name`、`mimeType`、估算的 `tokens`，以及 `content`（文本类型）、`imageDataUrl`（图像）或 `transcript`（音频）三者之一。解析器保持 fail-soft：它返回一个 `AttachmentParseResult` 且永不抛出，匹配 `apps/server/src/AGENTS.md` 中记录的契约。每附件上限保持为 `MAX_ATTACHMENT_SIZE_MB`（默认 10）；新类型只改变解析后内容的塑形方式，不改变上传限制。

### 6. Token 预算耗尽降级链

当应用桶配额后组装的上下文仍超过 `contextWindowTokens - headroom` 时，assembler 按以下顺序运行降级链。每级有一个触发阈值，以超出量的比例表示。

1. **Sliding window。** 触发：`history` 桶超配额任意数量。丢弃最旧的非 anchor 链直到在配额内。（默认策略；level 0。）
2. **Summary。** 触发：步骤 1 不足 *或* `summaryRequested` 已设置。通过 `summarizeHistory`（fail-soft，30s 超时，无工具）生成被丢弃前缀的 summary 并作为系统消息注入。通过 `createSummary` 持久化。
3. **工具输出截断。** 触发：`toolOutputs` 桶超配额。将每个工具结果尾部截断到 `toolOutputMaxTokens`（默认 1500）并追加 `[truncated]` 标记。工具调用 ↔ 工具结果链必须保持完整（`truncateHistory` 中的现有不变量）。
4. **错误返回。** 触发：步骤 1-3 之后运行仍放不下，*或* `system` / `working` 桶超配额。assembler 返回一个 `status: "context_overflow"` 且无 `messages` 的 `RunContext`；Agent Loop v2 将其呈现给用户而不是发送一个畸形的请求。

流程图：`docs/rfc/diagrams/context-management-v2.mmd`，图 `degradation-chain`。

### 7. 与 Agent Loop v2 的接口契约

`assembleMessages()` 被扩展为返回 `RunContext` 而不是裸 `ChatMessage[]`。`RunContext` 由 Agent Loop v2 RFC（并行任务 T2）权威定义；本 RFC 只约束它*必须*携带的字段，以便上下文层和循环达成一致：

```text
interface RunContext {
  messages: ChatMessage[];          // the assembled, budgeted message list
  tools: ToolSchema[];              // tools advertised to the LLM
  cacheControl: CacheBreakpoint[];  // §3 breakpoints, possibly empty
  budget: BudgetUsage;              // per-bucket tokens actually spent
  status: "ok" | "context_overflow";
  meta: { strategy: StrategyName; dropped: number; summaryUsed: boolean };
}
```

Agent Loop v2 RFC 拥有完整的 `RunContext` 形状；上下文层必须填充上述字段，MAY 不添加任何字段。现有 `assembleMessages` 签名保留为一个薄包装，它调用 v2 路径并只返回 `.messages`，为尚未迁移的调用方保留向后兼容。

## 概念映射（现有 → 新）

| 现有模块 | v2 角色 |
| --- | --- |
| `prompt/token-counter.ts`（`estimateMessagesTokens`，chars/4） | 不变；被每个策略和桶复用。 |
| `prompt/truncator.ts`（`truncateHistory`） | 包装为 `sliding-window` 策略。 |
| `prompt/summarizer.ts`（`summarizeHistory`，fail-soft，无工具） | 不变；由 `summary` 降级级和 `sliding-window-summary` 策略调用。 |
| `prompt/assembler.ts`（`assembleMessages`） | 扩展：返回 `RunContext`，应用桶配额，放置缓存断点，查询记忆。旧调用形态作为包装保留。 |
| `attachment/parser.ts`（text/docx） | 在 `AttachmentEnvelope` 之后扩展 `pdf`/`image`/`code`/`audio` 类型；fail-soft 契约不变。 |
| `repo/summary.ts`（`message_summaries`） | 不变；记忆邻近 summary 注入的一个数据源。 |
| `runner.ts` 双阈值 summarizer 触发器 | 不变；仍是*何时* summarize 的真值来源。策略只消费。 |
| `repo/message.ts` | 不变；v2 只读，绝不修改消息历史。 |

## 一致性（Conformance）

当且仅当以下全部成立时，一个实现符合本 RFC：

- 合规实现必须计算并强制执行六个独立的 token 配额（C1 — 五个桶 + headroom）；超出一个桶必须不得悄悄减少另一个桶，除非通过 §6 中的显式降级链。
- 合规实现必须在任何策略或降级步骤中保持每条 assistant 工具调用消息与其 `tool` 结果相连（C2），匹配 `truncateHistory` 已强制的不变量。
- 合规实现必须在 assembler、策略或附件解析器中遇到降级输入时不得抛出（C3）；它返回 `status: "context_overflow"` 或部分的 `AttachmentParseResult`，匹配 `parseAttachment` 上永不抛出的契约。
- 合规实现必须将对记忆的检索表达为针对 `memories` 表的 SQL（C4）；引入 embedding 索引或 ANN 存储违反本 RFC（见非目标和 ADR-3）。
- 合规实现必须至多发出四个 `cache_control` 断点（C5），只放在稳定前缀（system、tools、summary）上，绝不放在工作轮次或工具输出上。
- 合规实现必须保持遗留 `assembleMessages` 参数形态向后兼容（C6）：在不存在 v2 配置时，它产生与 pre-v2 实现字节相同的 `messages`。

## 反例

### 反例：为什么不强制 RAG / 向量数据库

把记忆检索做成 embedding 相似度搜索很诱人，这样 assembler 就能在语义上拉取"最相关的记忆"。本 RFC 出于三个理由拒绝：(a) 这是明确的非目标 — 添加向量索引会拖入一个 embedding 模型、一个 ANN 库以及一个让服务器其余部分相形见绌的重建索引流水线；(b) 对于消费级产品，每个用户的记忆语料很小（数百到数千行），此时 `LIKE` + 关键词加权具有竞争力且完全可通过 SQL 审查；(c) 向量存储把正确性藏在一个相似度黑箱后面，当模型"凭空捏造记忆"时难以调试。这里的记忆是有意设计为结构化的、SQL 可检索的。未来的 RFC 可以在不改变这一基线的情况下，在 `Memory Backends` 扩展点之后添加一个可选 retriever。

### 反例：为什么不使用无界上下文 / 直接发送全部

一些模型现在宣称百万 token 窗口。发送全部内容仍然在每一轮付出延迟、金钱和缓存失效的代价。预算的存在是为了让成本/延迟权衡显式且可配置，而不是为了应对小窗口。

## 架构决策记录（Architecture Decision Records）

### 决策 (ADR-1：五桶预算 vs 单一扁平预算)

**背景。** 遗留 assembler 使用一个在 system、history、attachments 和工作轮次之间共享的 `maxTokens` 数字。

**选项。** (a) 保持单一扁平预算；(b) 划分为具有独立配额的功能桶；(c) 无固定份额的动态优先级队列。

**决策。** (b) 五个功能桶加 headroom。固定份额使成本可预测，并让每个桶独立失败（失控的工具输出截断工具输出，而不是用户的轮次）。

**备选。** (a) 不能隔离失败；(c) 不可测试，并使缓存断点不稳定，因为前缀边界随每次运行漂移。

### 决策 (ADR-2：LLM Summary 优于抽取式 Summary)

**背景。** 当 `history` 桶溢出时，汇总后的前缀可以是抽取式 summary（挑选代表性句子）也可以是 LLM 生成的抽象式 summary。

**选项。** (a) 抽取式 — 按 TF-IDF / TextRank 对句子排序，拼接；(b) 通过配置的 LLM 抽象；(c) 混合。

**决策。** (b) 通过现有 `summarizeHistory` 抽象，该函数已经用固定指令调用 provider 的流式适配器（"Summarize ... 保留关键事实、决策和未决上下文，相同语言"）。

**理由。** 对话轮次不是文档：它们包含共指、决策和工具调用结果，抽取式选择会将其压扁为不连贯的片段。抽象式 summary 可以把"用户请求 X，工具返回 Y，我们商定 Z"压缩成一句抽取式无法形成的话。其代价（一次额外 LLM 调用）只在溢出时支付，是 fail-soft 的（出错返回 `null`，回退到截断），并且已在 `summarizer.ts` 中实现并经过实战检验。

**备选。** (a) 更便宜但失去对话连贯性，并需要一个新依赖（tokenizer 或排序库）；(c) 在该语料规模下，复杂度翻倍只换来边际收益。

### 决策 (ADR-3：SQLite `memories` 表 vs 向量 DB)

**背景。** 跨会话记忆需要一个存储。

**选项。** (a) 带关键词/元数据检索的 SQLite 表；(b) 专用向量 DB（如 sqlite-vss、Chroma）；(c) 外部记忆服务。

**决策。** (a)。在现有 SQLite 数据库中新增一张 `memories` 表，由新的 `repo/memory.ts` 使用 `LIKE` 和 JSON `entities` 过滤读取。

**理由。** 与无向量/RAG 基础设施的非目标一致；复用单数据库约定（`db/index.ts`、`CREATE TABLE IF NOT EXISTS`）；保持数据层可审查；在消费级规模下足够。需要语义检索的插件可以通过 MAY `Memory Backends` 扩展点（A3）提供，而核心不承担该依赖。

**备选。** (b) 违反一个非目标并增加运维负担；(c) 破坏项目 README 中自托管、本地数据的承诺。

## 迁移

迁移是叠加式的、分阶段的，因此服务器永不中断。

1. **阶段 0 — 先落地契约。** 落地 `RunContext`、`BudgetConfig` 以及 schema/types 文件。`assembleMessages` 返回 `RunContext`，但默认配置复现今天的行为（一个有效桶，遗留回退包装保留旧返回形态）。无 DB 变更。
2. **阶段 1 — 策略在开关之后。** 新增策略注册表，由 session config 门控。默认保持 `sliding-window`。`runner.ts` 中的 summarizer 触发器保持不动。
3. **阶段 2 — 记忆表。** 新增迁移 `0004_context_v2_memories.sql` 创建 `memories`。只读；尚无自动记忆抽取。
4. **阶段 3 — 附件类型。** 在 `AttachmentEnvelope` 之后用 PDF/image/code/audio 扩展 `parseAttachment`。旧类型不变。
5. **阶段 4 — 缓存断点。** 在 provider 能力开关之后接入 `cache_control` 放置；对不支持的 provider 为 no-op。

每个阶段都可独立回滚。无任何阶段修改已持久化的行；`messages` 和 `message_summaries` 表是只读消费者。

## 开放问题

1. **记忆抽取触发器。** 何时写入 `memories` 行 — 每次 assistant 轮次之后、会话关闭时，还是仅在显式用户动作（"remember that ..."）时？本 RFC 规范存储和检索；抽取调度推迟到一个后续工作。
2. **Anchor 标记 UX。** `anchor-preserve` 策略需要一种方式把一条轮次标记为 `anchor: true`。那是一个 UI 置顶、一个系统指令，还是一个 agent 决策？此处未指定。
3. **音频转录 provider。** §5 假定有一个配置好的 provider 用于音频转录。该 provider 是复用聊天 provider 还是使用一个专用转录端点，留待后续。
4. **缓存断点遥测。** 我们暴露多少可观测性（命中率、节省的 token），通过哪个现有调试界面？`useDebugStore` hook 已存在，但它在上下文层指标上的契约未定义。

## 参考文献

- `docs/rfc/_current-state-baseline.md` — 已验证的 summarizer、truncator 和安全等级当前行为（T0）。
- `docs/rfc/_architecture-decisions.md` — 决策 A3（扩展点，含 `Memory Backends`）、A5（`plugin_data` 存储）、B6（单循环 + 模式提示）。
- `apps/server/src/prompt/assembler.ts` — `assembleMessages`，本 RFC 扩展的函数。
- `apps/server/src/prompt/truncator.ts` — `truncateHistory`，`sliding-window` 策略的基础。
- `apps/server/src/prompt/summarizer.ts` — `summarizeHistory`，`summary` 降级级的基础。
- `apps/server/src/prompt/token-counter.ts` — `estimateMessagesTokens`，原样复用。
- `apps/server/src/attachment/parser.ts` — `parseAttachment`，在 §5 中扩展。
- `apps/server/src/repo/summary.ts` — `message_summaries` 表和 `summarizedUpToMessageId` 边界。
- `apps/server/src/agent-loop/runner.ts:122-216` — 双阈值 summarizer 触发器，有意保持不变。
- `docs/rfc/context-management-v2.schema.json` — `BudgetConfig`、策略配置、记忆和附件的形式化 JSON Schema。
- `docs/rfc/types/context-management-v2.d.ts` — 同上内容的 TypeScript 类型。
- `docs/rfc/diagrams/context-management-v2.mmd` — 预算分配和降级链图。
