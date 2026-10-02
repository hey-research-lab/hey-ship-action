import { readFileSync, symlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ShipEvidenceError } from '../src/errors.js';
import { run } from '../src/run.js';
import { ShipEvidenceSchema } from '../src/schema.js';
import {
  ADDRESS_1,
  ADDRESS_2,
  COMMIT,
  FIXED_NOW,
  SHA256_ABC,
  TX_HASH,
  type TempWorkspace,
  captureLogger,
  githubEnv,
  tempWorkspace,
} from './helpers.js';

let ws: TempWorkspace;
let outputFile: string;
beforeEach(() => {
  ws = tempWorkspace();
  outputFile = join(ws.root, '..', 'github_output');
});
afterEach(() => ws.cleanup());

/** Parse the runner's GITHUB_OUTPUT heredoc format. */
function readOutputs(file: string): Record<string, string> {
  const text = readFileSync(file, 'utf8');
  const out: Record<string, string> = {};
  const re = /^([A-Za-z_][\w-]*)<<(ghadelimiter_[0-9a-f-]+)\n([\s\S]*?)\n\2\n/gm;
  for (const m of text.matchAll(re)) out[m[1]!] = m[3]!;
  return out;
}

const envFor = (inputs: Record<string, string>, extra: Record<string, string> = {}) => ({
  ...githubEnv(ws.root, { GITHUB_OUTPUT: outputFile, ...extra }),
  ...Object.fromEntries(Object.entries(inputs).map(([k, v]) => [`INPUT_${k.toUpperCase()}`, v])),
});

async function codeOfAsync(fn: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await fn();
  } catch (error) {
    return error instanceof ShipEvidenceError ? error.code : `unexpected: ${String(error)}`;
  }
  return undefined;
}

