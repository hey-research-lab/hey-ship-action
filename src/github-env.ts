import { isAbsolute } from 'node:path';

import { ShipEvidenceError, quote } from './errors.js';
import {
  COMMIT_RE,
  EVENT_RE,
  REF_NAME_RE,
  REF_RE,
  REPOSITORY_RE,
  RUN_ID_RE,
  WORKFLOW_REF_RE,
} from './schema.js';

export type Env = Readonly<Record<string, string | undefined>>;

/** What the GitHub Actions runner says about this run, validated. */
export interface GitHubContext {
  repository: string;
  serverUrl: string;
  commit: string;
  ref?: string;
  refName?: string;
  refType?: 'branch' | 'tag';
  runId: string;
  runAttempt: number;
  event: string;
  workflowRef?: string;
  workflowSha?: string;
  workspace: string;
}

/**
 * Events whose run executes with the base repository's privileges on code an outside contributor
 * controls. Evidence written there would name the base repository for code it did not review.
 */
export const REFUSED_EVENTS: readonly string[] = ['pull_request_target'];

const MAX_ENV_LENGTH = 4096;

function read(env: Env, name: string): string | undefined {
  const raw = env[name];
  if (raw === undefined) return undefined;
  const value = raw.trim();
  if (value === '') return undefined;
  if (value.length > MAX_ENV_LENGTH) {
    throw new ShipEvidenceError(
      'invalid_env',
      `${name} is longer than ${MAX_ENV_LENGTH} characters.`,
    );
  }
  return value;
}

function required(env: Env, name: string): string {
  const value = read(env, name);
  if (value === undefined) {
    throw new ShipEvidenceError(
      'missing_env',
      `${name} is not set. hey-ship-action runs inside a GitHub Actions job, which sets it.`,
    );
  }
  return value;
}

function matching(name: string, value: string, re: RegExp): string {
  if (!re.test(value)) {
    throw new ShipEvidenceError('invalid_env', `${name} has an unexpected shape: ${quote(value)}.`);
  }
  return value;
}

/** `https://github.com` or a GitHub Enterprise Server origin; https only, no credentials, no path. */
export function parseServerUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ShipEvidenceError('invalid_env', `GITHUB_SERVER_URL is not a URL: ${quote(value)}.`);
  }
  if (url.protocol !== 'https:') {
    throw new ShipEvidenceError('invalid_env', 'GITHUB_SERVER_URL must be an https: URL.');
  }
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname && url.pathname !== '/')
  ) {
    throw new ShipEvidenceError(
      'invalid_env',
      'GITHUB_SERVER_URL must be a bare origin (no credentials, path, query or fragment).',
    );
  }
  return url.origin;
}

export function readGitHubContext(env: Env): GitHubContext {
  const repository = matching(
    'GITHUB_REPOSITORY',
    required(env, 'GITHUB_REPOSITORY'),
    REPOSITORY_RE,
  );
  const [, name] = repository.split('/');
  if (name === '.' || name === '..') {
    throw new ShipEvidenceError('invalid_env', 'GITHUB_REPOSITORY has an unexpected shape.');
  }
  const serverUrl = parseServerUrl(required(env, 'GITHUB_SERVER_URL'));
  const commit = matching('GITHUB_SHA', required(env, 'GITHUB_SHA').toLowerCase(), COMMIT_RE);
  const runId = matching('GITHUB_RUN_ID', required(env, 'GITHUB_RUN_ID'), RUN_ID_RE);
  const attemptText = matching(
    'GITHUB_RUN_ATTEMPT',
    required(env, 'GITHUB_RUN_ATTEMPT'),
    /^[1-9][0-9]{0,5}$/,
  );
  const event = matching('GITHUB_EVENT_NAME', required(env, 'GITHUB_EVENT_NAME'), EVENT_RE);
  if (REFUSED_EVENTS.includes(event)) {
    throw new ShipEvidenceError(
      'untrusted_event',
      `hey-ship-action does not run on ${event}: that event runs with the base repository's ` +
        'privileges on code from outside it. Write ship evidence on push, release, workflow_dispatch ' +
        'or another trusted event.',
    );
  }
  const workspace = required(env, 'GITHUB_WORKSPACE');
  if (!isAbsolute(workspace) || workspace.includes('\u0000')) {
    throw new ShipEvidenceError('invalid_env', 'GITHUB_WORKSPACE must be an absolute path.');
  }

  const context: GitHubContext = {
    repository,
    serverUrl,
    commit,
    runId,
    runAttempt: Number(attemptText),
    event,
    workspace,
  };

  const ref = read(env, 'GITHUB_REF');
  if (ref !== undefined) context.ref = matching('GITHUB_REF', ref, REF_RE);
  const refName = read(env, 'GITHUB_REF_NAME');
  if (refName !== undefined) context.refName = matching('GITHUB_REF_NAME', refName, REF_NAME_RE);
  const refType = read(env, 'GITHUB_REF_TYPE');
  if (refType !== undefined) {
    if (refType !== 'branch' && refType !== 'tag') {
      throw new ShipEvidenceError(
        'invalid_env',
        `GITHUB_REF_TYPE must be branch or tag, not ${quote(refType)}.`,
      );
    }
    context.refType = refType;
  }
  const workflowRef = read(env, 'GITHUB_WORKFLOW_REF');
  if (workflowRef !== undefined) {
    if (workflowRef.length > 600) {
      throw new ShipEvidenceError('invalid_env', 'GITHUB_WORKFLOW_REF is too long.');
    }
    context.workflowRef = matching('GITHUB_WORKFLOW_REF', workflowRef, WORKFLOW_REF_RE);
  }
  const workflowSha = read(env, 'GITHUB_WORKFLOW_SHA');
  if (workflowSha !== undefined) {
    context.workflowSha = matching('GITHUB_WORKFLOW_SHA', workflowSha.toLowerCase(), COMMIT_RE);
  }
  return context;
}

export const repositoryUrl = (ctx: Pick<GitHubContext, 'serverUrl' | 'repository'>): string =>
  `${ctx.serverUrl}/${ctx.repository}`;

export const workflowRunUrl = (
  ctx: Pick<GitHubContext, 'serverUrl' | 'repository' | 'runId' | 'runAttempt'>,
): string => `${repositoryUrl(ctx)}/actions/runs/${ctx.runId}/attempts/${ctx.runAttempt}`;
