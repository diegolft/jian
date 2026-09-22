# Jian

Native SwiftUI client for a self-hosted Jian gateway. One target builds for both iOS and
macOS. Open `Jian.xcodeproj` in Xcode 27 or later.

The first build asks you to trust the OpenAPI generator plugin ("Trust & Enable"). From the
command line, pass `-skipPackagePluginValidation` instead — `pnpm apple:build` already does.

## Where the types come from

`Packages/JianKit` holds everything testable. Its `JianAPI` target carries a copy of the
gateway's OpenAPI document and generates the Swift client from it on every build, so no
generated Swift is committed and the client cannot drift from the contract.

That copy is written by `pnpm contracts:generate` at the repository root, from the same zod
schemas that produce the gateway routes and the TypeScript client. `pnpm check` runs
`contracts:check`, which fails when the copy is stale — so changing a contract without
regenerating breaks the build rather than the app at runtime.

```bash
pnpm contracts:generate   # after changing packages/contracts
pnpm apple:test           # JianKit unit tests, no network, no gateway
```

## Scope

One sign-in screen and a profile list, enough to prove the contract, the transport and the
stored credential work end to end. The gateway URL and the scoped access key live in the
Keychain, never in UserDefaults and never in logs.

Generated types nest a full copy of every schema inside each operation, because the OpenAPI
document inlines schemas instead of referencing shared components. `JianKit` maps them to
small domain models so the app never touches a generated type.

## Linting

SwiftLint enforces the Swift style, configured in `.swiftlint.yml`. It runs on staged Swift
files before each commit, the same way Biome guards the TypeScript side, so it must be
installed (`brew install swiftlint`) to commit Swift changes.

```bash
pnpm apple:lint       # fails on any violation
pnpm apple:lint:fix   # rewrites what can be fixed automatically
```

## Editing outside Xcode

Editors that use sourcekit-lsp understand Swift packages, not Xcode targets, so the files
under `Jian/` show phantom errors even when the build is clean. `pnpm apple:index`
writes a bridge (`buildServer.json` plus a compile database) that hands sourcekit-lsp the
real compiler arguments for the app target. Both files hold absolute paths, so they stay out
of git; rerun the command after adding a file or changing build settings, then reload the
editor window.