describe('run', () => {
  it('writes a complete hey.ship/v1 document and its outputs', async () => {
    ws.write('out/Token.sol/Token.json', 'abc');
    const manifest = readFileSync(new URL('./fixtures/manifests/valid.json', import.meta.url));
    ws.write('.well-known/hey-project.json', manifest);
    const log = captureLogger();
    const result = await run(
      envFor({
        contracts: `${ADDRESS_1}\n${ADDRESS_2}`,
        'deployment-tx': TX_HASH,
        release: 'v1.2.0',
        artifacts: 'out/Token.sol/Token.json',
      }),
      { now: FIXED_NOW, log },
    );

    const written = readFileSync(ws.path('hey-ship.json'));
    expect(JSON.parse(written.toString('utf8'))).toEqual({
      schema: 'hey.ship/v1',
      declarationState: 'DECLARED',
      chainId: 4663,
      repository: 'example-org/example-protocol',
      repositoryUrl: 'https://github.com/example-org/example-protocol',
      commit: COMMIT,
      ref: 'refs/tags/v1.2.0',
      refName: 'v1.2.0',
      refType: 'tag',
      release: 'v1.2.0',
      timestamp: '2026-10-02T12:00:00.000Z',
      workflowRun: {
        id: '1234567890',
        attempt: 1,
        url: 'https://github.com/example-org/example-protocol/actions/runs/1234567890/attempts/1',
        event: 'push',
        workflowRef: 'example-org/example-protocol/.github/workflows/deploy.yml@refs/tags/v1.2.0',
        workflowSha: COMMIT,
      },
      contracts: [ADDRESS_1, ADDRESS_2],
      deploymentTx: TX_HASH,
      artifactHashes: [{ path: 'out/Token.sol/Token.json', sha256: SHA256_ABC, bytes: 3 }],
      manifest: {
        path: '.well-known/hey-project.json',
        sha256: createHash('sha256').update(manifest).digest('hex'),
        version: 1,
        chainId: 4663,
      },
      generator: { name: 'hey-ship-action', version: '0.1.1' },
    });
    expect(ShipEvidenceSchema.safeParse(JSON.parse(written.toString('utf8'))).success).toBe(true);

    const sha = createHash('sha256').update(written).digest('hex');
    expect(result).toMatchObject({ evidencePath: 'hey-ship.json', evidenceSha256: sha });
    expect(readOutputs(outputFile)).toEqual({
      'evidence-path': 'hey-ship.json',
      'evidence-sha256': sha,
    });
    expect(log.lines.join('\n')).toContain('does not publish or verify anything on HEY');
  });

  it('writes the same bytes for the same facts', async () => {
    const env = envFor({ release: 'v1.2.0' });
    const first = await run(env, { now: FIXED_NOW, log: captureLogger() });
    const second = await run(env, { now: FIXED_NOW, log: captureLogger() });
    expect(second.evidenceSha256).toBe(first.evidenceSha256);
  });

  it('leaves unknown facts out instead of writing null, [] or ""', async () => {
    await run(
      envFor(
        { release: 'v0.4.1' },
        {
          GITHUB_REF: '',
          GITHUB_REF_NAME: '',
          GITHUB_REF_TYPE: '',
          GITHUB_WORKFLOW_REF: '',
          GITHUB_WORKFLOW_SHA: '',
        },
      ),
      { now: FIXED_NOW, log: captureLogger() },
    );
    const text = readFileSync(ws.path('hey-ship.json'), 'utf8');
    const doc = JSON.parse(text) as Record<string, unknown>;
    for (const key of [
      'ref',
      'refName',
      'refType',
      'contracts',
      'deploymentTx',
      'artifactHashes',
      'manifest',
    ]) {
      expect(key in doc, key).toBe(false);
    }
    expect(text).not.toMatch(/null|\[\]|""/);
  });

  it('writes to a custom output path and reports it', async () => {
    const result = await run(envFor({ release: 'v1.2.0', 'output-path': './evidence/ship.json' }), {
      now: FIXED_NOW,
      log: captureLogger(),
    });
    expect(result.evidencePath).toBe('evidence/ship.json');
    expect(readOutputs(outputFile)['evidence-path']).toBe('evidence/ship.json');
  });

  it.each(['../escape.json', '/tmp/escape.json', 'a/../../escape.json'])(
    'refuses the output path %j',
    async (path) => {
      expect(
        await codeOfAsync(() =>
          run(envFor({ release: 'v1', 'output-path': path }), { log: captureLogger() }),
        ),
      ).toBe('unsafe_path');
    },
  );

  it('refuses artifact traversal and symlinks without writing anything', async () => {
    symlinkSync(join(ws.root, '..', 'outside', 'secret.txt'), ws.path('link.txt'));
    const tries: Array<[string, string]> = [
      ['../outside/secret.txt', 'unsafe_path'],
      ['link.txt', 'symlink_refused'],
      ['missing.bin', 'path_not_found'],
    ];
    for (const [artifact, code] of tries) {
      expect(
        await codeOfAsync(() =>
          run(envFor({ release: 'v1', artifacts: artifact }), { log: captureLogger() }),
        ),
      ).toBe(code);
    }
    expect(() => readFileSync(ws.path('hey-ship.json'))).toThrow();
  });

  it('refuses duplicate artifacts and an artifact that is the output', async () => {
    ws.write('a.txt', 'abc');
    expect(
      await codeOfAsync(() =>
        run(envFor({ release: 'v1', artifacts: 'a.txt\n./a.txt' }), { log: captureLogger() }),
      ),
    ).toBe('duplicate_artifact');
    ws.write('hey-ship.json', 'old');
    expect(
      await codeOfAsync(() =>
        run(envFor({ release: 'v1', artifacts: 'hey-ship.json' }), { log: captureLogger() }),
      ),
    ).toBe('unsafe_path');
  });

  it('with attest: true, fails early when the job cannot request an OIDC token', async () => {
    expect(
      await codeOfAsync(() =>
        run(envFor({ release: 'v1', attest: 'true' }), { log: captureLogger() }),
      ),
    ).toBe('attest_permission_missing');
    expect(() => readFileSync(ws.path('hey-ship.json'))).toThrow();
  });

  it('with attest: true and id-token permission, writes the file and never logs the token', async () => {
    const log = captureLogger();
    await run(
      envFor(
        { release: 'v1', attest: 'true' },
        {
          ACTIONS_ID_TOKEN_REQUEST_URL: 'https://example.org/token',
          ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'token-value-123',
        },
      ),
      { now: FIXED_NOW, log },
    );
    const text = log.lines.join('\n');
    expect(text).toContain(
      'gh attestation verify hey-ship.json --repo example-org/example-protocol',
    );
    expect(text).not.toContain('token-value-123');
    expect(readFileSync(ws.path('hey-ship.json'), 'utf8')).not.toContain('token-value-123');
  });

  it('warns, and still writes the file, outside a runner (no GITHUB_OUTPUT)', async () => {
    const log = captureLogger();
    const env = envFor({ release: 'v1' });
    delete (env as Record<string, string | undefined>).GITHUB_OUTPUT;
    await run(env, { now: FIXED_NOW, log });
    expect(log.lines.some((l) => l.startsWith('warning: GITHUB_OUTPUT is not set'))).toBe(true);
  });

  it('refuses pull_request_target and other chains in the manifest', async () => {
    expect(
      await codeOfAsync(() =>
        run(envFor({ release: 'v1' }, { GITHUB_EVENT_NAME: 'pull_request_target' }), {
          log: captureLogger(),
        }),
      ),
    ).toBe('untrusted_event');
    ws.write('.well-known/hey-project.json', '{"version":1,"chainId":8453}');
    expect(await codeOfAsync(() => run(envFor({ release: 'v1' }), { log: captureLogger() }))).toBe(
      'unsupported_chain',
    );
  });

  it('treats shell metacharacters in inputs as data, refusing what is not a valid value', async () => {
    expect(
      await codeOfAsync(() => run(envFor({ release: '$(touch pwned)' }), { log: captureLogger() })),
    ).toBe('invalid_release');
    expect(
      await codeOfAsync(() =>
        run(envFor({ contracts: '`touch pwned`' }), { log: captureLogger() }),
      ),
    ).toBe('invalid_address');
    expect(() => readFileSync(ws.path('pwned'))).toThrow();
  });
});
