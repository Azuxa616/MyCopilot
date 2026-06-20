# MyCopilot 全栈 Agent 化升级设计文档

> **文档状态**：已通过 brainstorming 评审，待用户最终确认
> **创建日期**：2026-06-20
> **作者**：Azuxa616（与 ZCode 协作设计）
> **适用范围**：将 MyCopilot 从纯前端 Demo 升级为面向个人的全栈 Agent 项目

---

## 0. 背景与目标

### 0.1 项目现状

MyCopilot 当前是一个纯前端 AI 对话应用 Demo（`src/`，47 个 TS/TSX 文件），支持 Mock/Real 双模式。仓库内另有一份全栈版本的构建产物（`packages/`，Hono + SQLite + JWT），但**源码已丢失**，仅保留混淆后的 `dist/` 与 `.d.ts` 类型定义。

### 0.2 升级目标

将项目从纯前端演示，升级为**全栈的、面向个人的、易部署的、可云端异步执行的 Agent 项目**，并预留多客户端（桌面端、移动端）接入能力。

### 0.3 核心设计决策（评审结论）

| 决策点 | 结论 | 理由 |
|--------|------|------|
| 流式通信 | Phase 1 用 SSE（同步流式），Phase 2 引入异步 Job | 先跑通对话，长任务后置 |
| 用户体系 | 单用户 + Token 门禁（参考 OpenClaw） | 个人部署无需多用户 |
| 旧 `packages/` 产物 | 作为设计参考，不直接复用，最终清空 | 多用户 JWT 设计与新需求不符 |
| 新目录结构 | `apps/server`、`apps/web`、`packages/shared`；`src/` 完整迁移至 `apps/web` | API-first，为多客户端铺路 |
| 部署形态 | API-first，server 可选托管静态资源；单容器为默认推荐形态 | 兼顾个人部署简洁与未来多客户端 |
| 附件处理 | 后端解析，文件用完即弃（不落盘、不持久化） | 隐私好、无存储负担 |
| 数据库 | better-sqlite3（原生绑定） | 性能优于 sql.js WASM，为 Phase 2 异步 Job 铺路 |
| 共享类型 | 保留 `packages/shared` 独立包 | 多客户端共享类型契约 |

### 0.4 设计原则

1. **API-first**：server 所有能力通过 REST/SSE 暴露，web 只是"第一个 client"
2. **渐进增强**：每个 Phase 是上一 Phase 的超集，无破坏性重构
3. **单用户假设**：数据模型无 `user_id`，Token 只做访问门禁不做身份区分
4. **YAGNI**：Phase 1 只实现真正需要的，未来需求只"定义概念不实现逻辑"

---

## 1. 三阶段演进总体规划

### 1.1 三阶段 Milestone

**Phase 1 —— 全栈基础架构（本次设计重点）**
- 从纯前端升级为全栈，搭建后端基础架构
- 选定技术栈与工具链，前后端正常通讯
- 支持纯对话（可不用 Agent 工具调用）、多 session 上下文隔离、同 session 多轮参考上下文
- 支持图片理解以外的基础文本附件（md/txt/csv/docx）后端解析
- 提供配置模型 Provider 和 Model 的能力
- **设计 Agent 基础概念定义（tool/skill/system prompt/mcp），但不实现逻辑**

**Phase 2 —— Agent 能力强化（方向性设计）**
- 内置 Tool 执行（function calling）、配置 MCP、用户导入 Skill
- Tool 操作的程序化高风险管控
- 异步 Job 系统（后台执行长任务，断开浏览器仍继续）
- 前端同步提供 Skill/MCP/Tool 配置页
- 升级更合理的 session 上下文管理机制
- 引入 Rule 概念（Phase 1 推迟）

**Phase 3 —— 多 Agent 编排（方向性设计）**
- 新增 Agent 配置页，将 Phase 2 能力作为默认 Agent 能力
- 允许创建自定义 Agent，配置专属 system prompt + skill + mcp
- 不支持同一 session 内多 Agent 对话（一个 session 一个 Agent）
- 验证桌面端/移动端可对接同一 server

### 1.2 架构演进图（文字描述）

整体架构自上而下：
- **多客户端愿景层**：Web、未来桌面端（Tauri）、移动端，共享统一 API 契约
- **API 契约层**：REST + SSE，所有客户端通过此层访问 server
- **server 能力层**：按 Phase 渐进增强
  - Phase 1：Token 门禁 + CORS + SSE + Provider 适配器 + 附件解析
  - Phase 2：叠加异步 Job + Tool 执行 + MCP + Skill + Rule
  - Phase 3：叠加多 Agent 编排
