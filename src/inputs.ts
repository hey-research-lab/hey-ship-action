import { getInput } from './actions-io.js';
import { ShipEvidenceError, quote } from './errors.js';
import {
  ADDRESS_RE,
  DEAD_ADDRESS,
  TX_HASH_RE,
  ZERO_ADDRESS,
  checksumState,
  normalizeAddress,
  normalizeTxHash,
} from './evm.js';
import type { Env } from './github-env.js';
import { isRollingTag } from './rolling-tag.js';
import { MAX_ARTIFACTS, MAX_CONTRACTS, isSafeRelease } from './schema.js';

/** The action's inputs, validated. Paths are still raw here; `paths.ts` confines them. */
export interface ActionInputs {
  contracts?: string[];
  deploymentTx?: string;
  release?: string;
  artifacts?: string[];
  /** `auto` (look in the usual places), `none` (skip) or a workspace-relative path. */
  manifestPath: 'auto' | 'none' | { path: string };
  outputPath: string;
  attest: boolean;
}

export const DEFAULT_OUTPUT_PATH = 'hey-ship.json';

/** Split a list input on newlines, commas or whitespace; blank entries and `#` comments drop out. */
export function splitList(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.replace(/(^|\s)#.*$/, ''))
    .flatMap((line) => line.split(/[\s,]+/))
    .map((item) => item.trim())
    .filter((item) => item !== '');
}

/** Paths are one per line (a path may contain a comma or a space); `#` starts a comment line. */
export function splitLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
}

/**
 * One contract address as an authored file must spell it: `0x` prefix (never `0X`), 40 hex
 * digits, and when the case is mixed, a valid EIP-55 checksum. Stored lowercase.
 */
export function parseContractAddress(value: string): string {
  if (!ADDRESS_RE.test(value)) {
    throw new ShipEvidenceError(
      'invalid_address',
      `not a contract address: ${quote(value)} (expected 0x followed by 40 hex digits).`,
    );
  }
  if (checksumState(value) === 'invalid') {
    throw new ShipEvidenceError(
      'invalid_checksum',
      `${value} is mixed-case but fails its EIP-55 checksum. Use the checksummed form or all lowercase.`,
    );
  }
  const address = normalizeAddress(value);
  if (address === ZERO_ADDRESS || address === DEAD_ADDRESS) {
    throw new ShipEvidenceError(
      'not_a_contract_identity',
      `${address} is never a contract identity (zero or burn address).`,
    );
  }
  return address;
}

export function parseContracts(value: string): string[] | undefined {
  const items = splitList(value);
  if (items.length === 0) return undefined;
  if (items.length > MAX_CONTRACTS) {
    throw new ShipEvidenceError(
      'too_many_contracts',
      `at most ${MAX_CONTRACTS} contracts per evidence file.`,
    );
  }
  const seen = new Set<string>();
  return items.map((item) => {
    const address = parseContractAddress(item);
    if (seen.has(address)) {
      throw new ShipEvidenceError('duplicate_contract', `${address} is listed more than once.`);
    }
    seen.add(address);
    return address;
  });
}

export function parseDeploymentTx(value: string): string | undefined {
  if (value === '') return undefined;
  if (!TX_HASH_RE.test(value)) {
    throw new ShipEvidenceError(
      'invalid_tx_hash',
      `deployment-tx is not a transaction hash: ${quote(value)} (expected 0x followed by 64 hex digits).`,
    );
  }
  return normalizeTxHash(value);
}

export function parseRelease(value: string): string | undefined {
  if (value === '') return undefined;
  if (!isSafeRelease(value)) {
    throw new ShipEvidenceError(
      'invalid_release',
      `release must be a tag-like name (letters, digits, . _ + - /; up to 128 characters): ${quote(value)}.`,
    );
  }
  if (isRollingTag(value)) {
    throw new ShipEvidenceError(
      'rolling_tag_release',
      `${quote(value)} is a rolling tag (latest*, nightly*, *-debug, edge, canary, dev, snapshot). ` +
        'A rolling tag names a moving build, never a release; leave release empty or pass a versioned tag.',
    );
  }
  return value;
}

export function parseArtifacts(value: string): string[] | undefined {
  const items = splitLines(value);
  if (items.length === 0) return undefined;
  if (items.length > MAX_ARTIFACTS) {
    throw new ShipEvidenceError(
      'too_many_artifacts',
      `at most ${MAX_ARTIFACTS} artifacts per evidence file.`,
    );
  }
  const glob = items.find((item) => /[*?]/.test(item));
  if (glob !== undefined) {
    throw new ShipEvidenceError(
      'invalid_input',
      `artifacts takes file paths, one per line; globs are not expanded: ${quote(glob)}. ` +
        'List each file, or expand the glob in an earlier step.',
    );
  }
  return items;
}

export function parseBoolean(name: string, value: string, fallback: boolean): boolean {
  if (value === '') return fallback;
  if (['true', 'True', 'TRUE'].includes(value)) return true;
  if (['false', 'False', 'FALSE'].includes(value)) return false;
  throw new ShipEvidenceError(
    'invalid_input',
    `${name} must be true or false, not ${quote(value)}.`,
  );
}

export function readInputs(env: Env): ActionInputs {
  const raw = (name: string): string => {
    try {
      return getInput(env, name);
    } catch (error) {
      throw new ShipEvidenceError('invalid_input', (error as Error).message);
    }
  };
  const manifestRaw = raw('manifest-path');
  const inputs: ActionInputs = {
    manifestPath:
      manifestRaw === '' || manifestRaw === 'auto'
        ? 'auto'
        : manifestRaw === 'none'
          ? 'none'
          : { path: manifestRaw },
    outputPath: raw('output-path') || DEFAULT_OUTPUT_PATH,
    attest: parseBoolean('attest', raw('attest'), false),
  };
  const contracts = parseContracts(raw('contracts'));
  if (contracts) inputs.contracts = contracts;
  const deploymentTx = parseDeploymentTx(raw('deployment-tx'));
  if (deploymentTx) inputs.deploymentTx = deploymentTx;
  const release = parseRelease(raw('release'));
  if (release) inputs.release = release;
  const artifacts = parseArtifacts(raw('artifacts'));
  if (artifacts) inputs.artifacts = artifacts;

  if (!inputs.contracts && !inputs.deploymentTx && !inputs.release) {
    throw new ShipEvidenceError(
      'nothing_to_declare',
      'set at least one of contracts, deployment-tx or release: ship evidence links this commit to something.',
    );
  }
  return inputs;
}
