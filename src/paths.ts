import { createHash } from 'node:crypto';
import { constants, type Stats } from 'node:fs';
import { lstat, mkdir, open, realpath } from 'node:fs/promises';
import { join } from 'node:path';

import { ShipEvidenceError, quote } from './errors.js';
import { MAX_PATH_LENGTH, isSafeRelativePath } from './schema.js';

/**
 * Every file the action reads or writes sits inside the workspace, named by a relative path
 * without `.` or `..` segments, and is reached without following a symbolic link anywhere along
 * the way. Files are opened with `O_NOFOLLOW` (where the platform has it) and checked with
 * `fstat` on the open descriptor, so what is hashed is the regular file that was checked.
 */

export const MAX_DEPTH = 16;
/** Hashed artifacts are streamed, never parsed: 1 GiB each. */
export const MAX_ARTIFACT_BYTES = 1024 * 1024 * 1024;
/** Parsed JSON (the manifest): 1 MiB. */
export const MAX_PARSED_BYTES = 1024 * 1024;

const NOFOLLOW = constants.O_NOFOLLOW ?? 0;

export interface ConfinedPath {
  /** POSIX, workspace-relative; the form written into the evidence. */
  rel: string;
  /** Absolute, under the workspace's real path. */
  abs: string;
  parts: string[];
}

/** The workspace's real path; every confined path is built under it. */
export async function workspaceRoot(workspace: string): Promise<string> {
  try {
    const root = await realpath(workspace);
    const st = await lstat(root);
    if (!st.isDirectory()) throw new Error('not a directory');
    return root;
  } catch {
    throw new ShipEvidenceError('invalid_env', 'GITHUB_WORKSPACE is not an existing directory.');
  }
}

/** Validate a user-supplied relative path and place it under `root`. Never touches the disk. */
export function confine(root: string, input: string, what: string): ConfinedPath {
  const value = input.trim();
  if (value === '' || value.length > MAX_PATH_LENGTH) {
    throw new ShipEvidenceError(
      'unsafe_path',
      `${what} must be a path of 1 to ${MAX_PATH_LENGTH} characters.`,
    );
  }
  if (value.startsWith('/') || /^[A-Za-z]:/.test(value) || value.includes('\\')) {
    throw new ShipEvidenceError(
      'unsafe_path',
      `${what} must be relative to the workspace, with forward slashes: ${quote(value)}.`,
    );
  }
  // A leading "./" is a harmless spelling; anything else with "." or ".." segments is refused.
  const cleaned = value.replace(/^(?:\.\/)+/, '');
  if (!isSafeRelativePath(cleaned)) {
    throw new ShipEvidenceError(
      'unsafe_path',
      `${what} may not contain ".", ".." or empty segments, control characters or a trailing slash: ${quote(value)}.`,
    );
  }
  const parts = cleaned.split('/');
  if (parts.length > MAX_DEPTH) {
    throw new ShipEvidenceError('unsafe_path', `${what} is deeper than ${MAX_DEPTH} directories.`);
  }
  return { rel: parts.join('/'), abs: join(root, ...parts), parts };
}

