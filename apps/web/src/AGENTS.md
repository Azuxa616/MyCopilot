# Web Frontend (`apps/web/src/`)

React 19 + TypeScript SPA. Served statically by the server in production, proxied to `:3000` during dev.

## STRUCTURE
```
src/
├── api/              # API layer: index.ts barrel → real.ts barrel → real/<domain>.ts
│   ├── real/         # Domain modules: sessions, providers, tools, skills, mcps,
│   │                 #   plugins, assets, settings, jobs, auth
│   ├── request.ts    # fetch wrapper (auth header, timeout, retry, SSE)
│   ├── errors.ts     # ApiError/HttpError/TimeoutError/... + helpers
│   └── types.ts      # API-layer local types
├── components/       # React components, PascalCase dirs (see components/AGENTS.md)
├── store/            # Zustand stores
│   ├── sessionStore.ts          # Chat session state; re-exports agent-state symbols
│   ├── agent-state.ts           # AgentState machine, transitionAgentState
│   ├── stream-handlers.ts       # SSE stream callbacks factory (set/get injected)
│   ├── session-store-types.ts   # Shared helpers to avoid circular imports
│   ├── configStore.ts           # API config, model selection (persisted)
│   ├── userStore.ts / draftStore.ts / debugStore.ts
├── types/            # Frontend-only TS types (timeline.ts, user.ts)
├── utils/            # Helpers (stream parsing, timeline rebuild, redactor, ...)
├── views/            # Route-level pages (settings hub under views/settings/)
├── router.tsx        # React Router config
├── main.tsx          # Mount point (RouterProvider; no App.tsx wrapper)
└── index.css         # Tailwind entry + tokens
```

## WHERE TO LOOK
| Task | Location |
|------|----------|
| Add a route or page | `router.tsx`, `views/` |
| Chat feature work | `components/ChatShell/` (hooks live in its `hooks/` subdir) |
| API call | `api/index.ts` barrel; backing impl in `api/real/<domain>.ts` |
| Add an API endpoint client | new/matching file in `api/real/`, re-exported via `real.ts` |
| Streaming parse | `utils/streamUtils.ts`, store handlers in `store/stream-handlers.ts` |
| State change | `store/*Store.ts` (Zustand) |
| Provider / model / token forms | `components/ProviderFormModal.tsx`, `ModelFormModal.tsx`, `TokenModal.tsx` |
| Global styles, tokens | `index.css` |

## CONVENTIONS
- Hooks live INSIDE their component dir (e.g., `ChatShell/hooks/`), never in a top-level `hooks/` folder.
- Component directories are PascalCase. Single-use widgets can stay as flat files (`EmptyState.tsx`).
- Components import the API through `api/index.ts`, not `real.ts`/`real/*` or `request.ts` directly.
- Icons are standalone `.svg` files under `assets/icon/`, imported with `?react`; never inline `<svg>` in TSX.
- Only `configStore` persists to localStorage.
- Styling is TailwindCSS v4, CSS-first. Tokens live in `index.css`, not a JS config.
- Tests: `*.test.ts(x)` co-located or in `__tests__/`; `vitest.config.ts` stubs `*.svg?react` — do not remove that plugin.

## ANTI-PATTERNS
- No top-level `hooks/`, `services/`, or `pages/` dirs. Use the existing folders.
- Don't bypass `api/index.ts` to reach for `real.ts` / `real/*` / `request.ts` from a component.
- No `tailwind.config.js`. v4 is config-less by design; edit CSS instead.
- No inline styles for layout. Use Tailwind utilities.
- No inline `<svg>`; no Tailwind class-name string interpolation (`items-${x}`) — full literals only.
- Don't move route config into a component; keep it in `router.tsx`.
