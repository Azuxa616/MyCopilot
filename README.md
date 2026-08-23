# MyCopilot

一个可自托管的全栈 AI 对话应用：用熟悉的聊天界面连接 OpenAI 兼容模型，并在同一个工作区里管理会话、模型供应商、Skills、工具和 MCP 服务。

MyCopilot 面向两类使用者：

- **普通用户**：打开网页、配置模型，就可以开始多轮对话、上传附件并查看历史会话。
- **开发者**：可以把它当作一个 React + Hono 的 AI 应用基座，继续扩展模型适配、工具调用、Skills 或 MCP 集成。

## 能做什么

### 对话体验

- 多会话管理：新建、切换、删除会话，并在 SQLite 中保存历史消息。
- 流式回复：通过 SSE 实时显示模型输出，支持停止正在进行的生成。
- Markdown 消息：支持 GFM、表格、链接、代码块和语法高亮。
- 附件上下文：支持将文本、Markdown、CSV、DOCX 等附件解析后注入当前请求；单个附件默认限制为 10 MB。
- 上下文处理：服务端会根据上下文预算截断历史消息，并可生成会话摘要，避免长对话无限增长。

### 模型与服务配置

- Provider / Model 管理：配置多个 OpenAI 兼容或 Ollama 服务，按会话选择模型。
- Token 认证：服务端使用 Bearer Token 保护 API；首次启动时可从日志获取自动生成的 token。
- 本地数据：会话、消息、Provider、模型和工具配置保存在服务端 SQLite 数据库中。

### Agent 能力

- **内置工具**：包含计算、编码/解码、哈希、JSON 格式化、UUID、当前时间，以及 HTTP 获取和网页搜索等工具。
- **工具安全策略**：安全工具可直接执行；受限工具需要在会话内确认；高风险工具每次调用都需要确认。
- **Skills**：通过 Markdown 定义可复用的工作方式，可在界面中管理，也可以从目录同步。
- **MCP**：连接 stdio 或 HTTP MCP 服务，自动同步服务提供的工具。
- **后台任务**：较长的 Agent 执行通过后台 job worker 处理，并通过 SSE 向前端推送进度。

## 快速开始

### 环境要求

- Node.js 20+
- pnpm 10+

### 安装并启动

```bash
pnpm install
pnpm dev
```

启动脚本会先运行 Server，确认 `http://localhost:3000/api/health` 可用后，再启动 Web 开发服务器。开发环境默认访问：

- Web：<http://localhost:5173>
- Server：<http://localhost:3000>

首次打开页面时，从 Server 的启动日志复制 `AUTH_TOKEN`，粘贴到页面的认证弹窗中。若没有设置环境变量，Server 会生成 token，并在启动日志中打印；token 会持久化到数据库，重启后保持不变。

### 手动启动单个应用

```bash
pnpm --filter server dev
pnpm --filter web dev
```

如果只需要构建：

```bash
pnpm build
```

## 配置

复制并按需修改 `apps/server/.env.example`。常用配置如下：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `AUTH_TOKEN` | 自动生成 | API Bearer Token；生产环境建议显式设置 |
| `DATA_DIR` | `./data` | SQLite 数据目录 |
| `PORT` | `3000` | Server 监听端口 |
| `CORS_ORIGIN` | `http://localhost:5173` | 允许访问 API 的来源，多个来源用逗号分隔 |
| `MAX_ATTACHMENT_SIZE_MB` | `10` | 单个附件大小上限 |
| `SERVER_PUBLIC_DIR` | 空 | 设置后由 Server 同时托管 Web 构建产物 |
| `SKILLS_DIR` | 空 | 可选的目录 Skills 来源 |
| `LOG_LEVEL` | `info` | `debug`、`info`、`warn` 或 `error` |

Provider 的 `base_url`、API Key 和模型名称在 Web 界面的设置页中配置，而不是写入前端环境变量。

## Docker 部署

项目提供了单容器部署配置：

```bash
pnpm docker:build
pnpm docker:up
```

默认会把服务暴露在 `http://localhost:3000`，并将 `docker/data` 挂载到容器的 `/app/data`。部署到其他环境前，请至少设置 `AUTH_TOKEN`，并根据实际域名调整 `CORS_ORIGIN`。

## 项目结构

```text
MyCopilot/
├── apps/
│   ├── web/                 # React 19 前端、路由、页面和 Zustand 状态
│   └── server/              # Hono API、SQLite、LLM、Agent、工具和 MCP
├── packages/
│   └── shared/              # 前后端共享的 TypeScript 类型与工具
├── docker/                  # Dockerfile 与 Compose 配置
├── docs/                    # 架构与设计文档
└── scripts/                 # 本地开发启动脚本
```

Server 端按功能组织为 `routes/`、`repo/`、`llm/`、`prompt/`、`streaming/`、`tools/`、`skills/` 和 `mcp/` 等模块；Web 端主要代码位于 `apps/web/src/`，包括聊天组件、设置页、API 客户端和 Zustand stores。

## 常用开发命令

```bash
pnpm dev          # 同时启动 Web 与 Server
pnpm build        # 构建所有 workspace 包
pnpm test         # 运行全部 Vitest 测试
pnpm lint         # 运行 ESLint
pnpm typecheck    # 执行 TypeScript 类型检查
```

也可以只针对某个 workspace 执行命令，例如：

```bash
pnpm --filter web test
pnpm --filter server lint
```

## 数据与安全提示

- `apps/server/data/` 和 Docker 的数据卷包含 SQLite 数据，请做好备份；这些运行时数据不应提交到 Git。
- Provider API Key 保存在服务端数据库中。请限制数据库目录的访问权限，并在生产环境使用强随机的 `AUTH_TOKEN`。
- MCP 和工具可能访问外部网络或执行本地命令。只连接你信任的服务，并在启用前检查工具的安全等级与参数范围。
- `GET /api/health` 是公开健康检查接口，其他 `/api/*` 接口默认需要 Bearer Token。

## 开发状态

项目仍在持续迭代中。当前主线优先完善 Agent 工具安全、MCP/Skills 管理、后台任务和上下文处理；接口和数据结构可能随版本演进，扩展功能前建议先阅读 `docs/` 中的设计文档。

## 许可证

[MIT License](LICENSE)
