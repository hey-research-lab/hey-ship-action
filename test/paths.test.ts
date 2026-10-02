import { readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ShipEvidenceError } from '../src/errors.js';
import { confine, hashFile, readSmallFile, workspaceRoot, writeFileInside } from '../src/paths.js';
import { SHA256_ABC, SHA256_EMPTY, type TempWorkspace, tempWorkspace } from './helpers.js';

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

describe('confine', () => {
  it('normalises a leading ./ and keeps POSIX relative form', () => {
    expect(confine('/w', './out/a.json', 'artifact')).toEqual({
      rel: 'out/a.json',
      abs: join('/w', 'out', 'a.json'),
      parts: ['out', 'a.json'],
    });
  });

  it.each([
    '../secret.txt',
    '../../etc/passwd',
    'out/../../secret.txt',
    'out/../a.json',
    'out/./a.json',
    'out//a.json',
    'out/',
    '.',
    '..',
    '/etc/passwd',
    '//server/share',
    'C:\\Windows\\win.ini',
    'c:/windows/win.ini',
    'out\\..\\..\\secret.txt',
    'a\u0000b',
    'a\nb',
    '',
    '   ',
    'a/'.repeat(17) + 'f',
    'x'.repeat(1025),
  ])('refuses %j', (value) => {
    expect(codeOf(() => confine('/w', value, 'artifact'))).toBe('unsafe_path');
  });
});

describe('hashFile', () => {
  it('hashes a regular file inside the workspace', async () => {
    ws.write('out/abc.txt', 'abc');
    ws.write('empty.txt', '');
    const root = await workspaceRoot(ws.root);
    expect(await hashFile(root, confine(root, 'out/abc.txt', 'artifact'), 'artifact')).toEqual({
      sha256: SHA256_ABC,
      bytes: 3,
    });
    expect(await hashFile(root, confine(root, 'empty.txt', 'artifact'), 'artifact')).toEqual({
      sha256: SHA256_EMPTY,
      bytes: 0,
    });
  });

  it('streams large files correctly', async () => {
    const big = Buffer.alloc(3 * 1024 * 1024 + 7, 0x61);
    ws.write('big.bin', big);
    const root = await workspaceRoot(ws.root);
    const { createHash } = await import('node:crypto');
    expect(await hashFile(root, confine(root, 'big.bin', 'artifact'), 'artifact')).toEqual({
      sha256: createHash('sha256').update(big).digest('hex'),
      bytes: big.length,
    });
  });

  it('refuses a symlink to a file outside the workspace', async () => {
    symlinkSync(join(ws.root, '..', 'outside', 'secret.txt'), ws.path('link.txt'));
    const root = await workspaceRoot(ws.root);
    expect(
      await codeOfAsync(() => hashFile(root, confine(root, 'link.txt', 'artifact'), 'artifact')),
    ).toBe('symlink_refused');
  });

  it('refuses a symlink even when it points inside the workspace', async () => {
    ws.write('real.txt', 'abc');
    symlinkSync(ws.path('real.txt'), ws.path('alias.txt'));
    const root = await workspaceRoot(ws.root);
    expect(
      await codeOfAsync(() => hashFile(root, confine(root, 'alias.txt', 'artifact'), 'artifact')),
    ).toBe('symlink_refused');
  });

  it('refuses a path through a symlinked directory', async () => {
    symlinkSync(join(ws.root, '..', 'outside'), ws.path('escape'));
    const root = await workspaceRoot(ws.root);
    expect(
      await codeOfAsync(() =>
        hashFile(root, confine(root, 'escape/secret.txt', 'artifact'), 'artifact'),
      ),
    ).toBe('symlink_refused');
  });

  it('refuses directories, missing files, paths through files and oversized files', async () => {
    ws.mkdir('out');
    ws.write('file.txt', 'abc');
    const root = await workspaceRoot(ws.root);
    const hash = (rel: string, max?: number) =>
      codeOfAsync(() => hashFile(root, confine(root, rel, 'artifact'), 'artifact', max));
    expect(await hash('out')).toBe('not_a_regular_file');
    expect(await hash('missing.txt')).toBe('path_not_found');
    expect(await hash('missing/dir/file.txt')).toBe('path_not_found');
    expect(await hash('file.txt/inner')).toBe('unsafe_path');
    expect(await hash('file.txt', 2)).toBe('file_too_large');
  });

  it('works when the workspace itself sits behind a symlink', async () => {
    ws.write('a.txt', 'abc');
    const alias = join(ws.root, '..', 'alias-workspace');
    symlinkSync(ws.root, alias);
    const root = await workspaceRoot(alias);
    expect(root).toBe(ws.root);
    expect((await hashFile(root, confine(root, 'a.txt', 'artifact'), 'artifact')).sha256).toBe(
      SHA256_ABC,
    );
  });

  it('refuses a workspace that is not a directory', async () => {
    expect(await codeOfAsync(() => workspaceRoot(ws.path('nope')))).toBe('invalid_env');
  });
});