async function lstatOrNull(path: string): Promise<Stats | null> {
  try {
    return await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/**
 * Walk the directories leading to `target` and refuse a symbolic link or a non-directory among
 * them. With `create`, missing directories are made one at a time (never recursively through a
 * link). Returns the leaf's lstat, or null when it does not exist.
 */
async function walk(
  root: string,
  target: ConfinedPath,
  what: string,
  create: boolean,
): Promise<Stats | null> {
  let current = root;
  for (let i = 0; i < target.parts.length; i += 1) {
    current = join(current, target.parts[i] as string);
    const isLeaf = i === target.parts.length - 1;
    const st = await lstatOrNull(current);
    if (st?.isSymbolicLink()) {
      throw new ShipEvidenceError(
        'symlink_refused',
        `${what} ${quote(target.rel)} goes through a symbolic link (${quote(target.parts.slice(0, i + 1).join('/'))}); links are never followed.`,
      );
    }
    if (isLeaf) return st;
    if (st === null) {
      if (!create) {
        throw new ShipEvidenceError(
          'path_not_found',
          `${what} ${quote(target.rel)} does not exist.`,
        );
      }
      await mkdir(current);
      continue;
    }
    if (!st.isDirectory()) {
      throw new ShipEvidenceError(
        'unsafe_path',
        `${what} ${quote(target.rel)} runs through a file.`,
      );
    }
  }
  return null;
}

/** Open a regular file inside the workspace for reading, refusing links; checks `maxBytes`. */
async function openRegular(root: string, target: ConfinedPath, what: string, maxBytes: number) {
  const st = await walk(root, target, what, false);
  if (st === null) {
    throw new ShipEvidenceError('path_not_found', `${what} ${quote(target.rel)} does not exist.`);
  }
  if (!st.isFile()) {
    throw new ShipEvidenceError(
      'not_a_regular_file',
      `${what} ${quote(target.rel)} is not a regular file.`,
    );
  }
  let handle;
  try {
    handle = await open(target.abs, constants.O_RDONLY | NOFOLLOW);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ELOOP') {
      throw new ShipEvidenceError(
        'symlink_refused',
        `${what} ${quote(target.rel)} is a symbolic link.`,
      );
    }
    throw error;
  }
  const fst = await handle.stat();
  if (!fst.isFile() || fst.ino !== st.ino || fst.dev !== st.dev) {
    await handle.close();
    throw new ShipEvidenceError(
      'not_a_regular_file',
      `${what} ${quote(target.rel)} changed while it was read.`,
    );
  }
  if (fst.size > maxBytes) {
    await handle.close();
    throw new ShipEvidenceError(
      'file_too_large',
      `${what} ${quote(target.rel)} is larger than ${maxBytes} bytes.`,
    );
  }
  return { handle, size: fst.size };
}

export interface FileDigest {
  sha256: string;
  bytes: number;
}

/** sha256 of a regular file inside the workspace, streamed. */
export async function hashFile(
  root: string,
  target: ConfinedPath,
  what: string,
  maxBytes = MAX_ARTIFACT_BYTES,
): Promise<FileDigest> {
  const { handle } = await openRegular(root, target, what, maxBytes);
  try {
    const hash = createHash('sha256');
    let bytes = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      bytes += (chunk as Buffer).length;
      if (bytes > maxBytes) {
        throw new ShipEvidenceError(
          'file_too_large',
          `${what} ${quote(target.rel)} grew past ${maxBytes} bytes.`,
        );
      }
      hash.update(chunk as Buffer);
    }
    return { sha256: hash.digest('hex'), bytes };
  } finally {
    await handle.close();
  }
}

/** Read a small regular file inside the workspace (for parsing). */
export async function readSmallFile(
  root: string,
  target: ConfinedPath,
  what: string,
  maxBytes = MAX_PARSED_BYTES,
): Promise<Buffer> {
  const { handle } = await openRegular(root, target, what, maxBytes);
  try {
    const content = await handle.readFile();
    if (content.length > maxBytes) {
      throw new ShipEvidenceError(
        'file_too_large',
        `${what} ${quote(target.rel)} is larger than ${maxBytes} bytes.`,
      );
    }
    return content;
  } finally {
    await handle.close();
  }
}

/** Whether a confined path exists as anything (file, directory or link), without following links. */
export async function exists(root: string, target: ConfinedPath): Promise<boolean> {
  let current = root;
  for (const part of target.parts) {
    current = join(current, part);
    const st = await lstatOrNull(current);
    if (st === null) return false;
    if (st.isSymbolicLink()) return true;
  }
  return true;
}

/**
 * Write `content` to a file inside the workspace. Parent directories are created one at a time;
 * an existing link anywhere on the way, or at the file itself, is refused.
 */
export async function writeFileInside(
  root: string,
  target: ConfinedPath,
  what: string,
  content: Buffer,
): Promise<void> {
  const st = await walk(root, target, what, true);
  if (st !== null && !st.isFile()) {
    throw new ShipEvidenceError(
      'not_a_regular_file',
      `${what} ${quote(target.rel)} exists and is not a regular file.`,
    );
  }
  let handle;
  try {
    handle = await open(
      target.abs,
      constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | NOFOLLOW,
      0o644,
    );
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ELOOP') {
      throw new ShipEvidenceError(
        'symlink_refused',
        `${what} ${quote(target.rel)} is a symbolic link.`,
      );
    }
    throw new ShipEvidenceError(
      'output_write_failed',
      `could not write ${what} ${quote(target.rel)} (${code ?? 'error'}).`,
    );
  }
  try {
    await handle.writeFile(content);
  } finally {
    await handle.close();
  }
}
