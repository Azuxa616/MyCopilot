# 附件资产层与多模态消息（图片上传）设计

**日期：** 2026-09-30
**状态：** 设计定稿，待用户批准后转入实施计划
**分支：** main
**来源：** 2026-09-30 产品形态讨论（输入框增强 + 双栏内容面板）结论沉淀
**关联文档：** `2026-09-30-model-capability-design.md`（能力门控）、`2026-09-30-content-panel-design.md`（资产预览）、`2026-09-30-input-commands-design.md`（`@file` 引用）、`docs/rfc/context-management-v2.md`（附件信封与历史桶）

## 背景与动机

三个需求——图片上传、`@file` 引用、内容栏文件预览——在数据模型层汇于同一个缺口：**附件目前是"一次性文本原料"，不是持久化资产**。

| # | 现状问题 | 代码级事实 |
|---|---------|-----------|
| 0 | 原始文件用后即弃 | `attachment/parser.ts` 在请求处理中把 Buffer 解析为文本，原始字节不落盘；DB 只留 `AttachmentMeta`（含 `textExcerpt`，上限 200 字） |
| 1 | 附件仅文本管道 | `TEXT_EXTENSIONS = {.md, .txt, .csv}` + mammoth 解析 `.docx`；图片无通道（无 `textExcerpt` 可提取） |
| 2 | 消息模型纯文本 | `messages.content` 为 TEXT string；`attachments` 列为 `AttachmentMeta[]` JSON（`repo/message.ts`） |
| 3 | 无模型能力信息 | `Model` 类型只有 name/enabled 等字段，vision 能力无从判断（另见能力探测设计） |
| 4 | 方向已有预留 | `docs/rfc/types/context-management-v2.d.ts` 的 `AttachmentKind` 已含 `image`/`audio`，`AttachmentEnvelope` 已含 `imageDataUrl`/`transcript` 字段——本设计是该 RFC 预留方向的落地 |

## 目标

1. **资产层**：附件升级为持久化、可引用、可渲染的资产（文件系统存储 + `assets` 表）。
2. **多模态消息**：`Message` 支持 content parts 数组化（方案 B），图片以 `image` part 成为一等消息内容。
3. **图片上传端到端**：前端三入口（按钮/拖拽/粘贴）→ 资产落盘 → LLM 请求以 OpenAI 兼容 `image_url` block 发送。
4. **历史图片保留策略**：基于 `detail` 字段的分级降级，控制多轮对话中图片的 token 成本。

## 非目标

- 不实现音频/视频上传（仅在 part 类型中预留位）
- 不引入 workspace / 项目实体（沿用 skill-system-upgrade 设计的决策，多项目需求出现再评估）
- 不做 OCR / 图片描述生成等降级服务
- 不对接 DeepSeek Files API 等大图直通通道（v1 用 base64 内联，见"未来演进"）
- 不做资产删除与 GC（v1 资产只增不删，见"未来演进"）
- `/` 命令与 `@` 引用、内容栏渲染分别在 `input-commands` 与 `content-panel` 设计中定义

## 决策记录（用户已确认）

| 决策点 | 结论 | 备选与理由 |
|--------|------|-----------|
| 附件存储 | **文件系统**（`DATA_DIR/attachments/<assetId>`），DB 只存元数据；现有文本类附件一并改造 | SQLite blob 会膨胀 DB 且备份困难；大二进制放文件系统是自托管场景惯例 |
| 图片消息形态 | **方案 B：content parts 数组化** | 方案 A（出口展开，`content` 保持 string）改动面更小，被否——用户拍板直接做语义正确的形态；风险通过"content 纯文本投影"机制消解（见下） |
| 图片发送编码 | base64 `data:` URL 内联（OpenAI 兼容 `image_url` block） | 外部 URL 需要图片可公网访问，自托管场景不成立；Files API 是 DeepSeek 专有扩展 |
| 历史图片策略 | `detail` 分级：当轮原图、历史轮降 `low`、超 N 轮替换占位文本 | `detail: low` 由 provider 端缩放（DeepSeek 缩至 512×512、单图 token 封顶 1024），协议原生支持，无需自建缩放管线 |
| 旧数据处理 | **不迁移**——存量消息保持 excerpt-only 卡片 | 存量 `AttachmentMeta` 无 assetId、原始文件已不存在，无物可迁；新消息走新管道 |

## 数据模型

### 新表 `assets`

```sql
CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  kind TEXT NOT NULL,             -- 对齐 context-management-v2 的 AttachmentKind：text|markdown|csv|docx|pdf|image|code（audio 预留）
  sha256 TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'upload',  -- 'upload' | 'agent' | 'plugin'（后两者预留）
  created_at INTEGER NOT NULL,    -- Date.now()，对齐 repo/base.ts now()
  updated_at INTEGER NOT NULL
);
```

原始字节写 `DATA_DIR/attachments/<id>`（无扩展名，mime 在 DB）。`sha256` 落库（秒传去重是"未来演进"，v1 仅记录）。

### Shared 类型

```ts
/** 多模态消息内容块。 */
export type MessagePart =
  | { type: 'text'; text: string }
  | { type: 'image'; assetId: string; detail?: 'low' | 'high' | 'original' | 'auto' };
// 预留：| { type: 'audio'; assetId: string; transcript?: string }

/** 附件元数据升级：新增资产引用（旧数据无此字段）。 */
export interface AttachmentMeta {
  id?: string;
  assetId?: string;   // 新增：指向 assets 表
  name: string;
  type: string;
  size: number;
  textExcerpt?: string;
}
```

### `messages` 表加列

```sql
ALTER TABLE messages ADD COLUMN parts TEXT;  -- JSON MessagePart[]，NULL = 旧消息或纯文本
```

