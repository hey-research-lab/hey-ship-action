import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { isRollingTag } from '../src/rolling-tag.js';

const ROLLING = [
  'latest',
  'Latest',
  'LATEST',
  'latest-debug',
  'latest-v2',
  'nightly',
  'nightly-2026-10-01',
  'nightly_abc1234',
  'v1.2.0-debug',
  'build-DEBUG',
  'edge',
  'Edge',
  'canary',
  'dev',
  'DEV',
  'snapshot',
];
const RELEASES = [
  'v1.2.0',
  'v1.2.0-dev.3',
  'v2.0.0-rc.1',
  'docs-latest',
  'release/2026.10',
  'v1.0.0-debugger',
  'developer-preview',
  'edge-1.0',
  'canary-1',
  'snapshots-v1',
  'devnet-1',
  '2026.10.1',
];

describe('isRollingTag', () => {
  it.each(ROLLING)('treats %j as rolling', (tag) => expect(isRollingTag(tag)).toBe(true));
  it.each(RELEASES)('treats %j as a release', (tag) => expect(isRollingTag(tag)).toBe(false));
  it('trims and ignores empty values', () => {
    expect(isRollingTag('  latest  ')).toBe(true);
    expect(isRollingTag('')).toBe(false);
    expect(isRollingTag(null)).toBe(false);
    expect(isRollingTag(undefined)).toBe(false);
  });

  it('agrees with the case-insensitive pattern in the JSON Schema', () => {
    const schema = JSON.parse(
      readFileSync(new URL('../schema/hey-ship.v1.json', import.meta.url), 'utf8'),
    );
    const pattern = new RegExp(schema.properties.release.not.anyOf[0].pattern as string, 'u');
    for (const tag of [...ROLLING, ...RELEASES]) {
      expect(pattern.test(tag), tag).toBe(isRollingTag(tag));
    }
  });
});
