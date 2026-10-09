# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## 0.1.2 — 2026-10-09

- A `release` that is a date-stamped or CI build-stamp tag (`data-2026-10-01`,
  `backend-202610010354-6802318`, `server-image-1234-1`, `build-123`, `ci-456`) is written with a
  warning: HEY's rule as of 2026-10-09 never counts such a tag as a release ship. It is not refused,
  so the `hey.ship/v1` schema accepts exactly what it accepted before. `isAutomatedTag` is exported
  beside `isRollingTag`.
- `generator.version` is `0.1.2`; README and examples use `@v0.1.2`.

## 0.1.1 — 2026-10-02

- `manifest-path: auto` also looks under `site/`, `web/`, `docs/`, `website/static/`, `app/public/`, `frontend/public/` and `apps/web/public/`, and logs a line when it finds no manifest.
- `artifacts`: a glob is refused with `invalid_input` and a message that says globs are not expanded (it read as `path_not_found`). Paths with brackets still work.
- Issue templates (bug, idea) with private security reporting and HEY corrections linked.

## 0.1.0 — 2026-10-02

Initial release.

### Added

- `action.yml` (`runs.using: node24`) with inputs `contracts`, `deployment-tx`, `release`,
  `artifacts`, `manifest-path`, `output-path`, `attest` and outputs `evidence-path`,
  `evidence-sha256`.
- The `hey.ship/v1` evidence document: JSON Schema (`schema/hey-ship.v1.json`), zod schema and
  TypeScript types, built from the GitHub Actions environment (`GITHUB_REPOSITORY`, `GITHUB_SHA`,
  `GITHUB_REF*`, `GITHUB_RUN_ID`/`ATTEMPT`, `GITHUB_SERVER_URL`, `GITHUB_EVENT_NAME`,
  `GITHUB_WORKFLOW_REF`/`SHA`), `declarationState: DECLARED`, `chainId: 4663` only.
- Validation of contract addresses (EIP-55 for mixed case; zero/dead and duplicates refused),
  deployment transaction hashes and release names; rolling tags refused as a release.
- sha256 of listed artifacts, confined to the workspace with no symbolic link followed.
- An optional reference (path + sha256) to the project's `hey-project.json`, checked for
  `version: 1` and `chainId: 4663`.
- `attest: true` early check for `id-token: write`; example workflows composing
  `actions/attest-build-provenance` with least-privilege permissions.
- A committed single-file bundle (`dist/index.js`) with a CI freshness check, fixtures and tests.
