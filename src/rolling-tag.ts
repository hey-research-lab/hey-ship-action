/**
 * A rolling tag is never a release.
 *
 * `latest`, `latest-debug`, `nightly-<sha>`, `edge`, `canary`, `dev` and `snapshot` name a moving
 * build that automation cuts again and again, not a release a team stands behind. HEY does not
 * count a GitHub release cut from such a tag as a release ship, so this action refuses to write
 * one into `release`. The patterns, case-folded on the trimmed tag: `latest*`, `nightly*`,
 * `*-debug`, and exactly `edge`, `canary`, `dev` or `snapshot`. A version such as `v1.2.0-dev.3`
 * or `docs-latest` is not one.
 *
 * HEY's own quality gate decides what it counts; passing this check is no promise that it will.
 */
export const ROLLING_TAG_PATTERNS = [
  'latest*',
  'nightly*',
  '*-debug',
  'edge',
  'canary',
  'dev',
  'snapshot',
] as const;

const PREFIXES = ['latest', 'nightly'] as const;
const SUFFIXES = ['-debug'] as const;
const EXACT: readonly string[] = ['edge', 'canary', 'dev', 'snapshot'];

export function isRollingTag(tag: string | null | undefined): boolean {
  const value = tag?.trim().toLowerCase();
  if (!value) return false;
  return (
    PREFIXES.some((prefix) => value.startsWith(prefix)) ||
    SUFFIXES.some((suffix) => value.endsWith(suffix)) ||
    EXACT.includes(value)
  );
}