- **数据层**：better-sqlite3（单文件 `*.db`）
- **共享层**：`packages/shared` 定义前后端（及未来桌面/移动端）共享的 TypeScript 类型契约

### 1.3 三阶段在 Agent 概念上的演进

- **Phase 1**：定义概念 + 默认 Agent（纯对话）。Skill/Tool/MCP 字段定义就绪但无实体
- **Phase 2**：实现内置 Tool、MCP 接入、Skill 导入、高风险管控。仍围绕默认 Agent（单 Agent）
- **Phase 3**：多 Agent 上线，用户可创建自定义 Agent 并绑定概念

---

## 2. 总体架构与目录布局

### 2.1 核心设计原则

- **API-first**：server 所有能力都通过 REST/SSE 暴露，web 只是"第一个 client"
- **渐进增强**：每个 Phase 都是上一 Phase 的超集，无破坏性重构
- **单用户假设**：数据模型无 `user_id`，Token 只做访问门禁不做身份区分

### 2.2 Monorepo 目录结构

项目重构为标准的 pnpm workspace monorepo：

**顶层目录**：
- `apps/server/` —— Hono 后端（Phase 1 新建）
- `apps/web/` —— React 前端（从 `src/` 完整迁移）
- `packages/shared/` —— 前后端共享的 TypeScript 类型契约
- `docker/` —— Dockerfile 与 docker-compose.yml
- `docs/` —— 设计文档（本目录）
- `pnpm-workspace.yaml` —— workspace 配置
- `package.json` —— 根 workspace 配置
- `tsconfig.base.json` —— 共享 TS 配置

**`apps/server/` 内部结构**（按职责分层）：
- `src/index.ts` —— 入口：启动 server、挂载中间件、路由
- `src/config.ts` —— 环境变量/配置加载（AUTH_TOKEN 等）
- `src/db/` —— better-sqlite3 初始化、schema、migration
- `src/middleware/` —— tokenAuth、cors、errorHandler
- `src/routes/` —— 路由模块（chat、session、provider、model、health）
- `src/llm/` —— 适配器：BaseAdapter → OpenAI/Ollama
- `src/streaming/` —— SSE 流式：streamChat、SSE 转换
- `src/attachment/` —— 附件解析：md/txt/csv/docx（Phase 1）
- `src/prompt/` —— Prompt 组装：历史消息 + 附件文本
- `src/repo/` —— 数据访问层（session/message/provider/model）
- `public/` —— 可选：生产构建时 web 产物拷贝到此（serveStatic 托管）
- `data/` —— SQLite 数据库文件挂载点（Volume）

**`apps/web/` 内部结构**（从 `src/` 迁移 + 改造）：
- `src/` —— 现有 47 个 .ts/.tsx 文件迁入
  - `api/` —— 改造：移除 Mock，只对接 server
  - `components/` —— 沿用（ChatShell/Asider/Sender/MarkdownRenderer/common 等）
  - `store/` —— 改造：数据权威转 server
  - `views/` —— 新增：Provider/Model 配置页
  - `types/`、`utils/` —— 沿用
- `index.html`、`vite.config.ts`（dev proxy → server:3000）、`package.json`（依赖 @my-copilot/shared）

**`packages/shared/` 内部结构**：
- `src/index.ts` —— 桶导出
- `src/chat.ts` —— Session、Message、Attachment 相关类型
- `src/provider.ts` —— Provider、Model 相关类型
- `src/agent.ts` —— Agent、AgentConfig 类型（Phase 1 定义字段，不实现逻辑）
- `src/skill.ts` —— Skill 相关类型（Phase 1 定义字段）
- `src/tool.ts` —— Tool 相关类型（Phase 1 定义字段）
- `src/mcp.ts` —— MCP 相关类型（Phase 1 定义字段）
- `src/api.ts` —— ApiResponse、ApiStatusCode

### 2.3 `src/` 迁移策略

`apps/web/src/` = 现有 `src/` 的**完整搬运**，但有三处改造（不是重写）：

1. **API 层**：删除 `mock.ts`，`real.ts` 从"直连 OpenAI"改为"调 server API"；`index.ts` 移除 Mock/Real 模式分支
2. **Store 层**：`chatStore` 持久化目标从 `localStorage` 改为通过 server API 持久化（chats/messages 存 SQLite）；`configStore` 移除 apiMode 概念
3. **新增 views**：Provider 配置页、Model 配置页（替换原 `Asider/SettingModal` 的部分功能）

