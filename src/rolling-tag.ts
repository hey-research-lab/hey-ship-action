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

/*
 * Automated tags HEY also never counts as a release (its rule as of 2026-10-09), which this action
 * warns about rather than refuses, so the hey.ship/v1 schema keeps accepting every file it accepted:
 *
 *  - a data word straight before a date: `data-2026-10-01`, `backup-2026.10.01`;
 *  - a date-and-hash build stamp: `backend-202610010354-6802318`;
 *  - a CI build stamp: a word stem, a run number of two digits or more and an attempt
 *    (`server-image-1234-1`, `docker_412_2`), or `build`/`ci` straight before a number
 *    (`build-123`, `ci-456`, `server-build-77`). Not when the stem's last word names a version
 *    (`release-12-1`, `rc-10-2`) or the two numbers are a year and a month (`release-2024-10`).
 *
 * A calendar version (`v2026.10.01`) or `app-1-4` is not one.
 */
const DATE = '(19|20)[0-9]{2}[-_.]?(0[1-9]|1[0-2])[-_.]?(0[1-9]|[12][0-9]|3[01])';
const DATA_WORDS = [
  'data',
  'dataset',
  'datasets',
  'snapshot',
  'snapshots',
  'backup',
  'backups',
  'dump',
  'dumps',
  'export',
  'exports',
  'db',
  'stats',
  'report',
  'reports',
  'docs',
  'daily',
  'auto',
  'automated',
] as const;
const DATA_DATE = new RegExp(`(^|[-_./])(${DATA_WORDS.join('|')})[-_.]?${DATE}`);
const BUILD_STAMP =
  /(19|20)[0-9]{2}(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])([0-2][0-9][0-5][0-9]([0-5][0-9])?)?[-_.][0-9a-f]{7,40}$/;
const VERSION_WORDS = [
  'v',
  'ver',
  'version',
  'release',
  'releases',
  'rel',
  'rc',
  'alpha',
  'beta',
  'preview',
  'pre',
  'patch',
  'hotfix',
  'stable',
  'lts',
  'mainnet',
  'testnet',
  'sprint',
  'milestone',
  'phase',
  'update',
] as const;
const CI_RUN = /^[a-z]+([-_][a-z]+)*[-_][0-9]{2,12}[-_][0-9]{1,4}$/;
const CI_RUN_VERSION = new RegExp(`(^|[-_])(${VERSION_WORDS.join('|')})[-_][0-9]+[-_][0-9]+$`);
const CI_RUN_CALENDAR = /[-_](19|20)[0-9]{2}[-_](0?[1-9]|1[0-2])$/;
const CI_BUILD = /^([a-z]+[-_])*(build|ci)[-_.]?[0-9]+([-_][0-9]+)?$/;

/** Whether a tag is a date-stamped or CI build-stamp tag that HEY never counts as a release. */
export function isAutomatedTag(tag: string | null | undefined): boolean {
  const value = tag?.trim().toLowerCase();
  if (!value) return false;
  return (
    DATA_DATE.test(value) ||
    BUILD_STAMP.test(value) ||
    (CI_RUN.test(value) && !CI_RUN_VERSION.test(value) && !CI_RUN_CALENDAR.test(value)) ||
    CI_BUILD.test(value)
  );
}
