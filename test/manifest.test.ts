import { readFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ShipEvidenceError } from '../src/errors.js';
import { checkManifest, parseJsonStrict, readManifestReference } from '../src/manifest.js';
import { workspaceRoot } from '../src/paths.js';
import { type TempWorkspace, tempWorkspace } from './helpers.js';

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/manifests/${name}`, import.meta.url));

async function codeOfAsync(fn: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await fn();
  } catch (error) {
    return error instanceof ShipEvidenceError ? error.code : `unexpected: ${String(error)}`;
  }
  return undefined;
}
function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return error instanceof ShipEvidenceError ? error.code : `unexpected: ${String(error)}`;
  }
  return undefined;
}

let ws: TempWorkspace;
beforeEach(() => {
  ws = tempWorkspace();
});
afterEach(() => ws.cleanup());

describe('checkManifest', () => {
  it('accepts version 1 on chain 4663', () => {
    expect(checkManifest(fixture('valid.json'), 'm')).toEqual({ version: 1, chainId: 4663 });
  });
  it('accepts a byte-order mark', () => {
    expect(
      checkManifest(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), fixture('valid.json')]), 'm'),
    ).toEqual({
      version: 1,
      chainId: 4663,
    });
  });
  it.each([
    ['other-chain.json', 'unsupported_chain'],
    ['chain-as-string.json', 'unsupported_chain'],
    ['no-chain.json', 'invalid_manifest'],
    ['wrong-version.json', 'invalid_manifest'],
    ['proto-pollution.json', 'invalid_manifest'],
    ['array.json', 'invalid_manifest'],
    ['truncated.json', 'invalid_manifest'],
  ])('refuses %s (%s)', (name, code) => {
    expect(codeOf(() => checkManifest(fixture(name), name))).toBe(code);
  });
  it('names the chain in the unsupported_chain message', () => {
    expect(() => checkManifest(fixture('other-chain.json'), 'm')).toThrow(
      'HEY supports Robinhood Chain (4663) only; chain 1 is not supported.',
    );
  });
  it('refuses constructor and prototype keys at any depth', () => {
    expect(() => parseJsonStrict('{"a":{"constructor":{"prototype":{}}}}')).toThrow(
      /forbidden key/,
    );
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('readManifestReference', () => {
  it('finds .well-known/hey-project.json automatically and hashes its exact bytes', async () => {
    const bytes = fixture('valid.json');
    ws.write('.well-known/hey-project.json', bytes);
    const root = await workspaceRoot(ws.root);
    const { createHash } = await import('node:crypto');
    expect(await readManifestReference(root, 'auto')).toEqual({
      path: '.well-known/hey-project.json',
      sha256: createHash('sha256').update(bytes).digest('hex'),
      version: 1,
      chainId: 4663,
    });
  });
  it('falls back to public/.well-known', async () => {
    ws.write('public/.well-known/hey-project.json', fixture('valid.json'));
    const root = await workspaceRoot(ws.root);
    expect((await readManifestReference(root, 'auto'))?.path).toBe(
      'public/.well-known/hey-project.json',
    );
  });
  it('leaves the reference out when auto finds nothing, or when set to none', async () => {
    const root = await workspaceRoot(ws.root);
    expect(await readManifestReference(root, 'auto')).toBeUndefined();
    ws.write('.well-known/hey-project.json', fixture('valid.json'));
    expect(await readManifestReference(root, 'none')).toBeUndefined();
  });
  it('requires an explicit path to exist', async () => {
    const root = await workspaceRoot(ws.root);
    expect(
      await codeOfAsync(() => readManifestReference(root, { path: 'site/hey-project.json' })),
    ).toBe('manifest_not_found');
    expect(
      await codeOfAsync(() => readManifestReference(root, { path: '../hey-project.json' })),
    ).toBe('unsafe_path');
  });
  it('refuses a symlinked manifest, even in auto mode', async () => {
    ws.write('real.json', fixture('valid.json'));
    ws.mkdir('.well-known');
    symlinkSync(join(ws.root, 'real.json'), ws.path('.well-known/hey-project.json'));
    const root = await workspaceRoot(ws.root);
    expect(await codeOfAsync(() => readManifestReference(root, 'auto'))).toBe('symlink_refused');
  });
  it('fails on an invalid manifest it found', async () => {
    ws.write('.well-known/hey-project.json', fixture('other-chain.json'));
    const root = await workspaceRoot(ws.root);
    expect(await codeOfAsync(() => readManifestReference(root, 'auto'))).toBe('unsupported_chain');
  });
});
