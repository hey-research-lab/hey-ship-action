import { describe, expect, it } from 'vitest';

import { ShipEvidenceError } from '../src/errors.js';
import { parseServerUrl, readGitHubContext, workflowRunUrl } from '../src/github-env.js';
import { COMMIT, githubEnv } from './helpers.js';

const env = (extra: Record<string, string> = {}) => githubEnv('/github/workspace', extra);

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return error instanceof ShipEvidenceError ? error.code : `unexpected: ${String(error)}`;
  }
  return undefined;
}

describe('readGitHubContext', () => {
  it('reads a push to a tag', () => {
    const ctx = readGitHubContext(env());
    expect(ctx).toEqual({
      repository: 'example-org/example-protocol',
      serverUrl: 'https://github.com',
      commit: COMMIT,
      ref: 'refs/tags/v1.2.0',
      refName: 'v1.2.0',
      refType: 'tag',
      runId: '1234567890',
      runAttempt: 1,
      event: 'push',
      workflowRef: 'example-org/example-protocol/.github/workflows/deploy.yml@refs/tags/v1.2.0',
      workflowSha: COMMIT,
      workspace: '/github/workspace',
    });
    expect(workflowRunUrl(ctx)).toBe(
      'https://github.com/example-org/example-protocol/actions/runs/1234567890/attempts/1',
    );
  });

  it('lowercases the commit and accepts SHA-256 object names', () => {
    expect(readGitHubContext(env({ GITHUB_SHA: COMMIT.toUpperCase() })).commit).toBe(COMMIT);
    const sha256 = 'a'.repeat(64);
    expect(readGitHubContext(env({ GITHUB_SHA: sha256 })).commit).toBe(sha256);
  });

  it('leaves optional facts out when the runner did not set them', () => {
    const ctx = readGitHubContext(
      env({
        GITHUB_REF: '',
        GITHUB_REF_NAME: ' ',
        GITHUB_REF_TYPE: '',
        GITHUB_WORKFLOW_REF: '',
        GITHUB_WORKFLOW_SHA: '',
      }),
    );
    expect(ctx.ref).toBeUndefined();
    expect(ctx.refName).toBeUndefined();
    expect(ctx.refType).toBeUndefined();
    expect(ctx.workflowRef).toBeUndefined();
    expect(ctx.workflowSha).toBeUndefined();
    expect('ref' in ctx).toBe(false);
  });

  it.each([
    'GITHUB_REPOSITORY',
    'GITHUB_SERVER_URL',
    'GITHUB_SHA',
    'GITHUB_RUN_ID',
    'GITHUB_RUN_ATTEMPT',
    'GITHUB_EVENT_NAME',
    'GITHUB_WORKSPACE',
  ])('requires %s', (name) => {
    expect(codeOf(() => readGitHubContext(env({ [name]: '' })))).toBe('missing_env');
  });

  it.each([
    ['GITHUB_REPOSITORY', 'no-slash'],
    ['GITHUB_REPOSITORY', 'a/b/c'],
    ['GITHUB_REPOSITORY', 'owner/..'],
    ['GITHUB_REPOSITORY', 'owner/repo;rm -rf'],
    ['GITHUB_SHA', 'abc123'],
    ['GITHUB_SHA', 'g'.repeat(40)],
    ['GITHUB_RUN_ID', '12a'],
    ['GITHUB_RUN_ID', '-1'],
    ['GITHUB_RUN_ATTEMPT', '0'],
    ['GITHUB_EVENT_NAME', 'Push'],
    ['GITHUB_EVENT_NAME', 'push\n::warning::x'],
    ['GITHUB_REF', 'heads/main'],
    ['GITHUB_REF', 'refs/heads/a b'],
    ['GITHUB_REF', 'refs/heads/x\n::error::y'],
    ['GITHUB_REF_TYPE', 'commit'],
    ['GITHUB_WORKFLOW_REF', 'not a workflow ref'],
    ['GITHUB_WORKFLOW_SHA', 'xyz'],
    ['GITHUB_WORKSPACE', 'relative/path'],
    ['GITHUB_SERVER_URL', 'http://github.com'],
    ['GITHUB_SERVER_URL', 'https://user:pass@github.com'],
    ['GITHUB_SERVER_URL', 'https://github.com/evil'],
    ['GITHUB_SERVER_URL', 'https://github.com?x=1'],
    ['GITHUB_SERVER_URL', 'not a url'],
  ])('refuses %s=%j', (name, value) => {
    expect(codeOf(() => readGitHubContext(env({ [name]: value })))).toBe('invalid_env');
  });

  it('refuses pull_request_target', () => {
    expect(codeOf(() => readGitHubContext(env({ GITHUB_EVENT_NAME: 'pull_request_target' })))).toBe(
      'untrusted_event',
    );
  });

  it('records other events as they are', () => {
    for (const event of ['release', 'workflow_dispatch', 'pull_request', 'schedule']) {
      expect(readGitHubContext(env({ GITHUB_EVENT_NAME: event })).event).toBe(event);
    }
  });

  it('accepts a GitHub Enterprise Server origin', () => {
    expect(parseServerUrl('https://git.example.com/')).toBe('https://git.example.com');
    expect(parseServerUrl('https://git.example.com:8443')).toBe('https://git.example.com:8443');
  });

  it('refuses an overlong value', () => {
    expect(
      codeOf(() => readGitHubContext(env({ GITHUB_REF: `refs/heads/${'a'.repeat(5000)}` }))),
    ).toBe('invalid_env');
  });
});
