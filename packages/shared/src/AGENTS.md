# @my-copilot/shared — Source

## OVERVIEW
Pure TypeScript types and constants shared by `apps/web` and `apps/server`. Zero runtime code.

## STRUCTURE
```
src/
├── index.ts        # Barrel export — re-exports all modules
├── api.ts          # ApiResponse<T> wrapper, ApiStatusCode constants
├── session.ts      # Message, Session, AttachmentMeta, MessageRole/Status
├── provider.ts     # LLM provider config types
├── agent.ts        # Agent definition types
├── skill.ts        # Skill manifest types
├── tool.ts         # Tool/function-calling types
├── mcp.ts          # MCP server connection types
└── __tests__/      # Vitest specs — one per source module
```

## WHERE TO LOOK
| Adding a shared type | Add to the matching module, then it auto-flows through `index.ts` |
| New domain (no matching file) | Create a new `foo.ts`, add `export * from './foo.js'` to `index.ts` |
| API envelope shape | `api.ts` — `ApiResponse<T>` + `ApiStatusCode` |
| Chat data model | `session.ts` — `Message`, `Session`, attachment metadata |
| Test for a module | `__tests__/<module>.test.ts`, mirrors source filename |

## CONVENTIONS
- **Flat module layout** — one file per domain, no `types/` or `utils/` subdirectories
- **Barrel re-exports use `.js` extensions** (`export * from './foo.js'`) — required by `verbatimModuleSyntax` + ESM emit
- **Types only** — no functions with runtime logic, no third-party imports
- **Build**: plain `tsc`, outputs `dist/` with `.d.ts` declarations
- **Tests**: Vitest in Node environment, co-located in `__tests__/`
- Consumer packages import via `@my-copilot/shared`, never reach into internal files
