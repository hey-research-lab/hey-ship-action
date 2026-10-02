# hey-ship-action

A GitHub Action that writes a small, inspectable `hey.ship/v1` JSON file linking the commit or
release a workflow ran on to the Robinhood Chain contracts and deployment transaction it declares,
ready to be attested with GitHub's artifact attestations.

[![CI](https://github.com/hey-research-lab/hey-ship-action/actions/workflows/ci.yml/badge.svg)](https://github.com/hey-research-lab/hey-ship-action/actions/workflows/ci.yml)
[![Licence: MIT](https://img.shields.io/badge/licence-MIT-blue.svg)](LICENSE)
[![Action runtime: node24](https://img.shields.io/badge/action-node24-339933.svg)](action.yml)
[![Robinhood Chain 4663](https://img.shields.io/badge/Robinhood%20Chain-4663-informational.svg)](#why-robinhood-chain-only)

## Why it exists

Builders ship in many places at once: a tag on GitHub, a contract on chain, a release note. Nothing
machine-readable says "this commit, built by this workflow run, is what deployed these contracts in
this transaction". This action writes that statement down in a fixed format, from the GitHub
Actions environment, so anyone can read it, check its hashes and — with an artifact attestation —
check which workflow produced it. It is evidence for a reader to weigh, not a conclusion.

## Why Robinhood Chain only

HEY Research Lab researches projects on Robinhood Chain (chain id `4663`, CAIP-2 `eip155:4663`).
`chainId` in the evidence is the JSON integer `4663`; there is no chain input and no network
option. A `hey-project.json` manifest that declares any other chain fails the step with
`unsupported_chain`.

## Install

```yaml
- uses: hey-research-lab/hey-ship-action@v0.1.1
```

Pin to the full commit SHA of a release in production (`uses: hey-research-lab/hey-ship-action@<sha> # v0.1.0`).
A moving `@v1` tag will be published once the interface is declared stable; until then use the
exact version. The action runs on `node24` from the committed `dist/index.js` and needs no token.

## Smallest working example

```yaml
name: Ship evidence
on:
  release:
    types: [published]
permissions:
  contents: read
jobs:
  evidence:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write
      attestations: write
    steps:
      - uses: actions/checkout@v4
        with:
          persist-credentials: false
      - id: ship
        uses: hey-research-lab/hey-ship-action@v0.1.1
        with:
          contracts: '0x0000000000000000000000000000000000000001'
          release: ${{ github.event.release.tag_name }}
          attest: true
      - uses: actions/attest-build-provenance@v2
        with:
          subject-path: ${{ steps.ship.outputs.evidence-path }}
```

Two complete workflows are in [`examples/`](examples):

- [`deploy-and-attest.yml`](examples/deploy-and-attest.yml) — deploy on a version tag in one job
  (which holds the deployer key and no OIDC permission), then write, hash and attest the evidence
  in a second job (which can request an OIDC token and never sees the key).
- [`release-only.yml`](examples/release-only.yml) — evidence for a published release with no
  deployment, attested, then attached to the release by a third job that alone has
  `contents: write`.

## Reference

### Inputs

| Input           | Default         | Meaning                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `contracts`     | —               | Contract addresses deployed on Robinhood Chain, separated by newlines, commas or spaces (`#` starts a comment). `0x` prefix (never `0X`); a mixed-case address must pass its EIP-55 checksum; the zero and `…dead` addresses are refused; duplicates are refused. Written lowercase. At most 100.                                                                                                      |
| `deployment-tx` | —               | The deployment transaction hash (`0x` + 64 hex digits). Written lowercase.                                                                                                                                                                                                                                                                                                                             |
| `release`       | —               | The release the evidence belongs to, such as `v1.2.0`: letters, digits, `. _ + - /`, up to 128 characters, no `..`. **Rolling tags are refused** (see below).                                                                                                                                                                                                                                          |
| `artifacts`     | —               | Workspace-relative files to hash, **one per line**. No globs, no absolute paths, no `.`/`..` segments, no backslashes; a symbolic link anywhere on the path is refused. At most 256, 1 GiB each.                                                                                                                                                                                                       |
| `manifest-path` | `auto`          | The project's `hey-project.json`. `auto` looks for `.well-known/hey-project.json` under the repository root, `public/`, `static/`, `site/`, `web/`, `docs/`, `website/static/`, `app/public/`, `frontend/public/` and `apps/web/public/`, in that order, and leaves the reference out (with a log line) if none exists. `none` skips it. Any other value is a workspace-relative path that must exist. |
| `output-path`   | `hey-ship.json` | Where to write the evidence, relative to the workspace. Missing parent directories are created; an existing link is refused.                                                                                                                                                                                                                                                                           |
| `attest`        | `false`         | Set `true` when the next step attests the file with `actions/attest-build-provenance`. The action then fails **before writing anything** if the job lacks `id-token: write`. The action never signs anything itself.                                                                                                                                                                                   |

At least one of `contracts`, `deployment-tx` or `release` must be set (`nothing_to_declare`).

### Outputs

| Output            | Meaning                                                                 |
| ----------------- | ----------------------------------------------------------------------- |
| `evidence-path`   | Workspace-relative path of the file written (use it as `subject-path`). |
| `evidence-sha256` | sha256 (hex) of the exact bytes written.                                |

### The `hey.ship/v1` document

JSON Schema (2020-12): [`schema/hey-ship.v1.json`](schema/hey-ship.v1.json), `$id`
`https://raw.githubusercontent.com/hey-research-lab/hey-ship-action/main/schema/hey-ship.v1.json`.
Zod schema and TypeScript types: [`src/schema.ts`](src/schema.ts). The tests hold the two equal over
every fixture in [`test/fixtures/evidence`](test/fixtures/evidence).

```json
{
  "schema": "hey.ship/v1",
  "declarationState": "DECLARED",
  "chainId": 4663,
  "repository": "example-org/example-protocol",
  "repositoryUrl": "https://github.com/example-org/example-protocol",
  "commit": "0123456789abcdef0123456789abcdef01234567",
  "ref": "refs/tags/v1.2.0",
  "refName": "v1.2.0",
  "refType": "tag",
  "release": "v1.2.0",
  "timestamp": "2026-10-02T12:00:00.000Z",
  "workflowRun": {
    "id": "1234567890",
    "attempt": 1,
    "url": "https://github.com/example-org/example-protocol/actions/runs/1234567890/attempts/1",
    "event": "push",
    "workflowRef": "example-org/example-protocol/.github/workflows/deploy.yml@refs/tags/v1.2.0",
    "workflowSha": "0123456789abcdef0123456789abcdef01234567"
  },
  "contracts": ["0x0000000000000000000000000000000000000001"],
  "deploymentTx": "0x00000000000000000000000000000000000000000000000000000000000000aa",
  "artifactHashes": [
    {
      "path": "deploy-record/run-latest.json",
      "sha256": "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
      "bytes": 3
    }
  ],
  "manifest": {
    "path": ".well-known/hey-project.json",
    "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "version": 1,
    "chainId": 4663
  },
  "generator": { "name": "hey-ship-action", "version": "0.1.0" }
}
```

| Field                                   | Source                                                                                                   | Notes                                                                                             |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `schema`, `declarationState`, `chainId` | constants                                                                                                | `declarationState` is always `DECLARED`: a first-party statement, never a verification.           |
| `repository`, `repositoryUrl`           | `GITHUB_REPOSITORY`, `GITHUB_SERVER_URL`                                                                 | GitHub Enterprise Server origins are kept as they are (https only).                               |
| `commit`                                | `GITHUB_SHA`                                                                                             | On `pull_request` events this is GitHub's merge commit; `workflowRun.event` says which event ran. |
| `ref`, `refName`, `refType`             | `GITHUB_REF`, `GITHUB_REF_NAME`, `GITHUB_REF_TYPE`                                                       | Left out when the runner does not set them.                                                       |
| `release`                               | input                                                                                                    | Exactly as given, after validation.                                                               |
| `timestamp`                             | runner clock                                                                                             | When the file was written — not the deployment time.                                              |
| `workflowRun`                           | `GITHUB_RUN_ID`, `GITHUB_RUN_ATTEMPT`, `GITHUB_EVENT_NAME`, `GITHUB_WORKFLOW_REF`, `GITHUB_WORKFLOW_SHA` | `url` points at the exact run attempt.                                                            |
| `contracts`, `deploymentTx`             | inputs                                                                                                   | What the workflow declares it deployed.                                                           |
| `artifactHashes`                        | files in the workspace                                                                                   | sha256 and size at the time of writing.                                                           |
| `manifest`                              | `hey-project.json`                                                                                       | Path and sha256 of the exact bytes; see below.                                                    |
| `generator`                             | this action                                                                                              | Name and version.                                                                                 |

**Absent means not declared.** A fact the workflow did not give or the runner did not set is left
out of the file — never written as `null`, `0`, `[]` or `""`. A missing `manifest` means only that
this action found no manifest at the paths it looked at, not that the project has none.

The same facts always serialise to the same bytes (fixed key order, two-space JSON, trailing
newline), so `evidence-sha256` is reproducible for a given run.

### Rolling tags are never a release

A tag that matches `latest*`, `nightly*`, `*-debug`, or exactly `edge`, `canary`, `dev` or
`snapshot` (case-insensitive) names a moving build that automation cuts again and again, not a
release a team stands behind. HEY does not count such a GitHub release as a release ship, so
`release` refuses them with `rolling_tag_release`. `v1.2.0-dev.3` or `docs-latest` are not rolling
tags. Passing this check is no promise that HEY will count a release: HEY's own quality gate decides.

Known limitation (0.1.0): HEY and hey-project-manifest also treat a data word straight before a
date (`data-2026-10-01`, `backup-2026.10.01`) and a date-plus-commit build stamp
(`backend-202610010354-6802318`) as rolling. This action does not refuse those yet, so it can
write such a `release`; HEY still does not count it as a release ship.

### The manifest reference

`hey-project.json` is the project declaration format defined by
[hey-project-manifest](https://github.com/hey-research-lab/hey-project-manifest). This action does
not depend on that package; it checks only what the reference records:

```json
{
  "version": 1,
  "chainId": 4663,
  "...": "every other field is left to the manifest's own validator"
}
```

The file must be a JSON object of at most 1 MiB with `"version": 1` (`invalid_manifest` otherwise)
and `"chainId": 4663` (`unsupported_chain` for any other value, including the string `"4663"`).
Keys named `__proto__`, `constructor` or `prototype` are refused. Validate the full manifest with
hey-project-manifest's own validator.

### Provenance with GitHub artifact attestations

The action does not sign, hash-chain or timestamp anything itself. Provenance comes from GitHub's
[artifact attestations](https://docs.github.com/actions/security-for-github-actions/using-artifact-attestations):
`actions/attest-build-provenance` requests a short-lived OIDC token for the job, obtains a
Sigstore signing certificate bound to the workflow's identity, and stores a signed
[SLSA provenance](https://slsa.dev/provenance/v1) statement whose subject is the evidence file's
sha256. Give only the attesting job these permissions:

```yaml
permissions:
  contents: read
  id-token: write
  attestations: write
```

Anyone can then check the file offline against the repository's attestations:

```sh
gh attestation verify hey-ship.json --repo example-org/example-protocol
```

A successful verification shows that this exact file was produced by a workflow run in that
repository (and which workflow file, ref and commit). It does not show that what the file says is
true.

### Error codes

The step fails with `::error title=hey-ship-action: <code>::<message>` and exit code 1.

| Code                                                                                                                                   | When                                                                                                        |
| -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `missing_env`, `invalid_env`                                                                                                           | A runner variable is missing or has an unexpected shape (the action must run inside GitHub Actions).        |
| `untrusted_event`                                                                                                                      | The workflow ran on `pull_request_target`.                                                                  |
| `invalid_input`                                                                                                                        | An input is too long or `attest` is not `true`/`false`.                                                     |
| `invalid_address`, `invalid_checksum`, `not_a_contract_identity`, `duplicate_contract`, `too_many_contracts`                           | A `contracts` entry is malformed, fails EIP-55, is the zero/dead address, repeats, or the list is too long. |
| `invalid_tx_hash`                                                                                                                      | `deployment-tx` is not a 32-byte hash.                                                                      |
| `invalid_release`, `rolling_tag_release`                                                                                               | `release` is not a tag-like name, or is a rolling tag.                                                      |
| `nothing_to_declare`                                                                                                                   | None of `contracts`, `deployment-tx`, `release` is set.                                                     |
| `unsafe_path`, `symlink_refused`, `path_not_found`, `not_a_regular_file`, `file_too_large`, `too_many_artifacts`, `duplicate_artifact` | A path escapes the workspace, goes through a link, is missing, is not a file, or exceeds a limit.           |
| `manifest_not_found`, `invalid_manifest`, `unsupported_chain`                                                                          | The manifest is missing (explicit path), malformed, or declares another chain.                              |
| `attest_permission_missing`                                                                                                            | `attest: true` but the job lacks `id-token: write`.                                                         |
| `invalid_evidence`, `output_write_failed`                                                                                              | The document failed its own schema, or the file could not be written.                                       |

## How it relates to HEY Research Lab

HEY Research Lab ([heyresearch.xyz](https://heyresearch.xyz)) researches which Robinhood Chain
projects are still building and what they have shipped. This action gives deploy records a
standard, attestable evidence format that HEY — or anyone — may read later. **It never contacts
HEY**: it makes no network call at all, and nothing it writes is sent anywhere. HEY does not read
these files today; any future reader would go through HEY's private quality gate, which stays
authoritative, and a file never causes HEY to publish, verify or rank a project.

The `hey.ship/v1` schema and types live in this repository rather than in a separate npm package:
the action is their only producer today, and splitting them out can wait until a second consumer
needs them. Developer docs: [heyresearch.xyz/developers](https://heyresearch.xyz/developers).

## What it does NOT prove

Ship evidence records what a workflow says it built and deployed. It does not prove that the contracts belong to the repository's owner, that the deployment is safe, or that HEY will count it as a ship. It never publishes or verifies a project on HEY. An attestation proves which workflow produced the file, not that its contents are true.

HEY Research Lab is an independent research project and is not affiliated with, endorsed by or partnered with Robinhood Markets, Inc. or Robinhood Chain.

## Security

See [SECURITY.md](SECURITY.md). In short: no network calls, no shell, no token needed; every input
is validated as data and never interpolated into a command; reads and writes stay inside the
workspace and never follow a symbolic link; `pull_request_target` is refused.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm build`
(and commit `dist/`), `pnpm scan`. Never commit secrets.

## Licence

[MIT](LICENSE) © 2026 HEY Research Lab