其余组件（ChatShell、Asider、Sender、MarkdownRenderer、common/*）原样迁移。

---

## 3. 技术栈

| 层级 | 选型 | 来源/理由 |
|------|------|----------|
| 前端框架 | React 19 + TypeScript | 沿用 `src/` 现有代码（完整迁移） |
| 前端构建 | Vite（rolldown-vite） | 沿用现有 |
| 前端样式 | TailwindCSS 4 | 沿用现有 |
| 前端状态 | Zustand 5 | 沿用现有 |
| 前端路由 | React Router 7 | Phase 1 需要路由（配置页等） |
| 后端框架 | Hono | 轻量、API-first 友好 |
| 运行时 | Node.js 20+（ESM） | 沿用 |
| 数据库 | better-sqlite3 | 原生绑定，性能好，为 Phase 2 异步 Job 铺路 |
| 认证 | Token 门禁（单 token，环境变量） | 参考 OpenClaw，单用户 |
| 流式通信 | SSE（Phase 1）+ 异步 Job（Phase 2） | 渐进增强 |
| LLM 对接 | OpenAI 兼容 + Ollama（适配器模式） | 沿用旧设计 |
| Monorepo | pnpm workspaces | 沿用旧设计 |
| 共享类型 | `packages/shared` 独立包 | 多客户端共享类型契约 |
| 容器化 | Docker + Docker Compose | 沿用 |
| 附件解析 | 后端解析（md/txt/csv/docx），用完即弃 | API-first，隐私好 |

---

## 4. Phase 1 数据模型设计（SQLite Schema）

### 4.1 设计原则

- **只建 Phase 1 真正需要的表**（5 张）
- Agent/Skill/Tool/MCP 相关表**只定义字段 schema 不建表**（留到 Phase 2/3）
- 单用户：无 `user_id` 外键
- 物理删除（`ON DELETE CASCADE`），不做软删除
- 术语全局统一为 `session`（一次对话会话 = 一个 session）

### 4.2 Phase 1 实际建表（5 张）

**表 1：config（键值配置表）**
- 用途：系统级配置，如 schema_version、setup 标记等
- 字段：key（主键）、value

**表 2：providers（LLM 服务提供商）**
- 字段：id（主键）、name（显示名）、type（'openai' 或 'ollama'）、base_url（API 地址）、api_key（openai 需要，ollama 通常为空）、enabled（0/1）、created_at、updated_at

**表 3：models（模型，属于某个 provider）**
- 字段：id（主键）、provider_id（外键，关联 providers，级联删除）、name（模型标识，如 gpt-4o）、display_name（显示名，可选）、enabled、created_at、updated_at
- 索引：按 provider_id 建索引

**表 4：sessions（会话，对应"一次对话"）**
- 字段：id（主键）、title（默认"新对话"）、model_id（外键，关联 models，删除时置空）、created_at、updated_at
- 说明：Phase 1 无 agent_id；Phase 3 扩展时通过 ADD COLUMN 增加

**表 5：messages（消息）**
- 字段：id（主键）、session_id（外键，关联 sessions，级联删除）、role（'user'/'assistant'/'system'）、content（正文）、attachments（JSON 元信息）、status（'sending'/'sent'/'failed'）、error（失败原因）、created_at
- 索引：按 session_id 建索引

### 4.3 关键设计决策说明

**① 术语统一为 session**
"session"作为正式术语（一次连续对话 = 一个 session），messages 是它的子表。全局（含 UI 文案与代码层）统一使用 session。

**② 附件只存元信息，不存原文**
`messages.attachments` 存的是解析后的元信息 JSON（文件名、MIME 类型、大小、文本摘要前约 200 字），**不存附件原文/全文文本**（因为"用完即弃"）。解析出的全文文本只在当次请求注入 prompt，请求结束丢弃。

附件元信息结构（JSON 数组），每项含：
- name：文件名（如 "report.docx"）
- type：MIME 类型
- size：字节数
- textExcerpt：解析后文本的前约 200 字（用于消息气泡展示"已读取 xxx"）

**③ model_id 挂在 session 而非 message**
每个 session 绑定一个模型（创建时选，可中途切换）。比挂在每条 message 上简单，符合用户心智。切换模型后的历史消息仍保留，prompt 组装时用当前 model。

**④ 不做 user 表、不做软删除**
- 无 user 表：单用户，Token 门禁，无 user_id
- 不做软删除：个人项目，直接物理删除（ON DELETE CASCADE）

**⑤ Phase 3 扩展点预埋（现在不建表）**
Phase 3 引入多 Agent 时，sessions 表 ADD COLUMN agent_id，并新增 agents/skills/agent_skills 表。

### 4.4 与旧 `packages/shared` 类型库的差异

旧类型库的 Message/Chat/ChatSummary 字段会被新设计取代。`packages/shared` 重新定义：
- `Session`：id、title、modelId、createdAt、updatedAt
- `Message`：id、sessionId（旧版叫 chatId，统一改 sessionId）、role、content、attachments（仅元信息）、status、error、createdAt
- 移除 Chat/ChatSummary 概念，统一用 Session

---

## 5. Phase 1 API 设计

### 5.1 鉴权机制（Token 门禁）

参考 OpenClaw 实现：
- 单一 Token，通过环境变量 `AUTH_TOKEN` 配置
- server 启动时若未配置则自动生成一个并打印到日志
- 客户端请求需携带 `Authorization: Bearer <token>` 头
- 中间件统一校验，失败返回 401
- 公开路由豁免：`GET /api/health`

### 5.2 Phase 1 API 端点清单

**A. 健康检查**
- `GET /api/health` —— 公开路由，返回 server 状态与数据库连通性，用于 Docker 健康检查

**B. Provider（模型提供商）管理**
- `GET /api/providers` —— 列出所有 provider
- `POST /api/providers` —— 新建 provider（type、name、base_url、api_key）
- `PATCH /api/providers/:id` —— 更新 provider
- `DELETE /api/providers/:id` —— 删除 provider（级联删除其下 models）
- `POST /api/providers/:id/test` —— 连通性测试，验证 base_url + api_key 可达，返回测试结果（成功/失败 + 错误信息）

**C. Model（模型）管理**
- `GET /api/providers/:providerId/models` —— 列出某 provider 下的 models
- `POST /api/providers/:providerId/models` —— 新建 model（手动填写模型标识，如 gpt-4o）
- `PATCH /api/models/:id` —— 更新 model
- `DELETE /api/models/:id` —— 删除 model
- （可选增强）`GET /api/providers/:providerId/models/remote` —— 拉取 provider 远端实际可用模型列表（OpenAI 的 /models 接口、Ollama 的 /api/tags），辅助用户填写。Phase 1 可选实现。

**D. Session（会话）管理**
- `GET /api/sessions` —— 列出所有 session（摘要视图：id、title、modelId、messageCount、时间戳），按 updatedAt 倒序
- `POST /api/sessions` —— 新建 session（可指定 title、modelId）
- `PATCH /api/sessions/:id` —— 更新 session（改标题、切换 model）
- `DELETE /api/sessions/:id` —— 删除 session（级联删除其下 messages）
- `GET /api/sessions/:id/messages` —— 获取某 session 的全部消息（用于打开历史会话时加载）

**E. Message（消息）与对话**
- `POST /api/sessions/:id/messages` —— **核心端点**。发送一条用户消息并触发 AI 回复。
  - 请求：`multipart/form-data`，含消息正文字段 + 0~N 个附件文件（无附件时退化为纯 JSON 请求体也可）
  - 流程：server 保存用户消息 → 后端解析附件为文本 → 组装 prompt（系统提示 + 历史消息 + 附件文本）→ 调用 LLM 适配器 → SSE 流式返回 AI 回复 token → 流结束保存 assistant 消息
  - 响应：text/event-stream（SSE），逐 token 推送；客户端可发中断信号
- `POST /api/sessions/:id/messages/:msgId/stop` —— 中断当前流式生成（配合 AbortController）
- `DELETE /api/messages/:id` —— 删除单条消息（可选，用于"重新生成"前的清理）

### 5.3 SSE 事件协议

流式端点 `POST /api/sessions/:id/messages` 推送的 SSE 事件类型：
- `delta` —— AI 回复的一个文本片段（打字机效果）
- `done` —— 流式生成正常结束（携带最终 assistant 消息的完整 id）
- `error` —— 生成过程出错（携带错误分类与信息）
- `aborted` —— 被用户主动中断

事件载荷用 JSON 封装，遵循统一结构（复用 packages/shared 的 ApiResponse 约定）。

### 5.4 错误响应规范

所有非流式端点返回统一的 JSON 错误结构：状态码 + 错误码 + 错误信息 + 可选的错误分类（网络/超时/鉴权/业务/流式）。沿用旧 packages/shared 的 6 级错误分类思路（NetworkError/HttpError/TimeoutError/BusinessError/AbortError/StreamError），由 errorHandler 中间件统一封装。

### 5.5 跨域（CORS）

- 中间件从环境变量 CORS_ORIGIN 读取允许的 origin（逗号分隔，支持通配 *）
- 默认开发环境放行 http://localhost:5173（Vite dev server）
- 生产环境按部署配置，为未来桌面/移动端预留

---

## 6. Agent 概念体系定义

本节定义 Agent 相关基础概念，Phase 1 **只在 `packages/shared` 里定义这些概念的类型契约**，server 不建对应表、不实现执行逻辑。为 Phase 2/3 的实现铺好概念地基。

### 6.1 概念总览与关系

- **Agent**：一个可配置的"AI 助手实例"，是所有概念的**容器**。一个 Agent = 系统提示词 + 绑定的 Skills + 绑定的 Tools + 绑定的 MCPs + 模型参数
- **系统提示词（System Prompt）**：定义 Agent 的人格、行为准则、任务定位。每个 Agent 有一个
- **Skill**：可复用的**知识/能力包**，以结构化文档（SKILL.md 格式：YAML frontmatter 元数据 + Markdown 正文）形式存在。Skill 注入到 prompt，提供领域知识或工作流程指引。Agent 可关联多个 Skill
- **Tool**：Agent 可**实际执行**的动作（函数），如"读文件""查数据库""调外部 API"。Tool 有明确的输入 schema 和执行逻辑。Agent 可关联多个 Tool
- **MCP（Model Context Protocol）**：一种**标准化的外部能力接入协议**。一个 MCP server 对外暴露若干 Tools/Resources。Agent 关联一个 MCP，等价于获得该 MCP 提供的全部 Tools。MCP 是"批量 Tool 的标准容器"

> 注：**Rule 概念推迟到 Phase 2 再讨论**，Phase 1 不定义。

### 6.2 概念职责边界（避免混淆）

| 概念 | 注入位置 | 是否执行 | 举例 |
|------|---------|---------|------|
| System Prompt | 拼入 prompt 的 system 段 | 否（纯文本） | "你是一个严谨的数据分析师" |
| Skill | 拼入 prompt（知识/流程指引） | 否（纯文本） | "如何写好 PRD 的方法论文档" |
| Tool | 注册到 LLM 的 function calling | 是（真实执行代码） | read_file(path) |
| MCP | 间接提供一批 Tools | 是（通过 Tool 执行） | 接入"文件系统 MCP"获得一批文件操作 tool |

**核心区分**：Skill 给 Agent **"知道什么"**（知识），Tool 给 Agent **"能做什么"**（动作）。Skill 是文本，Tool 是代码。

### 6.3 各概念的属性定义（文档级，Phase 1 写入 shared 类型）

以下只描述字段语义，不写代码。这些会反映在 `packages/shared/src/` 的类型定义里（agent.ts/skill.ts/tool.ts/mcp.ts），但 Phase 1 server 不建对应表。

**Agent**
- id、name、description
- systemPrompt（系统提示词正文）
- modelId（绑定的模型）
- 参数：temperature、maxTokens、topP（模型生成参数）
- 关联：skillIds[]、toolIds[]、mcpIds[]
- enabled、createdAt、updatedAt

**Skill**
- id、name、description
- 格式：SKILL.md（YAML frontmatter 元数据 + Markdown 正文）
- frontmatter 字段：name、description、可选的 triggers（触发关键词）、version
- body：Markdown 正文（注入 prompt 的知识内容）
- enabled、createdAt、updatedAt

**Tool**
- id、name、description
- inputSchema：工具入参的结构描述（字段名、类型、说明）
- 类型标记：built-in（内置）/ mcp-provided（由 MCP 提供）
- 危险等级：low / medium / high（供 Phase 2 的 Rule 做高风险管控用）
- enabled、createdAt、updatedAt

**MCP**
- id、name、description
- transport：连接方式（如 stdio / sse / http）
- command / args / env（启动 MCP server 的参数，针对 stdio 类型）
- url（针对 sse/http 类型）
- enabled、createdAt、updatedAt
- 注：MCP 启用后，server 会拉取其暴露的 Tools，标记为 mcp-provided

### 6.4 Prompt 组装顺序（Phase 2 实现时的规范，Phase 1 仅记录）

当 Agent 发起一次 LLM 调用时，prompt 按以下顺序组装（文档记录，Phase 2 实现）：

1. System Prompt（Agent 的系统提示词）
2. Skills 正文（按 Agent 绑定的 skillIds 注入，每个 Skill 的 Markdown 正文）
3. 历史消息（当前 session 的历史 user/assistant 消息）
4. 当次附件文本（后端解析的附件，Phase 1 即有）
5. 当前用户消息（本次输入）

Tools / MCPs 以 function calling 形式注册到 LLM 请求（非 prompt 文本），由 LLM 决定是否调用。

### 6.5 Phase 1 的交付边界（明确"定义但不实现"）

文档明确 Phase 1 在 Agent 概念上做到哪一步：

- ✅ `packages/shared` 定义 Agent/Skill/Tool/MCP 的**类型契约**（字段语义）
- ✅ 文档明确概念定义、职责边界、组装顺序
- ✅ **预留一个"默认 Agent"概念**：Phase 1 实际运行时，所有 session 隐式使用一个不可见的默认 Agent（无 system prompt、无 skill/tool/mcp、仅用 session 绑定的 model）。这样 Phase 1 的对话能跑通，且 Phase 3 引入可见 Agent 时平滑过渡
- ❌ server 不建 agents/skills/tools/mcps 表
- ❌ 不实现 function calling、MCP 连接、Tool 执行
- ❌ 不实现自定义 Agent 的创建/切换

---

## 7. 前端改造范围与配置页面

### 7.1 整体改造原则

- **保留**：ChatShell、Asider、Sender、MarkdownRenderer、common/* 等核心对话组件原样迁移
- **改造**：api 层（去 Mock，对接 server）、store（持久化目标从 localStorage 改 server）、移除"Mock/Real 模式切换"相关 UI
- **新增**：路由系统（React Router）、Provider/Model 配置页
- **移除**：`mock/` 目录、`api/mock.ts`、`SettingModal` 中的 API 模式切换部分

### 7.2 前端路由结构（新增 React Router）

应用分为两个顶层区域：

- **对话区**（`/`）—— 主对话界面，对应迁移来的 MainView，包含 Asider（session 列表）+ ChatShell（消息流）+ Sender（输入）
- **配置区**（`/settings`）—— 设置页面，包含 Provider 和 Model 的管理

路由组织：
- 根路径 → 对话主界面
- `/settings` → 设置首页（Provider 列表入口）
- `/settings/providers` → Provider 管理列表
- `/settings/providers/:id` → 单个 Provider 详情/编辑（含其下 Model 列表）
- 可选：`/settings/providers/new` → 新建 Provider

### 7.3 需要改造的现有模块

**A. API 层（`src/api/`）**
- 删除 `mock.ts`
- `real.ts` 从"直连 OpenAI"改为"调 server REST/SSE 端点"
- `index.ts` 移除 Mock/Real 模式分支，只保留对接 server 的实现
- `request.ts`（fetch 封装）保留，自动附加 `Authorization: Bearer <token>` 头
- `errors.ts`（6 级错误体系）保留

**B. Store 层（`src/store/`）**
- **chatStore** 改造：
  - 原：persist 到 localStorage（chats/messages 全量）
  - 新：数据权威转 server（SQLite），前端只缓存当前 session 的 messages 和 session 摘要列表
  - 切换 session 时通过 `GET /api/sessions/:id/messages` 按需加载
  - 新建/删除/切换 session 走 server API
  - 移除 Zustand persist 中间件（数据权威在 server）
- **configStore** 改造：
  - 原：存 apiMode、OpenAI key/url/model（Mock/Real 模式配置）
  - 新：移除 apiMode 概念；Provider/Model 配置改为从 server 拉取（`GET /api/providers`）
  - 改为存"当前选中的 modelId""当前选中的 sessionId"等运行态偏好（继续用 localStorage 存运行态偏好）
- **userStore**：保留，简化（单用户，信息可来自 server 一个 `GET /api/me` 端点，或前端固定）

**C. Asider 组件**
- **会话列表**：从本地 store 读取 → 改为从 server 拉 session 摘要列表
- **SettingModal**：移除"API 模式切换""OpenAI key/url/model 配置"部分（这些移到配置页）；保留"关于""退出"等基础项；增加"进入设置页"入口
- **ModeTipCard**：删除（不再有 Mock/Real 模式区分）

### 7.4 新增：Provider/Model 配置页

Phase 1 前端的主要新增工作量。

**Provider 列表页**：
- 展示所有 provider（卡片/列表形式）：名称、类型（openai/ollama）、base_url、启用状态
- 操作：新建、编辑、删除、**连通性测试**（调用 `POST /api/providers/:id/test`，显示成功/失败 + 错误信息）
- 新建/编辑表单字段：名称、类型、base_url、api_key（ollama 类型时 api_key 可选/隐藏）

**Model 管理页（嵌套在 Provider 详情内）**：
- 展示某 provider 下的所有 model：模型标识、显示名、启用状态
- 操作：新建、编辑、删除
- 新建表单：手动填写模型标识（如 gpt-4o）+ 显示名
- 可选：提供"从远端拉取模型列表"按钮（调 `GET /api/providers/:id/models/remote`），让用户从实际可用列表中勾选（Phase 1 可选实现）

**配置入口**：
- Asider 底部或 SettingModal 提供"模型配置"入口 → 跳转 `/settings/providers`
- session 中可快速切换当前 model（下拉选择已配置的 model）

### 7.5 Token 存储与传输

- 首次访问时，若前端无 token，展示一个**简单的 token 输入页**（用户从 server 启动日志/环境变量获取 token 后填入）
- Token 存储位置：localStorage（key 如 `mycopilot_token`）
- 所有请求自动附加 `Authorization: Bearer <token>`
- Token 错误（401）时，清除 localStorage 中的 token，重新引导到 token 输入页
- 这是唯一需要前端维护的"配置"，其余配置都在 server 端

### 7.6 对话主界面的微调

迁移后，对话主界面除了"数据源从本地改 server"外，还需：
- **附件上传**：Sender 的附件上传改为真正上传到 server（随 `POST /api/sessions/:id/messages` 以 multipart/form-data 发送），而非仅前端预览
- **Model 选择器**：ChatShell 顶部或 Sender 附近增加当前 session 的 model 切换控件（从已配置 model 中选）
- **新会话创建**：点击 Asider "新建对话" → 调 `POST /api/sessions`，默认选当前 model

### 7.7 关于 multipart 上传与附件解析的衔接

- 前端以 `multipart/form-data` 发送消息正文 + 附件文件
- server 收到后，将附件文件**读入内存**解析为文本（md/txt/csv/docx），解析完毕即释放，**不落盘、不入库原文**
- 解析出的全文文本在当次 prompt 组装时使用，请求结束后丢弃
- 仅将附件元信息（name/type/size/textExcerpt）存入 messages.attachments 字段

---

## 8. 部署、配置与验收标准

### 8.1 环境变量与配置

server 通过环境变量配置，所有配置项集中管理。

**必需配置：**
- `AUTH_TOKEN` —— 访问令牌；未设置时 server 启动自动生成并打印到日志
- `DATA_DIR` —— SQLite 数据库文件存放目录（默认 `./data`），Docker 下挂载 Volume
- `PORT` —— 监听端口（默认 3000）

**可选配置：**
- `CORS_ORIGIN` —— 允许的跨域 origin，逗号分隔（默认开发环境放行 `http://localhost:5173`，生产按需）
- `SERVER_PUBLIC_DIR` —— server 托管的静态资源目录；设置为空时 server 仅作纯 API 服务（API-first 架构的多客户端模式），设置路径时 server 顺带托管 web 产物（单容器 all-in-one 模式）
- `LOG_LEVEL` —— 日志级别（默认 info）

**前端配置：**
- `VITE_API_BASE_URL` —— 前端构建时注入的 server API 地址；开发时由 Vite proxy 自动转发到 `http://localhost:3000`，生产构建时按部署形态配置

### 8.2 开发与部署形态

**开发态（双进程）：**
- `apps/web`：Vite dev server（端口 5173），配置 proxy 将 `/api` 转发到 server
- `apps/server`：Hono dev（端口 3000），CORS 放行 5173
- 根目录提供 `pnpm dev` 一键启动两端

**生产态（两种部署形态，均支持）：**

*形态一 —— 单容器 all-in-one（默认推荐，适合个人快速部署）：*
- 多阶段 Docker 构建：先装依赖 → 构建 server（tsup）+ web（vite build）→ 将 web 产物拷入 server 的 SERVER_PUBLIC_DIR → 最终镜像只含 server 运行时依赖 + 构建产物 + 数据目录
- 运行一个容器即得到完整服务
- docker-compose.yml 提供一键启动，数据目录用 Volume 持久化

*形态二 —— API-only server（面向未来多客户端）：*
- SERVER_PUBLIC_DIR 留空，server 纯 API
- web 产物单独部署（静态站点 / CDN / 或打包进桌面端 Tauri）
- 此形态 Phase 1 不强制提供 compose，但架构和文档支持

### 8.3 Docker 镜像规范

沿用旧设计的良好实践：
- **多阶段构建**：deps → build → runner，最终镜像仅含生产依赖
- **非 root 用户**运行（安全）
- **数据持久化**：DATA_DIR 挂载为 Volume
- **健康检查**：基于 `GET /api/health`
- **优雅关闭**：监听 SIGINT/SIGTERM，关闭 HTTP server 前等待进行中的流式请求处理完毕（或超时强制关闭）

### 8.4 三阶段 Milestone 验收标准

**Phase 1 验收标准：**
- [ ] Monorepo 结构建立（apps/server、apps/web、packages/shared），pnpm workspace 正常
- [ ] `src/` 代码完整迁移至 `apps/web`，原有对话功能不退化
- [ ] `apps/web` 移除 Mock 模式，所有数据走 server API
- [ ] server Token 门禁生效，无 token 或错误 token 返回 401
- [ ] CORS 配置生效，前端可跨域调用
- [ ] better-sqlite3 数据库初始化成功，5 张表建表通过
- [ ] 可在配置页新建/编辑/删除 Provider，连通性测试可用
- [ ] 可在配置页新建/编辑/删除 Model
- [ ] 可创建/切换/删除 session（多 session 隔离）
- [ ] 同 session 内多轮对话参考上下文（server 组装历史）
- [ ] SSE 流式对话正常（打字机效果），可中断
- [ ] 附件（md/txt/csv/docx）后端解析并注入 prompt
- [ ] 单容器 Docker 部署成功，健康检查通过
- [ ] `packages/shared` 定义 Agent/Skill/Tool/MCP 类型契约（默认 Agent 可跑通）
- [ ] 设计文档归档至 `/docs`

**Phase 2 验收标准（方向性，细化留待 Phase 2 设计）：**
- [ ] 内置 Tool 执行机制（function calling）
- [ ] MCP 接入（连接外部 MCP server，拉取其 Tools）
- [ ] Skill 导入/编辑/删除（SKILL.md 解析）
- [ ] 异步 Job 系统（后台执行长任务，断开浏览器仍继续）
- [ ] Tool 操作的高风险管控（确认/拦截机制）
- [ ] Rule 概念引入并实现（Phase 1 推迟的内容）
- [ ] 前端提供 Skill/MCP/Tool 配置页
- [ ] Session 上下文管理机制升级（更合理的截断/摘要策略）

**Phase 3 验收标准（方向性）：**
- [ ] 多 Agent 概念上线（Agent 配置页）
- [ ] 可创建自定义 Agent，绑定 system prompt + skill + mcp
- [ ] session 可绑定 Agent（一个 session 一个 Agent）
- [ ] 默认 Agent 作为特殊 Agent 存在
- [ ] 未来桌面/移动端可对接同一 server（API-first 验证）

### 8.5 风险与注意事项

1. **better-sqlite3 原生编译**：Docker 多阶段构建需装编译工具链（python3/make/g++），构建时间略增，属一次性成本。
2. **附件解析依赖体积**：docx 解析依赖（mammoth）会增加 server 包体积；md/txt/csv 几乎零成本。Phase 1 只引入 docx，xlsx/pptx 推迟。
3. **SSE 中断与状态一致性**：用户中断流式生成时，需保证已生成的部分 assistant 消息正确入库（status 标记），避免半截消息丢失或状态错乱。
4. **Token 泄露风险**：单 Token 模式下，Token 一旦泄露即获完整权限（参考 OpenClaw 安全事件）。文档提示用户妥善保管，避免公网裸奔，建议配合反向代理/Tailscale 使用。
5. **localStorage 存 Token 的 XSS 风险**：前端用 localStorage 存 Token 存在被 XSS 窃取的风险。个人部署场景风险可控，但文档提示此权衡。

---

## 9. 附录：本次设计的关键决策记录

| # | 决策点 | 结论 | 决策理由 |
|---|--------|------|---------|
| 1 | 流式通信形态 | Phase 1 SSE + Phase 2 异步 Job | 渐进增强，先跑通再深化 |
| 2 | 用户体系 | 单用户 + Token 门禁（OpenClaw 式） | 个人部署无需多用户 |
| 3 | 旧 packages/ 产物处理 | 作为设计参考，最终清空 | 旧设计（多用户 JWT）与新需求不符 |
| 4 | 新目录结构 | apps/server、apps/web、packages/shared | API-first，为多客户端铺路 |
| 5 | 部署形态 | API-first + 可选托管静态资源 | 兼顾个人部署简洁与未来多客户端 |
| 6 | 附件处理 | 后端解析，用完即弃 | 隐私好、无存储负担 |
| 7 | 数据库 | better-sqlite3 | 性能优于 sql.js WASM |
| 8 | 共享类型 | packages/shared 独立包 | 多客户端共享类型契约 |
| 9 | 附件格式范围（Phase 1） | md/txt/csv + docx（xlsx/pptx 推迟） | 常用格式优先，重依赖后置 |
| 10 | Mock 模式 | 彻底删除 | 全栈后无需 Mock 兜底 |
| 11 | Rule 概念 | 推迟到 Phase 2 | 简化 Phase 1 概念体系 |
| 12 | 术语 | 全局统一为 session（弃用 chat） | 严谨清晰 |
| 13 | 文档详略 | 不写具体代码，只描述设计 | 文档聚焦设计，代码留实施 |

---

## 10. 后续步骤

本设计文档通过用户最终审阅后，下一步将：
1. 调用 writing-plans skill，基于本设计生成 Phase 1 的详细实施计划（任务分解、依赖关系、实施顺序）
2. 实施计划经用户确认后，进入 Phase 1 的实际编码

**本阶段不修改任何代码**，仅产出本设计文档。
