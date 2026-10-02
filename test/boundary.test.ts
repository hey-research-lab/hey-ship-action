import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ADDRESS_1, type TempWorkspace, githubEnv, tempWorkspace } from './helpers.js';

const repoFile = (rel: string) => new URL(`../${rel}`, import.meta.url);
const srcFiles = readdirSync(repoFile('src')).filter((f) => f.endsWith('.ts'));
const NETWORK_MODULES =
  /from ['"](?:node:)?(?:http|https|http2|net|tls|dgram|dns|child_process|worker_threads)['"]/;

describe('boundaries', () => {
  it.each(srcFiles)('src/%s imports no network or process module', (file) => {
    const text = readFileSync(repoFile(`src/${file}`), 'utf8');
    expect(text).not.toMatch(NETWORK_MODULES);
    expect(text).not.toMatch(/\bfetch\(|\beval\(|new Function\(/);
  });

  it('the committed bundle holds no network, process or fetch call', () => {
    const dist = readFileSync(repoFile('dist/index.js'), 'utf8');
    expect(dist).not.toMatch(
      /["'](?:node:)?(?:http|https|http2|net|tls|dgram|dns|child_process)["']/,
    );
    expect(dist).not.toMatch(/\bfetch\(/);
  });

  it('action.yml runs the bundle on node24 with the documented inputs and outputs', () => {
    const yml = readFileSync(repoFile('action.yml'), 'utf8');
    expect(yml).toMatch(/^\s+using: node24$/m);
    expect(yml).toMatch(/^\s+main: dist\/index\.js$/m);
    for (const input of [
      'contracts',
      'deployment-tx',
      'release',
      'artifacts',
      'manifest-path',
      'output-path',
      'attest',
    ]) {
      expect(yml).toMatch(new RegExp(`^  ${input}:$`, 'm'));
    }
    for (const output of ['evidence-path', 'evidence-sha256']) {
      expect(yml).toMatch(new RegExp(`^  ${output}:$`, 'm'));
    }
  });
});

describe('the committed bundle', () => {
  let ws: TempWorkspace;
  beforeEach(() => {
    ws = tempWorkspace();
  });
  afterEach(() => ws.cleanup());

  it('runs as the runner would run it', () => {
    const output = join(ws.root, '..', 'github_output');
    const stdout = execFileSync(process.execPath, [repoFile('dist/index.js').pathname], {
      env: {
        ...githubEnv(ws.root),
        GITHUB_OUTPUT: output,
        INPUT_CONTRACTS: ADDRESS_1,
        INPUT_RELEASE: 'v1.2.0',
        'INPUT_MANIFEST-PATH': 'auto',
        'INPUT_OUTPUT-PATH': 'hey-ship.json',
        INPUT_ATTEST: 'false',
      },
      encoding: 'utf8',
    });
    expect(stdout).toContain('Wrote hey.ship/v1 evidence to hey-ship.json');
    const doc = JSON.parse(readFileSync(join(ws.root, 'hey-ship.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    expect(doc).toMatchObject({ schema: 'hey.ship/v1', chainId: 4663, contracts: [ADDRESS_1] });
    expect(readFileSync(output, 'utf8')).toMatch(/^evidence-sha256<<ghadelimiter_/m);
  });

  it('fails with a workflow error command and exit code 1 on bad input', () => {
    let status = 0;
    let stdout = '';
    try {
      execFileSync(process.execPath, [repoFile('dist/index.js').pathname], {
        env: { ...githubEnv(ws.root), INPUT_RELEASE: 'latest' },
        encoding: 'utf8',
      });
    } catch (error) {
      const failure = error as { status: number; stdout: string };
      status = failure.status;
      stdout = failure.stdout;
    }
    expect(status).toBe(1);
    expect(stdout).toMatch(/^::error title=hey-ship-action%3A rolling_tag_release::/m);
  });
});
