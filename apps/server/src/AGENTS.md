# SERVER SOURCE

Hono 4 + better-sqlite3 backend with SSE streaming, serving the web build and proxying OpenAI-compatible LLM APIs.

## STRUCTURE
```
src/
├── index.ts        # Hono app entry, route mounting, static serve, graceful shutdown
├── config.ts       # Env-based config (PORT, AUTH_TOKEN, DB_PATH, defaults)
├── db/             # SQLite init (schema.sql baseline) + migrations
├── migration/      # SQL migrations (sql/0001..0010) + runner.ts, run on boot
├── repo/           # Data access layer, one module per entity
├── routes/         # Hono REST handlers: health, auth, assets, debug, jobs, mcps,
│                   #   messages, models, plugins, providers, sessions, settings, skills, tools
├── middleware/     # tokenAuth, CORS, logger, error
├── llm/            # OpenAI-compatible clients (openai.ts, ollama.ts, base, tester)
├── streaming/      # SSE lifecycle, agent-event bridge, registry, stop, sse-protocol
├── agent-loop/     # Multi-turn agent loop: runner, summarize, types, run-state,
│                   #   stop-router, loop-guard
├── prompt/         # Prompt assembly (assembler.ts, Context v2 only), truncator,
│                   #   summarizer, budget, skill-injections, token-counter
├── attachment/     # Upload parse (Word via mammoth, never throws), resolve, storage
├── tools/          # Registry, executor, confirmation + builtins/ (ask-user, web-search, ...)
├── skills/         # Skill scanner, parser, sync, GitHub/zip import, limits
├── plugin/         # Plugin loader, store, validate, capabilities (-mcp/-skills/combined), upload
├── mcp/            # MCP server manager, transport-factory, sync
├── jobs/           # Background job worker + agent-loop handler
├── capability/     # Model capability classification, probe, learning
├── demo/           # Demo seed + demo tools
└── utils/          # mask, response, schema-adapter
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Add an API endpoint | `routes/<entity>.ts` then mount in `index.ts` | One file per resource |
| Change DB schema | `migration/sql/00NN_*.sql` (new migration) | `db/schema.sql` is the baseline only; `migration/runner.ts` applies on boot |
| Query/mutate data | `repo/<entity>.ts` | `base.ts` holds shared SQL helpers |
| Change the agent loop | `agent-loop/runner.ts` | Types in `types.ts`, summarize helpers in `summarize.ts`; stop routing in `stop-router.ts` |
| Add a builtin tool | `tools/builtins/` | Register in `tools/builtins/index.ts` |
| Wire a new LLM provider | `llm/` | Keep OpenAI-compatible request shape |
| Tweak request pipeline | `index.ts` middleware order | tokenAuth → CORS → logger → error |
| Edit SSE behavior | `streaming/lifecycle.ts` | Per-event bridge lives in `streaming/agent-event.ts` |
| Assemble prompts | `prompt/assembler.ts` | `assembleMessagesV2` only (v1 retired); budget/truncation degrade chain inside |
| Parse uploads | `attachment/parser.ts` | Returns `AttachmentParseResult`, never throws |

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
