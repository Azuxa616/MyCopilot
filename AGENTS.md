# PROJECT KNOWLEDGE BASE

**Generated:** 2026-11-01
**Commit:** a67e33d
**Branch:** main

## OVERVIEW
AI chat application (MyCopilot) — pnpm monorepo with React 19 frontend, Hono + SQLite backend, and shared TypeScript types.

## STRUCTURE
```
MyCopilot/
├── apps/
│   ├── web/       # React 19 + Vite (rolldown) + TailwindCSS 4 + Zustand
│   └── server/    # Hono + better-sqlite3 + streaming SSE
├── packages/
│   └── shared/    # Shared types and utilities (@my-copilot/shared)
├── plugins/       # External plugin examples (e.g. bilibili-search)
├── docker/        # Multi-stage Dockerfile + docker-compose
├── docs/          # Project documentation (RFCs, designs, plans)
├── scripts/       # Dev/build helper scripts
├── .agents/       # AI agent skills (opencode)
└── .sisyphus/     # Sisyphus planning artifacts
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Frontend app | `apps/web/src/` | React SPA, Zustand stores |
| Backend API | `apps/server/src/` | Hono REST + SSE streaming |
| Shared types | `packages/shared/src/` | Cross-package type definitions |
| API routes | `apps/server/src/routes/` | 14 resources: health, auth, assets, debug, jobs, mcps, messages, models, plugins, providers, sessions, settings, skills, tools |
| Data layer | `apps/server/src/repo/` | SQLite repo pattern, one module per entity |
| DB schema | `apps/server/src/db/schema.sql` | Baseline; incremental changes in `apps/server/src/migration/sql/` run by `migration/runner.ts` |
| Agent loop | `apps/server/src/agent-loop/` | `runner.ts` (main loop), `summarize.ts`, `types.ts`, `run-state.ts`, `stop-router.ts`, `loop-guard.ts` |
| Tool system | `apps/server/src/tools/` | Registry, executor, confirmation + `builtins/` |
| LLM integration | `apps/server/src/llm/` | OpenAI-compatible API clients (openai/ollama) |
| MCP integration | `apps/server/src/mcp/` | Server manager, transports, sync |
| Plugin system | `apps/server/src/plugin/` | Loader, store, validate, capabilities |
| Skill system | `apps/server/src/skills/` | Scanner, parser, sync, GitHub/zip import |
| Background jobs | `apps/server/src/jobs/` | Job worker + agent-loop handler |
| State stores | `apps/web/src/store/` | sessionStore (+ agent-state/stream-handlers split), configStore, userStore, draftStore, debugStore |
| Components | `apps/web/src/components/` | PascalCase dirs, see AGENTS.md |
| Docker config | `docker/` | Dockerfile + docker-compose.yml |
| AI skills | `.agents/skills/` | opencode skill definitions |

## CODE MAP
| Symbol | Type | Location | Role |
|--------|------|----------|------|
| `app` (Hono) | Constant | `apps/server/src/index.ts` | Server entry, routes, static serve |
| `runAgentLoop` | Function | `apps/server/src/agent-loop/runner.ts` | Multi-turn agent loop (stream, tools, guard, summarize) |
| `assembleMessagesV2` | Function | `apps/server/src/prompt/assembler.ts` | Context v2 prompt assembly (v1 retired) |
| `streamMessageHandler` | Function | `apps/server/src/streaming/lifecycle.ts` | SSE stream lifecycle; per-event bridge in `streaming/agent-event.ts` |
| `sessionStore` | Store | `apps/web/src/store/sessionStore.ts` | Chat session state; stream handlers in `stream-handlers.ts`, agent-state machine in `agent-state.ts` |
| `configStore` | Store | `apps/web/src/store/configStore.ts` | API config, model selection (persisted) |
| `api` | Barrel | `apps/web/src/api/index.ts` | Re-exports `real.ts`, which barrels `api/real/` domain modules |
| `gracefulShutdown` | Function | `apps/server/src/index.ts:82` | Server graceful shutdown handler |

## CONVENTIONS
- **Bundler**: Uses `rolldown-vite@7.2.2` (pnpm override), NOT standard Vite
- **React components**: PascalCase directory names (e.g., `ChatShell/`, `Sender/`); single-purpose modals stay as root `XxxModal.tsx` files
- **Server modules**: Flat functional modules (repo/, llm/, streaming/, attachment/, prompt/, agent-loop/, tools/, skills/, plugin/, mcp/, jobs/…) — NOT traditional services/ layer
- **TypeScript**: Strict mode everywhere, `verbatimModuleSyntax`, `erasableSyntaxOnly`
- **State**: Zustand; only `configStore` persists to localStorage
- **Styling**: TailwindCSS v4 (CSS-based theming, NOT config-based)
- **Testing**: Vitest (jsdom for web, node for server/shared); server uses `__tests__/` dirs, web mixes co-located tests
- **Icons**: standalone `.svg` files under `apps/web/src/assets/icon/`, imported with `?react` (no inline `<svg>` in TSX)
- **Chunk splitting**: Custom vendor chunks in Vite (react-vendor, ui-vendor, utils-vendor)

## DOCUMENTATION LANGUAGE (项目级强制约定)
- **所有面向用户/开发者阅读的文档一律用中文撰写**：RFC、README、设计文档（`docs/`）、用户指南、ARCHITECTURE/CHANGELOG 等
- **代码标识符一律保留英文**：字段名、类型名、函数名、变量名、枚举值（如 `Run`、`status`、`in_progress`、`SafetyLevel`、`MAX_SAME_TOOL_CALLS`）
- **技术缩写保留英文原文**：SSE、JSON、API、HTTP、MCP、LLM、URL、SQL、CSP、AST、LSP、SPDX 等
- **形式化工件中的描述性文字用中文**：JSON Schema 的 `description` 字段值、TypeScript 的 JSDoc 注释、Mermaid 图表的节点 label（节点 ID 和语法关键字保留英文）
- **专有名词/产品名保留原文**：MyCopilot、OpenAI、Anthropic、React、Hono、Vitest、Zustand 等
- **章节标题中文化**：Motivation→动机、Goals→目标、Non-Goals→非目标、Specification→规范、Migration→迁移、Open Questions→开放问题、References→参考文献、Threat Model→威胁模型 等
- **结构标记同步中文化**：ADR→决策、Anti-pattern→反例、"A conforming implementation MUST"→"合规实现必须" 等
- **源码注释**：暂不强制中文化（作为独立任务另行评估），但新增注释鼓励用中文
- **例外**：第三方引用、命令行示例、代码块内容、API 字面量保持原文

## ANTI-PATTERNS (THIS PROJECT)
- Do NOT use standard Vite — always rolldown-vite
- Do NOT put hooks in `src/hooks/` — they live inside component directories
- Do NOT reorganize server modules into traditional `services/` pattern — flat module structure is intentional
- Do NOT add Prettier — ESLint handles formatting
- Do NOT inline `<svg>` in TSX — icons are `.svg` files imported with `?react`
- Do NOT commit `.db` files or `apps/server/data/`

## COMMANDS
```bash
pnpm install              # Install all dependencies
pnpm dev                  # Start all dev servers (web :5173, server :3000)
pnpm build                # Build all packages
pnpm test                 # Run all tests (Vitest)
pnpm lint                 # Lint all packages (ESLint)
pnpm typecheck            # Type check all packages

# Docker
pnpm docker:build         # Build Docker image
pnpm docker:up            # Start Docker Compose

# Individual packages
pnpm --filter web dev     # Web dev only
pnpm --filter server dev  # Server dev only
```

## NOTES
- Monorepo: pnpm workspace with `apps/*`, `packages/*` and `plugins/*`
- Server serves web static files in production (serves `apps/web/dist/`)
- Web proxies `/api` → `localhost:3000` in dev mode
- Database: SQLite stored in `apps/server/data/` (gitignored)
- Auth: Simple token-based (`AUTH_TOKEN` env var)
- LLM: Supports any OpenAI-compatible API (configurable per provider)
- No CI/CD pipeline configured
