# Web Frontend (`apps/web/src/`)

React 19 + TypeScript SPA. Served statically by the server in production, proxied to `:3000` during dev.

## STRUCTURE
```
src/
├── api/              # API layer (real.ts, request.ts, errors.ts, types.ts, index barrel)
├── components/       # React components, PascalCase dirs
│   ├── Asider/           # Sidebar
│   ├── ChatShell/        # Main chat UI (has its own hooks/ subdir)
│   ├── Sender/           # Message composer
│   ├── MarkdownRenderer/ # Markdown + code highlight
│   └── common/           # Shared bits (Alert, Avatar, ...)
├── store/            # Zustand: sessionStore, configStore, userStore
├── types/            # Frontend-only TS types
├── utils/            # Helpers (stream parsing, llm glue, ...)
├── views/            # Route-level pages
├── App.tsx           # Root, hosts router
├── router.tsx        # React Router config
├── main.tsx          # Mount point
└── index.css         # Tailwind entry + tokens
```

## WHERE TO LOOK
| Task | Location |
|------|----------|
| Add a route or page | `router.tsx`, `views/` |
| Chat feature work | `components/ChatShell/` (hooks live in its `hooks/` subdir) |
| API call | `api/index.ts` barrel; backing impl in `real.ts`, `request.ts` |
| Streaming parse | `utils/` |
| State change | `store/*Store.ts` (Zustand) |
| Provider / model / token forms | `components/ProviderFormModal.tsx`, `ModelFormModal.tsx`, `TokenModal.tsx` |
| Global styles, tokens | `index.css`, `App.css` |

## CONVENTIONS
- Hooks live INSIDE their component dir (e.g., `ChatShell/hooks/`), never in a top-level `hooks/` folder.
- Component directories are PascalCase. Single-use widgets can stay as flat files (`EmptyState.tsx`).
- Components import the API through `api/index.ts`, not `real.ts` or `request.ts` directly.
- Mock/Real mode is a runtime toggle driven from `configStore`; behavior branches at the barrel.
- Zustand stores persist to localStorage only in Real mode.
- Styling is TailwindCSS v4, CSS-first. Tokens live in `index.css`, not a JS config.

## ANTI-PATTERNS
- No top-level `hooks/`, `services/`, or `pages/` dirs. Use the existing folders.
- Don't bypass `api/index.ts` to reach for `real.ts` / `request.ts` from a component.
- No `tailwind.config.js`. v4 is config-less by design; edit CSS instead.
- No inline styles for layout. Use Tailwind utilities.
- Don't move route config into `App.tsx`; keep it in `router.tsx`.
