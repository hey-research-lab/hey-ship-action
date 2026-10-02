# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

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
