/** Every failure the action reports carries one of these stable codes. */
export const ERROR_CODES = [
  'missing_env',
  'invalid_env',
  'untrusted_event',
  'invalid_input',
  'invalid_address',
  'invalid_checksum',
  'not_a_contract_identity',
  'duplicate_contract',
  'too_many_contracts',
  'invalid_tx_hash',
  'invalid_release',
  'rolling_tag_release',
  'nothing_to_declare',
  'unsafe_path',
  'symlink_refused',
  'path_not_found',
  'not_a_regular_file',
  'file_too_large',
  'too_many_artifacts',
  'duplicate_artifact',
  'manifest_not_found',
  'invalid_manifest',
  'unsupported_chain',
  'attest_permission_missing',
  'invalid_evidence',
  'output_write_failed',
] as const;

export type ShipErrorCode = (typeof ERROR_CODES)[number];

export class ShipEvidenceError extends Error {
  override readonly name = 'ShipEvidenceError';
  constructor(
    readonly code: ShipErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** Quote untrusted text for an error message: JSON-escaped (one line, no control characters) and capped. */
export function quote(value: string, max = 80): string {
  const shown = value.length > max ? `${value.slice(0, max)}…` : value;
  return JSON.stringify(shown);
}
