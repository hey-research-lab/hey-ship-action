// src/evm.ts — identical in every repo that handles addresses (ecosystem conventions §3),
// plus the EIP-55 checksum that authored files (ship evidence among them) must pass.
import { keccak_256 } from '@noble/hashes/sha3';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';

export const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/; // input: either case, "0x" prefix lowercase
export const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
export const DEAD_ADDRESS = '0x000000000000000000000000000000000000dead';

export const isAddress = (v: unknown): v is string => typeof v === 'string' && ADDRESS_RE.test(v);
/** Canonical form for keys, comparison, dedupe, URLs and machine output: lowercase. */
export const normalizeAddress = (v: string): string => {
  if (!isAddress(v))
    throw Object.assign(new Error(`not an EVM address: ${JSON.stringify(v).slice(0, 80)}`), {
      code: 'invalid_address',
    });
  return v.toLowerCase();
};
export const isTxHash = (v: unknown): v is string => typeof v === 'string' && TX_HASH_RE.test(v);
export const normalizeTxHash = (v: string): string => {
  if (!isTxHash(v))
    throw Object.assign(new Error('not a transaction hash'), { code: 'invalid_tx_hash' });
  return v.toLowerCase();
};

/** EIP-55 mixed-case checksum form of an address. */
export function toChecksumAddress(address: string): string {
  const lower = normalizeAddress(address).slice(2);
  const hash = bytesToHex(keccak_256(utf8ToBytes(lower)));
  let out = '0x';
  for (let i = 0; i < lower.length; i += 1) {
    const char = lower.charAt(i);
    out += Number.parseInt(hash.charAt(i), 16) >= 8 ? char.toUpperCase() : char;
  }
  return out;
}

/**
 * An all-lowercase or all-uppercase address carries no checksum and is accepted as it is; a
 * mixed-case address must match its EIP-55 form exactly.
 */
export function checksumState(address: string): 'no_checksum' | 'valid' | 'invalid' {
  const body = normalizeAddress(address).slice(2);
  const given = address.slice(2);
  if (given === body || given === body.toUpperCase()) return 'no_checksum';
  return toChecksumAddress(address) === address ? 'valid' : 'invalid';
}
