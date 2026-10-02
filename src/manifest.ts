import { createHash } from 'node:crypto';

import { CHAIN_ID, UnsupportedChainError } from './chain.js';
import { ShipEvidenceError, quote } from './errors.js';
import { type ConfinedPath, confine, exists, readSmallFile } from './paths.js';
import type { ManifestReference } from './schema.js';

/**
 * A reference to the project's `hey-project.json` declaration, when the repository holds one.
 *
 * The manifest format is defined by hey-project-manifest. This action does not import it; it
 * checks only the fields the reference records (`version` and `chainId`) and that the file is a
 * JSON object, and records the file's path and sha256 so a reader can fetch and check the exact
 * bytes. A manifest is a first-party declaration: referencing it verifies nothing.
 */

/** Where `auto` looks, in order: the repository root, then the common static-site folders. */
export const MANIFEST_CANDIDATES = [
  '.well-known/hey-project.json',
  'public/.well-known/hey-project.json',
  'static/.well-known/hey-project.json',
  'site/.well-known/hey-project.json',
  'web/.well-known/hey-project.json',
  'docs/.well-known/hey-project.json',
  'website/static/.well-known/hey-project.json',
  'app/public/.well-known/hey-project.json',
  'frontend/public/.well-known/hey-project.json',
  'apps/web/public/.well-known/hey-project.json',
] as const;

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** JSON.parse that refuses prototype-polluting keys anywhere in the document. */
export function parseJsonStrict(text: string): unknown {
  return JSON.parse(text, (key, value: unknown) => {
    if (FORBIDDEN_KEYS.has(key)) throw new SyntaxError(`forbidden key ${JSON.stringify(key)}`);
    return value;
  });
}

/** The minimal manifest check: a JSON object with `version: 1` and `chainId: 4663`. */
export function checkManifest(
  content: Buffer,
  rel: string,
): { version: 1; chainId: typeof CHAIN_ID } {
  let doc: unknown;
  try {
    const text = content.toString('utf8');
    doc = parseJsonStrict(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch (error) {
    throw new ShipEvidenceError(
      'invalid_manifest',
      `${quote(rel)} is not valid JSON (${(error as Error).message.slice(0, 120)}).`,
    );
  }
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
    throw new ShipEvidenceError('invalid_manifest', `${quote(rel)} must hold a JSON object.`);
  }
  const record = doc as Record<string, unknown>;
  if (record.version !== 1) {
    throw new ShipEvidenceError(
      'invalid_manifest',
      `${quote(rel)} must declare "version": 1 (found ${quote(JSON.stringify(record.version) ?? 'nothing')}).`,
    );
  }
  if (!('chainId' in record)) {
    throw new ShipEvidenceError('invalid_manifest', `${quote(rel)} must declare "chainId": 4663.`);
  }
  if (record.chainId !== CHAIN_ID) {
    const error = new UnsupportedChainError(record.chainId);
    throw new ShipEvidenceError('unsupported_chain', `${quote(rel)}: ${error.message}`);
  }
  return { version: 1, chainId: CHAIN_ID };
}

async function reference(root: string, target: ConfinedPath): Promise<ManifestReference> {
  const content = await readSmallFile(root, target, 'manifest');
  const checked = checkManifest(content, target.rel);
  return {
    path: target.rel,
    sha256: createHash('sha256').update(content).digest('hex'),
    version: checked.version,
    chainId: checked.chainId,
  };
}

/**
 * `none` → no reference. `auto` → the first candidate that exists, or no reference when none does
 * (the evidence then simply has no `manifest` field: this action did not find one, which says
 * nothing about whether the project publishes one elsewhere). An explicit path must exist.
 */
export async function readManifestReference(
  root: string,
  setting: 'auto' | 'none' | { path: string },
): Promise<ManifestReference | undefined> {
  if (setting === 'none') return undefined;
  if (setting === 'auto') {
    for (const candidate of MANIFEST_CANDIDATES) {
      const target = confine(root, candidate, 'manifest');
      if (await exists(root, target)) return reference(root, target);
    }
    return undefined;
  }
  const target = confine(root, setting.path, 'manifest-path');
  if (!(await exists(root, target))) {
    throw new ShipEvidenceError(
      'manifest_not_found',
      `manifest-path ${quote(target.rel)} does not exist.`,
    );
  }
  return reference(root, target);
}
