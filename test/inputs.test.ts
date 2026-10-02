import { describe, expect, it } from 'vitest';

import { getInput } from '../src/actions-io.js';
import { ShipEvidenceError } from '../src/errors.js';
import { checksumState, toChecksumAddress } from '../src/evm.js';
import {
  parseArtifacts,
  parseBoolean,
  parseContracts,
  parseDeploymentTx,
  parseRelease,
  readInputs,
  splitList,
} from '../src/inputs.js';
import { ADDRESS_1, ADDRESS_2, TX_HASH } from './helpers.js';

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return error instanceof ShipEvidenceError ? error.code : `unexpected: ${String(error)}`;
  }
  return undefined;
}

// EIP-55's published test vectors.
const EIP55 = [
  '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
  '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359',
  '0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB',
  '0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb',
];

describe('EIP-55', () => {
  it.each(EIP55)('checksums %s', (address) => {
    expect(toChecksumAddress(address.toLowerCase())).toBe(address);
    expect(checksumState(address)).toBe('valid');
  });
  it('accepts all-lowercase and all-uppercase bodies without a checksum', () => {
    expect(checksumState(EIP55[0]!.toLowerCase())).toBe('no_checksum');
    expect(checksumState(`0x${EIP55[0]!.slice(2).toUpperCase()}`)).toBe('no_checksum');
  });
  it('flags a broken mixed-case checksum', () => {
    expect(checksumState('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD')).toBe('invalid');
  });
});

describe('contracts', () => {
  it('splits on newlines, commas and spaces, drops comments and lowercases', () => {
    const value = `${EIP55[0]}, ${ADDRESS_1}\n# a comment line\n${ADDRESS_2}  # token\n`;
    expect(parseContracts(value)).toEqual([EIP55[0]!.toLowerCase(), ADDRESS_1, ADDRESS_2]);
    expect(splitList(' \n \n')).toEqual([]);
  });
  it('is absent, never an empty list, when nothing is given', () => {
    expect(parseContracts('')).toBeUndefined();
    expect(parseContracts('\n# nothing\n')).toBeUndefined();
  });
  it.each([
    ['0x123', 'invalid_address'],
    ['0X0000000000000000000000000000000000000001', 'invalid_address'],
    ['0000000000000000000000000000000000000001', 'invalid_address'],
    ['0x000000000000000000000000000000000000000g', 'invalid_address'],
    ['vitalik.eth', 'invalid_address'],
    ['0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD', 'invalid_checksum'],
    ['0x0000000000000000000000000000000000000000', 'not_a_contract_identity'],
    ['0x000000000000000000000000000000000000dEaD', 'not_a_contract_identity'],
    ['0x000000000000000000000000000000000000DEAD', 'not_a_contract_identity'],
    [`${ADDRESS_1}\n${ADDRESS_1.toUpperCase().replace('0X', '0x')}`, 'duplicate_contract'],
  ])('refuses %j (%s)', (value, code) => {
    expect(codeOf(() => parseContracts(value))).toBe(code);
  });
  it('refuses a glob with a message that says so, and keeps brackets in a path', () => {
    expect(codeOf(() => parseArtifacts('dist/*.tgz'))).toBe('invalid_input');
    expect(() => parseArtifacts('dist/*.tgz')).toThrow(/globs are not expanded/);
    expect(parseArtifacts('app/[slug]/out.json')).toEqual(['app/[slug]/out.json']);
  });
  it('caps the list', () => {
    const many = Array.from(
      { length: 101 },
      (_, i) => `0x${(i + 1).toString(16).padStart(40, '0')}`,
    );
    expect(codeOf(() => parseContracts(many.join('\n')))).toBe('too_many_contracts');
    expect(parseContracts(many.slice(0, 100).join('\n'))).toHaveLength(100);
  });
});

describe('deployment-tx', () => {
  it('lowercases a hash', () => {
    expect(parseDeploymentTx(TX_HASH.replace('aa', 'AA'))).toBe(TX_HASH);
    expect(parseDeploymentTx('')).toBeUndefined();
  });
  it.each([
    '0x1234',
    `0X${TX_HASH.slice(2)}`,
    `${TX_HASH}00`,
    TX_HASH.replace('a', 'z'),
    `${TX_HASH} ${TX_HASH}`,
  ])('refuses %j', (value) =>
    expect(codeOf(() => parseDeploymentTx(value))).toBe('invalid_tx_hash'),
  );
});

