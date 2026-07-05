# COMPONENTS

React 19 UI layer for MyCopilot. TailwindCSS v4 for styling, Zustand stores for state.

## STRUCTURE
```
components/
├── Asider/              # Left sidebar: session list, settings, new chat
├── ChatShell/           # Main chat surface: message list, streaming, virtual scroll
│   └── hooks/           # useMessageStream, useMessageRegenerate
├── common/              # Shared building blocks
│   ├── Alert/           # Alert system (alertUtils, types, index)
│   ├── Avatar.tsx
│   └── MessageCard.tsx  # Message bubble with actions
├── MarkdownRenderer/    # Markdown + code highlighting
├── Sender/              # Input box, file upload, send
├── EmptyState.tsx       # Empty conversation placeholder
├── ModelFormModal.tsx   # Model config modal
├── ProviderFormModal.tsx # Provider config modal
└── TokenModal.tsx       # API token entry
```

## WHERE TO LOOK
| Task | Location |
|------|----------|
| Add a sidebar action | `Asider/index.tsx` |
| Change message rendering or streaming | `ChatShell/`, esp. `hooks/useMessageStream` |
| Reuse a bubble, avatar, or alert | `common/` |
| Render markdown or code blocks | `MarkdownRenderer/index.tsx` |
| Modify input, attachments, send | `Sender/index.tsx` |
| Add a top-level modal | new `XxxModal.tsx` at root |

## CONVENTIONS
- PascalCase directories for compound components. Each ships an `index.tsx` barrel.
- Single-purpose components stay as root `.tsx` files (no folder).
- Component-specific hooks live inside the component dir under `hooks/`, never at the top level.
- Styling is TailwindCSS v4 only. No CSS modules, no styled-components.
- State comes from Zustand stores in `src/store/`. Components stay presentational where possible.
- Barrel exports keep import paths flat: `import { ChatShell } from '@/components/ChatShell'`.

## KNOWN TODOs
- `ChatShell/hooks/useMessageRegenerate.ts`: marked "Phase 2, remove or reimplement".
- `common/MessageCard.tsx`: share card feature pending.

## ANTI-PATTERNS
- Do NOT create a top-level `hooks/` folder here. Hooks belong to their component.
- Do NOT add a component without checking `common/` first. Duplicate primitives sprawl fast.
- Do NOT reach into `ChatShell/hooks/` from outside the component. Treat them as private.
- Do NOT use plain `.js` or `.jsx`. TypeScript strict everywhere.
- Do NOT hand-roll modals. Follow the `XxxModal.tsx` pattern at the root.
