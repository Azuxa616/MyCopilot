# SERVER SOURCE

Hono 4 + better-sqlite3 backend with SSE streaming, serving the web build and proxying OpenAI-compatible LLM APIs.

## STRUCTURE
```
src/
├── index.ts        # Hono app entry, route mounting, static serve, graceful shutdown
├── config.ts       # Env-based config (PORT, AUTH_TOKEN, DB_PATH, defaults)
├── db/             # SQLite init + migrations (better-sqlite3)
├── repo/           # Data access layer, one module per entity
├── routes/         # Hono REST handlers (health, models, providers, sessions, messages)
├── middleware/     # auth, CORS, logger, error
├── llm/            # OpenAI-compatible client (chat, embeddings, streaming)
├── streaming/      # SSE response writers for chat tokens
├── prompt/         # Prompt assembly before LLM calls
├── attachment/     # File upload parse (Word via mammoth, never throws)
└── utils/          # Shared helpers
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Add an API endpoint | `routes/<entity>.ts` then mount in `index.ts` | One file per resource |
| Change DB schema | `db/index.ts` | Migrations run on boot |
| Query/mutate data | `repo/<entity>.ts` | `base.ts` holds shared SQL helpers |
| Wire a new LLM provider | `llm/` | Keep OpenAI-compatible request shape |
| Tweak request pipeline | `index.ts` middleware order | auth → CORS → logger → error |
| Edit SSE behavior | `streaming/` | Token deltas only; full text comes from repo |
| Parse uploads | `attachment/parser.ts` | Returns `AttachmentParseResult`, never throws |
| Assemble prompts | `prompt/` | Runs after attachment parse, before LLM call |

## CONVENTIONS
- **Flat functional modules**, not layered `services/`. Each folder owns one concern and exports functions, not classes.
- **`repo/` is the data layer.** No direct `db.prepare` outside `repo/` and `db/`.
- **Routes stay thin.** Parse input, call `repo/` or `llm/`, return JSON or hand off to `streaming/`.
- **Errors flow through middleware.** Throw `HTTPException`; the error middleware formats the response.
- **Auth is a single shared token** read from `AUTH_TOKEN` in `config.ts`. The token itself never appears in logs.
- **Attachment parse never throws.** It returns a result object so route handlers can branch on status.
- **DB file is gitignored** under `data/`. Schema is recreated from migrations, not from a committed file.
- **Streaming uses SSE**, one event per token delta. Final persisted message is written by the message repo after the stream closes.

## ANTI-PATTERNS
- Don't introduce a `services/` layer or wrap repos in classes.
- Don't query SQLite from `routes/` or `llm/`. Go through `repo/`.
- Don't log `AUTH_TOKEN`, request bodies with keys, or full LLM payloads.
- Don't swallow errors in `attachment/`. Return them in the result struct.
- Don't use standard Vite patterns here. This is a Hono server, build via `tsup`/server tooling.
- Don't add a new LLM SDK when the OpenAI-compatible client already covers it.
