# Elos Gateway Implementation Plan

**Goal:** Ship a runnable self-hosted gateway with shared profile context.
**Architecture:** HTTP API and workers share a transactional store; each provider is resolved per run. Events and step checkpoints persist independently of the client connection.
**Tech Stack:** TypeScript, Fastify, AI SDK, PostgreSQL, pg-boss, Vitest.
**Spec:** `docs/design.md`.

## Constraints

- Node 24+. One trusted owner per installation.
- No local Docker or PostgreSQL daemon for verification.
- Keys stay in environment variables. Models are explicitly configured.
- No automatic replay of interrupted external tools.

## Execution

- [x] Domain and storage: `src/domain.ts`, `src/storage.ts`, `src/postgres.ts`; use `tests/gateway.test.ts` to verify profile isolation, transactional enqueue, deduplication, concurrency and version conflicts before implementing `Gateway`.
- [x] Agent execution: `src/runtime.ts`, `src/providers.ts`, `src/tools.ts`; `tests/runtime.test.ts` proves shared memory updates between steps, provider snapshots, bounded context and failure handling with scripted AI SDK models.
- [x] HTTP and scheduling: `src/app.ts`, `src/queue.ts`, `src/main.ts`; `tests/app.test.ts` checks auth, strict inputs, API errors, replayable events and requests across sessions.
- [x] Deployment: `Dockerfile`, `compose.yaml`, `.github/workflows/ci.yml`, `.env.example`, `README.md`; CI runs the PostgreSQL adapter and queue contract in `tests/postgres.test.ts`.
- [x] Verification: run `npm run check`; smoke-test the compiled server with injected test storage; record checks not run.

## Resultado

`npm run check`: 25 testes locais, typecheck e build passaram. O teste MCP usa um servidor HTTP local e os modelos são os doubles oficiais do AI SDK. Inicialização compilada contra banco indisponível encerra com código 1 sem expor credenciais. Docker, PostgreSQL real, CI remota e chamadas com provider real ainda não foram executados.