### content 与 parts 的关系（核心设计）

**`content` 永远维护为 `parts` 的纯文本投影**：文本 part 依序拼接，非文本 part 替换为占位符（如 `[图片: 文件名]`）。写入路径单向：有 parts 的消息，content 由 parts 派生，不独立编辑。

这一条把方案 B 的风险面从"所有消费方适配二态"收缩为"**仅渲染层适配 parts，其余消费方继续读投影**"：

| 消费点 | 适配策略 |
|--------|---------|
| 消息渲染（MessageCard） | parts 优先（文本 run + 图片直显），content 兜底 |
| 复制 / 导出 | 读投影（图片为占位符） |
| 会话标题生成 / 搜索 / 摘要（T25） | 读投影，零改动 |
| token 估算（estimateMessagesTokens） | 估算器扩展：按 parts 数图片（近似值，开放问题 3） |
| SSE 协议 | `parts` 作为 Message 的可选字段随行序列化，非破坏性 |
| mock 链路（`apps/web/src/types/chat.ts`） | mock 消息无 parts，天然兼容 |
| truncator / history 策略 | 继续操作 `MessageLike.content`（投影）；图片降级在出口层做 detail 改写，不动策略层 |

## 后端行为

### 上传 API

| 路由 | 行为 |
|------|------|
| `POST /api/assets`（multipart） | 校验大小（沿用 `MAX_ATTACHMENT_SIZE_MB`，图片建议独立上限配置）→ 落盘 → 解析 kind → 写 `assets` 表 → 返回 Asset 记录 |
| `GET /api/assets/:id/meta` | 元数据 JSON |
| `GET /api/assets/:id/raw` | 原始字节流（正确 Content-Type + immutable 缓存头；图片缩略图、PDF 预览共用此通道） |

发送消息 API 从 multipart files 改为 JSON（`parts` 引用 assetId）；旧 multipart files 通道保留一个版本周期用于兼容，之后移除。

### parser 扩展

`parseAttachment` 升级为"资产化管道"：按文件内容（魔数）而非仅扩展名判定 kind；文本类（text/markdown/csv/docx/pdf 文本提取）解析出 `AttachmentText` 供注入；image 类只记元信息 + 生成缩略图参数（缩略图为前端 `raw` URL + CSS 缩放，v1 不做服务端缩略图）。

### 发送链路（出口组装，lifecycle 与 jobs/worker 两链路等价）

1. **角色校验**：`image` part 仅允许出现在 `user` 消息（DeepSeek 文档实证：system/assistant 携带图片返回 400；写进发送前校验，不等 provider 报错）
2. **能力门控**：`vision = no` 时按用户选择降级为占位文本（"仍发送"分支）；`unknown` 直发并进入学习闭环（见能力探测设计）
3. **adapter 组装**：`image` part → `{ type: 'image_url', image_url: { url: 'data:<mime>;base64,...', detail } }`；文本附件维持现有 `AttachmentText` 注入
4. **历史图片保留策略**（出口层改写，不动 history 策略层）：

| 图片位置 | 发送行为 |
|---------|---------|
| 当轮 user 消息 | `detail` 保持原值（默认 `auto`/`original`） |
| 历史轮（最近 N 轮内，N 默认 5，可配） | `detail` 强制 `low` |
| 超过 N 轮 | 图片 part 不发送字节，仅投影占位 `[图片: name]` |

本策略需在 `docs/rfc/context-management-v2.md` 补一章"多模态 history 降级"（开放问题 1 确认数值后）。

## 前端行为

- **上传三入口**：附件按钮（现有 FileUploadModal 扩展 accept）+ 拖拽至 Sender 区域 + 剪贴板粘贴图片
- **选择即上传**：Sender 本地附件状态从 `File[]` 改为 Asset 引用（上传失败即 toast，不阻塞文本输入）
- **能力三态联动**：`vision = no` 时图片入口置灰 + 原因提示；`unknown` 时可用 + 弱提示（详见能力探测设计的 UX 三段式）
- **AttachmentCard**：图片显示缩略图；文本类沿用现样式
- **MessageCard**：图片 part 直显（点击 → 内容栏打开资产预览 tab，见 content-panel 设计）
- **useAttachments hook**：管理对象从 `LocalAttachment`（File）切换为 `AssetRef`（assetId + 元数据）

## 与现有系统的咬合

- **context-management-v2 RFC**：`AttachmentEnvelope` 的 `imageDataUrl` 对应本设计的出口 data URL；`AttachmentKind` 直接复用为 `assets.kind`；history 桶新增多模态降级维度
- **模型能力探测设计**：图片入口的门控与学习闭环的唯一数据消费方
- **content-panel 设计**：`GET /api/assets/:id/raw` 是文件预览 tab 的数据源
- **input-commands 设计**：`@file` 引用解析为资产的 parts 注入，复用本设计全部管道

## 开放问题

1. 历史图片保留策略的 N 值与档位（当轮 original / N 轮内 low / 超出占位）——默认 5，待实施前确认
2. 图片单文件上限是否独立于 `MAX_ATTACHMENT_SIZE_MB`（DeepSeek 内联上限 32 MiB/图、48 MiB 请求体，自托管 openai 兼容端点各异）
3. 图片 token 估算精度：按 `detail` 档位取近似常数（low ≈ 上限值，original 按像素估算），还是接入 provider 精确值——建议 v1 近似
4. assets 的 sha256 秒传去重与孤儿清理（GC）何时引入

## 未来演进

- `audio` part（`transcript` 字段已在 Envelope 预留）
- DeepSeek Files API / 大图直通通道（`file_id` block）
- 资产 GC（消息引用计数）与用户资产管理页（`@file` 的个人资产库入口）
- `workspace_id` 列（多项目需求出现时）
