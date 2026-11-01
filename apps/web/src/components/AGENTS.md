# COMPONENTS

React 19 UI layer for MyCopilot. TailwindCSS v4 for styling, Zustand stores for state.

## STRUCTURE
```
components/
├── Asider/              # Left sidebar: session list, user card, new chat
├── ChatShell/           # Main chat surface: message list, streaming, virtual scroll
│   └── hooks/           # useAutoScroll, useJobStream, useMessageRegenerate, useMessageVirtualizer
├── Sender/              # Input box, attachments, references, command palette
│   ├── chips/           # Reference chip model + triggers
│   └── hooks/           # useAttachments, useChipInput, useTextareaAutoHeight, ...
├── MarkdownRenderer/    # Markdown + code highlighting
├── QuestionCard/        # Structured ask-user card (+ parse.ts)
├── PluginCardHost/      # Renders <pluginId>:card fenced blocks (+ parse.ts)
├── common/              # Shared building blocks
│   ├── Alert/           # Alert system (alertUtils, index)
│   ├── AgentTimeline.tsx  # Reasoning/lead/tool timeline in assistant bubbles
│   ├── MessageCard.tsx  # Message bubble with actions
│   ├── Modal.tsx / Popover.tsx / Badge.tsx / Avatar.tsx / FormField.tsx / Switch.tsx
│   └── hooks/           # useAssetUrl
├── debug/               # Debug badge + modal (sections/ per concern)
├── EmptyState.tsx       # Empty conversation placeholder
└── *Modal.tsx / *FormModal.tsx   # Top-level single-purpose modals
    (Model, Provider, Token, Mcp, Skill, Tool, ToolTest, ToolConfirmation,
     ToolInputSchemaEditor, PluginInstall, PluginEvents)
```

## WHERE TO LOOK
| Task | Location |
|------|----------|
| Add a sidebar action | `Asider/index.tsx` |
| Change message rendering or streaming | `ChatShell/`, esp. `hooks/useJobStream` |
| Reuse a bubble, avatar, or alert | `common/` |
| Render markdown or code blocks | `MarkdownRenderer/index.tsx` |
| Modify input, attachments, references | `Sender/Sender.tsx` + `Sender/hooks/` |
| Add a top-level modal | new `XxxModal.tsx` at root |

## CONVENTIONS
- PascalCase directories for compound components. Each ships an `index.tsx` barrel.
- Single-purpose components stay as root `.tsx` files (no folder).
- Component-specific hooks live inside the component dir under `hooks/`, never at the top level.
- Styling is TailwindCSS v4 only. No CSS modules, no styled-components.
- State comes from Zustand stores in `src/store/`. Components stay presentational where possible.
- Icons: standalone `.svg` under `assets/icon/`, imported with `?react` (see the svg-icons skill). No inline `<svg>`.
- Barrel exports keep import paths flat: `import { ChatShell } from '@/components/ChatShell'`.

## KNOWN TODOs
- `ChatShell/hooks/useMessageRegenerate.ts`: marked "Phase 2, remove or reimplement".
- `common/MessageCard.tsx`: share card feature pending.
- `PluginCardHost/index.tsx`: exhaustive-deps warning (missing `payload` dep in useEffect) — pre-existing, fix with care.

## ANTI-PATTERNS
- Do NOT create a top-level `hooks/` folder here. Hooks belong to their component.
- Do NOT add a component without checking `common/` first. Duplicate primitives sprawl fast.
- Do NOT reach into `ChatShell/hooks/` from outside the component. Treat them as private.
- Do NOT use plain `.js` or `.jsx`. TypeScript strict everywhere.
- Do NOT hand-roll modals. Follow the `XxxModal.tsx` pattern at the root.
- Do NOT inline `<svg>` or interpolate Tailwind class-name fragments.
