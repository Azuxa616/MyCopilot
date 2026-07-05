# PROJECT KNOWLEDGE BASE

**Generated:** 2026-07-05
**Commit:** 7c663b3
**Branch:** dev

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
├── docker/        # Multi-stage Dockerfile + docker-compose
├── docs/          # Project documentation
├── .agents/       # AI agent skills (opencode)
└── .sisyphus/     # Sisyphus planning artifacts
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Frontend app | `apps/web/src/` | React SPA, Zustand stores |
| Backend API | `apps/server/src/` | Hono REST + SSE streaming |
| Shared types | `packages/shared/src/` | Cross-package type definitions |
| API routes | `apps/server/src/routes/` | health, models, providers, sessions, messages |
| Data layer | `apps/server/src/repo/` | SQLite repo pattern |
| LLM integration | `apps/server/src/llm/` | OpenAI-compatible API clients |
| State stores | `apps/web/src/store/` | sessionStore, configStore, userStore |
| Components | `apps/web/src/components/` | PascalCase dirs, see AGENTS.md |
| Docker config | `docker/` | Dockerfile + docker-compose.yml |
| AI skills | `.agents/skills/` | opencode skill definitions |

## CODE MAP
| Symbol | Type | Location | Role |
|--------|------|----------|------|
| `app` (Hono) | Constant | `apps/server/src/index.ts:30` | Server entry, routes, static serve |
| `App` (React) | Component | `apps/web/src/App.tsx` | Root React component, router |
| `sessionStore` | Store | `apps/web/src/store/sessionStore.ts` | Chat session state (Zustand) |
| `configStore` | Store | `apps/web/src/store/configStore.ts` | API config, model selection |
| `userStore` | Store | `apps/web/src/store/userStore.ts` | User preferences |
| `gracefulShutdown` | Function | `apps/server/src/index.ts:82` | Server graceful shutdown handler |

## CONVENTIONS
- **Bundler**: Uses `rolldown-vite@7.2.2` (pnpm override), NOT standard Vite
- **React components**: PascalCase directory names (e.g., `ChatShell/`, `Sender/`)
- **Server modules**: Flat functional modules (repo/, llm/, streaming/, attachment/, prompt/) — NOT traditional services/ layer
- **TypeScript**: Strict mode everywhere, `verbatimModuleSyntax`, `erasableSyntaxOnly`
- **State**: Zustand with localStorage persistence in Real mode
- **Styling**: TailwindCSS v4 (CSS-based theming, NOT config-based)
- **Testing**: Vitest (jsdom for web, node for server/shared)
- **API mode**: Mock/Real toggle driven from `configStore` at runtime
- **Chunk splitting**: Custom vendor chunks in Vite (react-vendor, ui-vendor, utils-vendor)

## ANTI-PATTERNS (THIS PROJECT)
- Do NOT use standard Vite — always rolldown-vite
- Do NOT put hooks in `src/hooks/` — they live inside component directories
- Do NOT reorganize server modules into traditional `services/` pattern — flat module structure is intentional
- Do NOT add Prettier — ESLint handles formatting
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
- Monorepo: pnpm workspace with `apps/*` and `packages/*`
- Server serves web static files in production (serves `apps/web/dist/`)
- Web proxies `/api` → `localhost:3000` in dev mode
- Database: SQLite stored in `apps/server/data/` (gitignored)
- Auth: Simple token-based (`AUTH_TOKEN` env var)
- LLM: Supports any OpenAI-compatible API (configurable per provider)
- No CI/CD pipeline configured
