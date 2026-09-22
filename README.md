# Jian

Jian is a self-hosted gateway that gives AI agents a persistent identity. A profile keeps
its own instructions, model, memory and tools, and every session and channel that belongs
to it works from that same context — so a conversation started on WhatsApp continues in
the web panel without repeating anything.

It runs on your own server. Provider keys stay in an encrypted vault on your machine, not
in a vendor's account.

The name is the jian, the one-winged bird of the 比翼の鳥, which cannot fly by itself and
takes off only once it is joined to another. That is the thesis: things that only work
connected.

## What it does

- **Profiles as identity.** Versioned role, tone, goals and boundaries, with their own
  model, context budget, skills and MCP servers.
- **Memory that survives the session.** Explicit memories, paginated history search, and
  messages passed between parallel sessions.
- **A context budget you control.** Per-step and per-run limits, relevant memories only,
  tool schemas loaded on demand instead of flooding the prompt.
- **Channels.** WhatsApp, Telegram and HTTP webhooks, each with explicit allowlists, so no
  channel inherits the owner's privileges.
- **A vault, not a config file.** Provider, MCP and channel credentials encrypted with
  AES-256-GCM. Client keys are scoped, expiring and revocable.
- **A typed contract.** OpenAPI 3.1 generated from the schemas the server validates
  against, with a TypeScript SDK and a Swift client generated from the same document.
- **A web panel** for profiles, usage, memories, skills, MCP servers, credentials and keys.

Isolation is per profile. One installation serves one trusted owner; it is not a
multi-tenant SaaS.

## Clients

The web panel ships inside the gateway. **Jian**, a native SwiftUI app for iOS and
macOS, lives in `apps/apple` and talks to the same contract.

## Repository

```text
apps/gateway/       HTTP API, runtime and workers
apps/gateway-ui/    Web panel, exported into the gateway
apps/apple/         Jian, iOS and macOS
packages/contracts/ Zod schemas — the source of the HTTP contract
packages/sdk/       Generated TypeScript client
docs/               Architecture, security, channels, panel
```

## Running it

Node.js 24+, pnpm 11.9.0 and Docker for the local database.

```bash
pnpm install --frozen-lockfile
pnpm setup
pnpm db:up
pnpm dev
```

`pnpm setup` writes a `.env` with local credentials and an encryption key, and never
prints a secret. `pnpm dev` serves the API on `127.0.0.1:4310` and the panel with hot
reload on `http://localhost:3000/ui/`.

To host it, build the image from the `Dockerfile` and point `DATABASE_URL` at your
PostgreSQL. Put an HTTPS proxy in front of it for anything beyond localhost.

[Getting started](docs/getting-started.md) walks through creating the first profile and
sending the first message. See also [architecture](docs/architecture.md),
[security](docs/security.md), [channels](docs/channels.md) and
[the web panel](docs/gateway-ui.md).

## Status

Early. The contract, the vault and the runtime are in place; the native client currently
signs in and lists profiles. Interfaces may still change.

Apache 2.0 — see [LICENSE](LICENSE) and [CONTRIBUTING.md](CONTRIBUTING.md).