describe('release', () => {
  it.each(['v1.2.0', 'v1.2.0-rc.1', '1.0.0+build.5', 'release/2026.10', 'v1.2.0-dev.3'])(
    'accepts %j',
    (value) => expect(parseRelease(value)).toBe(value),
  );
  it.each(['latest', 'nightly-1', 'v1-debug', 'edge', 'canary', 'dev', 'snapshot', 'Latest'])(
    'refuses the rolling tag %j',
    (value) => expect(codeOf(() => parseRelease(value))).toBe('rolling_tag_release'),
  );
  it.each([
    'v1..2',
    'v1 2',
    '-v1',
    '.v1',
    'v1/',
    'v1.',
    'v1.lock',
    'a//b',
    'v1;rm -rf /',
    '$(whoami)',
    '`id`',
    'v1\n::error::x',
    'a'.repeat(129),
  ])('refuses %j', (value) => expect(codeOf(() => parseRelease(value))).toBe('invalid_release'));
});

describe('artifacts', () => {
  it('keeps one path per line, so a path may contain a comma or a space', () => {
    expect(parseArtifacts('out/a,b.json\nout/with space.json\n# comment\n\n')).toEqual([
      'out/a,b.json',
      'out/with space.json',
    ]);
    expect(parseArtifacts('')).toBeUndefined();
  });
  it('refuses a glob with a message that says so, and keeps brackets in a path', () => {
    expect(codeOf(() => parseArtifacts('dist/*.tgz'))).toBe('invalid_input');
    expect(() => parseArtifacts('dist/*.tgz')).toThrow(/globs are not expanded/);
    expect(parseArtifacts('app/[slug]/out.json')).toEqual(['app/[slug]/out.json']);
  });
  it('caps the list', () => {
    const many = Array.from({ length: 257 }, (_, i) => `f${i}`).join('\n');
    expect(codeOf(() => parseArtifacts(many))).toBe('too_many_artifacts');
  });
});

describe('inputs from the environment', () => {
  it('reads INPUT_<NAME> with hyphens kept, as the runner sets them', () => {
    expect(getInput({ 'INPUT_DEPLOYMENT-TX': `  ${TX_HASH}\n` }, 'deployment-tx')).toBe(TX_HASH);
    expect(getInput({}, 'release')).toBe('');
  });
  it('applies defaults', () => {
    expect(readInputs({ INPUT_RELEASE: 'v1.0.0' })).toEqual({
      release: 'v1.0.0',
      manifestPath: 'auto',
      outputPath: 'hey-ship.json',
      attest: false,
    });
  });
  it('reads every input', () => {
    expect(
      readInputs({
        INPUT_CONTRACTS: ADDRESS_1,
        'INPUT_DEPLOYMENT-TX': TX_HASH,
        INPUT_RELEASE: 'v1.0.0',
        INPUT_ARTIFACTS: 'out/a.json',
        'INPUT_MANIFEST-PATH': 'site/.well-known/hey-project.json',
        'INPUT_OUTPUT-PATH': 'evidence/ship.json',
        INPUT_ATTEST: 'true',
      }),
    ).toEqual({
      contracts: [ADDRESS_1],
      deploymentTx: TX_HASH,
      release: 'v1.0.0',
      artifacts: ['out/a.json'],
      manifestPath: { path: 'site/.well-known/hey-project.json' },
      outputPath: 'evidence/ship.json',
      attest: true,
    });
    expect(readInputs({ INPUT_RELEASE: 'v1', 'INPUT_MANIFEST-PATH': 'none' }).manifestPath).toBe(
      'none',
    );
  });
  it('requires something to declare', () => {
    expect(codeOf(() => readInputs({ INPUT_ARTIFACTS: 'a.json' }))).toBe('nothing_to_declare');
  });
  it('refuses a non-boolean attest and an oversized input', () => {
    expect(codeOf(() => parseBoolean('attest', 'yes', false))).toBe('invalid_input');
    expect(parseBoolean('attest', 'False', true)).toBe(false);
    expect(
      codeOf(() => readInputs({ INPUT_RELEASE: 'v1', INPUT_CONTRACTS: 'x'.repeat(70_000) })),
    ).toBe('invalid_input');
  });
});