describe('readSmallFile', () => {
  it('caps parsed files', async () => {
    ws.write('m.json', 'x'.repeat(100));
    const root = await workspaceRoot(ws.root);
    expect(
      await codeOfAsync(() =>
        readSmallFile(root, confine(root, 'm.json', 'manifest'), 'manifest', 10),
      ),
    ).toBe('file_too_large');
  });
});

describe('writeFileInside', () => {
  it('writes a new file and creates parent directories', async () => {
    const root = await workspaceRoot(ws.root);
    await writeFileInside(
      root,
      confine(root, 'evidence/deep/ship.json', 'output-path'),
      'output-path',
      Buffer.from('{}\n'),
    );
    expect(readFileSync(ws.path('evidence/deep/ship.json'), 'utf8')).toBe('{}\n');
  });

  it('replaces an existing regular file', async () => {
    ws.write('hey-ship.json', 'old content that is longer');
    const root = await workspaceRoot(ws.root);
    await writeFileInside(
      root,
      confine(root, 'hey-ship.json', 'output-path'),
      'output-path',
      Buffer.from('new'),
    );
    expect(readFileSync(ws.path('hey-ship.json'), 'utf8')).toBe('new');
  });

  it('refuses to write through a symlink at the file', async () => {
    const outside = join(ws.root, '..', 'outside', 'secret.txt');
    symlinkSync(outside, ws.path('hey-ship.json'));
    const root = await workspaceRoot(ws.root);
    expect(
      await codeOfAsync(() =>
        writeFileInside(
          root,
          confine(root, 'hey-ship.json', 'output-path'),
          'output-path',
          Buffer.from('x'),
        ),
      ),
    ).toBe('symlink_refused');
    expect(readFileSync(outside, 'utf8')).toBe('outside the workspace');
  });

  it('refuses a dangling symlink at the file', async () => {
    symlinkSync(join(ws.root, '..', 'outside', 'new.txt'), ws.path('hey-ship.json'));
    const root = await workspaceRoot(ws.root);
    expect(
      await codeOfAsync(() =>
        writeFileInside(
          root,
          confine(root, 'hey-ship.json', 'output-path'),
          'output-path',
          Buffer.from('x'),
        ),
      ),
    ).toBe('symlink_refused');
  });

  it('refuses to write through a symlinked directory', async () => {
    symlinkSync(join(ws.root, '..', 'outside'), ws.path('evidence'));
    const root = await workspaceRoot(ws.root);
    expect(
      await codeOfAsync(() =>
        writeFileInside(
          root,
          confine(root, 'evidence/ship.json', 'output-path'),
          'output-path',
          Buffer.from('x'),
        ),
      ),
    ).toBe('symlink_refused');
  });

  it('refuses to replace a directory', async () => {
    ws.mkdir('hey-ship.json');
    const root = await workspaceRoot(ws.root);
    expect(
      await codeOfAsync(() =>
        writeFileInside(
          root,
          confine(root, 'hey-ship.json', 'output-path'),
          'output-path',
          Buffer.from('x'),
        ),
      ),
    ).toBe('not_a_regular_file');
  });

  it('never escapes the workspace by name', () => {
    writeFileSync(join(ws.root, '..', 'outside', 'keep.txt'), 'keep');
    expect(codeOf(() => confine(ws.root, '../outside/keep.txt', 'output-path'))).toBe(
      'unsafe_path',
    );
  });
});
