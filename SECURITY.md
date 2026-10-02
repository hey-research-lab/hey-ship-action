# Security policy

## Reporting a vulnerability

Please report privately through GitHub's "Report a vulnerability" (Security → Advisories) on this
repository, or email hi@heyresearch.xyz with "security" in the subject. Do not open a public issue.
We aim to acknowledge within 3 working days. There is no bug bounty for this repository.

## Scope

hey-ship-action runs inside other people's workflows, so it is supply-chain code. What it does
with untrusted input:

- **Inputs are data, never shell.** The action is a JavaScript action: inputs reach it as
  environment variables (`INPUT_*`) and are parsed in-process. It never runs a shell, a child
  process or `eval`, and no input is ever interpolated into a command. Every input is validated
  against a fixed shape (addresses, transaction hashes, a tag-like release name, relative paths)
  before it is used; anything else fails the step. Messages quote rejected values JSON-escaped and
  truncated, and log lines are escaped so a value cannot start a workflow command.
- **Files stay inside the workspace.** Artifact, manifest and output paths must be relative to
  `GITHUB_WORKSPACE`, without `.`/`..` segments, backslashes or control characters. Every path
  component is checked with `lstat`; a symbolic link anywhere on the path is refused, files are
  opened with `O_NOFOLLOW` and re-checked with `fstat` on the open descriptor. Sizes are capped
  (1 GiB per hashed artifact, 1 MiB for the parsed manifest, 256 artifacts, 100 contracts).
- **Parsed JSON** (the manifest) is size-capped and refuses `__proto__`, `constructor` and
  `prototype` keys anywhere in the document.
- **No network.** The action makes no network call and never contacts HEY. The tests fail if a
  source file imports a network or process module, and if the committed bundle contains one.
- **Runner variables** (`GITHUB_*`) are validated too: an unexpected shape fails the step rather
  than flowing into the evidence.
- **`pull_request_target` is refused.** That event runs with the base repository's privileges on
  code from outside it; evidence written there would name the base repository for code it did not
  review. On `pull_request`, `commit` is GitHub's merge commit and `workflowRun.event` says so.

### Token permissions

The action needs **no token** and reads none. Recommended permissions:

| Job                            | Permissions                                                |
| ------------------------------ | ---------------------------------------------------------- |
| Writes evidence only           | `contents: read`                                           |
| Writes and attests evidence    | `contents: read`, `id-token: write`, `attestations: write` |
| Attaches the file to a release | `contents: write`, in a separate job without `id-token`    |

Keep deployer keys and `id-token: write` in different jobs (see
[`examples/deploy-and-attest.yml`](examples/deploy-and-attest.yml)). With `attest: true` the
action only checks that the runner offers an OIDC token request (the presence of
`ACTIONS_ID_TOKEN_REQUEST_URL` and `ACTIONS_ID_TOKEN_REQUEST_TOKEN`); it never requests a token and
never logs either value. Signing is done by GitHub's `actions/attest-build-provenance`, not here.

In workflows: never use `pull_request_target` with this action, check out with
`persist-credentials: false`, pass secrets and event fields to `run:` steps through `env:` (never
`${{ }}` inside a script), and pin third-party actions — this one included — to a full commit SHA.

### The committed bundle

The action runs `dist/index.js`, a single file built from `src/` with every dependency bundled
(zod and `@noble/hashes`). CI rebuilds it and fails if the committed copy differs, so the bundle
can be reviewed as the output of the reviewed source and the lockfile.

## Handling secrets

This project never needs HEY credentials, or any credential. It reads no token from the
environment and writes nothing but the evidence file and the step outputs. Never commit a `.env`
with values.

## Supported versions

The latest 0.x minor receives fixes.
