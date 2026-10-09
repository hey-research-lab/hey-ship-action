# Contributing

Thank you for helping. Issues and pull requests are welcome.

## Setup

Node 22 or later and pnpm 9.15.1 (via `corepack enable`).

```sh
pnpm install
pnpm scan          # leak and attribution scan
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test          # network is blocked in tests
pnpm build         # rebuilds dist/index.js — commit it
```

The action runs the committed `dist/index.js`. Any change under `src/` (or to the lockfile) needs
`pnpm build` and the rebuilt `dist/` in the same commit; CI fails when they differ.

## Rules

- No network calls in the action, and none in tests (fixtures only).
- No `child_process`, shell or `eval`. Inputs are validated data.
- Unknown is left out of the evidence; never written as `null`, `0`, `[]` or `""`.
- Schema changes are additive within `hey.ship/v1`; update `schema/hey-ship.v1.json`,
  `src/schema.ts` and the fixtures together. A change of meaning is a new major (`hey.ship/v2`).
- No new runtime dependency without a reason in the README.
- Never commit secrets, `.env` files with values, or personal paths.
- Commits: conventional and concise (`feat:`, `fix:`, `test:`, `docs:`, `ci:`, `chore:`).

## Maintainers: parity

The chain constants (`src/chain.ts`) and address helpers (`src/evm.ts`) are the HEY Research Lab
ecosystem's shared definitions, identical across its open-source repositories. The rolling-tag
rule (`src/rolling-tag.ts`) restates the rule in HEY Research Lab's production contract as of
2026-10-09; HEY's own quality gate may apply further rules, and
this repository does not try to mirror them. When the published rule changes, update the patterns,
the JSON Schema pattern and the test vectors together.

## Releasing

Tag `vX.Y.Z` on a commit whose `dist/` matches a fresh build. A moving major tag (`v1`) is moved
only once the interface is declared stable.
