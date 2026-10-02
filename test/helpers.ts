import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import type { Logger } from '../src/actions-io.js';

export const ADDRESS_1 = '0x0000000000000000000000000000000000000001';
export const ADDRESS_2 = '0x0000000000000000000000000000000000000002';
export const TX_HASH = '0x00000000000000000000000000000000000000000000000000000000000000aa';
export const COMMIT = '0123456789abcdef0123456789abcdef01234567';
/** sha256("abc") — the FIPS 180-2 test vector. */
export const SHA256_ABC = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
export const SHA256_EMPTY = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

export interface TempWorkspace {
  root: string;
  write(rel: string, content: string | Buffer): string;
  mkdir(rel: string): string;
  path(rel: string): string;
  cleanup(): void;
}

/** A throwaway directory standing in for GITHUB_WORKSPACE, plus a sibling "outside" folder. */
export function tempWorkspace(): TempWorkspace {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'hey-ship-test-')));
  const root = join(base, 'workspace');
  mkdirSync(root);
  mkdirSync(join(base, 'outside'));
  writeFileSync(join(base, 'outside', 'secret.txt'), 'outside the workspace');
  return {
    root,
    write(rel, content) {
      const abs = join(root, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content);
      return abs;
    },
    mkdir(rel) {
      const abs = join(root, rel);
      mkdirSync(abs, { recursive: true });
      return abs;
    },
    path: (rel) => join(root, rel),
    cleanup: () => rmSync(base, { recursive: true, force: true }),
  };
}

/** The variables a GitHub-hosted runner sets for a push to a tag. */
export function githubEnv(workspace: string, extra: Record<string, string> = {}) {
  return {
    GITHUB_REPOSITORY: 'example-org/example-protocol',
    GITHUB_SERVER_URL: 'https://github.com',
    GITHUB_SHA: COMMIT,
    GITHUB_REF: 'refs/tags/v1.2.0',
    GITHUB_REF_NAME: 'v1.2.0',
    GITHUB_REF_TYPE: 'tag',
    GITHUB_RUN_ID: '1234567890',
    GITHUB_RUN_ATTEMPT: '1',
    GITHUB_EVENT_NAME: 'push',
    GITHUB_WORKFLOW_REF:
      'example-org/example-protocol/.github/workflows/deploy.yml@refs/tags/v1.2.0',
    GITHUB_WORKFLOW_SHA: COMMIT,
    GITHUB_WORKSPACE: workspace,
    ...extra,
  } as Record<string, string>;
}

export function captureLogger(): Logger & { lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    info: (m) => lines.push(`info: ${m}`),
    warning: (m) => lines.push(`warning: ${m}`),
    error: (m) => lines.push(`error: ${m}`),
  };
}

export const FIXED_NOW = () => new Date('2026-10-02T12:00:00.000Z');
