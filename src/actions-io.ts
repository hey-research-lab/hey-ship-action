import { randomUUID } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { EOL } from 'node:os';

import type { Env } from './github-env.js';

/**
 * The few runner interactions the action needs, written out instead of pulling in a toolkit: read
 * an input, write a step output, log. Nothing here runs a shell or touches the network.
 */

const MAX_INPUT_LENGTH = 64 * 1024;

/** The value the runner passes for input `name` (`INPUT_<NAME>`), trimmed. */
export function getInput(env: Env, name: string): string {
  const raw = env[`INPUT_${name.replace(/ /g, '_').toUpperCase()}`] ?? '';
  if (raw.length > MAX_INPUT_LENGTH) {
    throw new RangeError(`input ${name} is longer than ${MAX_INPUT_LENGTH} characters`);
  }
  return raw.trim();
}

/** Workflow-command data escaping: a message stays on one line and cannot start a new command. */
export const escapeData = (value: string): string =>
  value.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');

export const escapeProperty = (value: string): string =>
  escapeData(value).replace(/:/g, '%3A').replace(/,/g, '%2C');

export interface Logger {
  info(message: string): void;
  warning(message: string): void;
  error(message: string, title?: string): void;
}

export const consoleLogger: Logger = {
  info: (message) => process.stdout.write(`${escapeData(message)}${EOL}`),
  warning: (message) => process.stdout.write(`::warning::${escapeData(message)}${EOL}`),
  error: (message, title) =>
    process.stdout.write(
      `::error${title ? ` title=${escapeProperty(title)}` : ''}::${escapeData(message)}${EOL}`,
    ),
};

/**
 * Append `name=value` to the runner's `GITHUB_OUTPUT` file with a random heredoc delimiter, the
 * format the runner documents. Returns false when the file is not set (outside a runner).
 */
export function setOutput(env: Env, name: string, value: string): boolean {
  const file = env.GITHUB_OUTPUT;
  if (!file) return false;
  if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(name)) throw new Error(`invalid output name ${name}`);
  const delimiter = `ghadelimiter_${randomUUID()}`;
  if (value.includes(delimiter)) throw new Error('output value contains the delimiter');
  appendFileSync(file, `${name}<<${delimiter}${EOL}${value}${EOL}${delimiter}${EOL}`, {
    encoding: 'utf8',
  });
  return true;
}
