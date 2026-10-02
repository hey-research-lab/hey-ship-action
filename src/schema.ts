import { z } from 'zod';

import { CHAIN_ID } from './chain.js';
import { DEAD_ADDRESS, ZERO_ADDRESS } from './evm.js';
import { isRollingTag } from './rolling-tag.js';
import { GENERATOR_NAME } from './version.js';

/**
 * `hey.ship/v1` — the ship evidence document this action writes.
 *
 * The same shape is published as JSON Schema in `schema/hey-ship.v1.json`; the tests hold the two
 * equal over every fixture. Additive changes stay within v1; a change of meaning is a new major.
 */
export const SHIP_SCHEMA = 'hey.ship/v1' as const;
export const SHIP_SCHEMA_ID =
  'https://raw.githubusercontent.com/hey-research-lab/hey-ship-action/main/schema/hey-ship.v1.json' as const;

export const MAX_CONTRACTS = 100;
export const MAX_ARTIFACTS = 256;
export const MAX_PATH_LENGTH = 1024;

/** `owner/name` as GitHub spells it. */
export const REPOSITORY_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/;
/** A git commit id: SHA-1 (40) or SHA-256 (64) object names, lowercase. */
export const COMMIT_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
/** Characters git refuses in a ref name (plus whitespace and control characters). */
const REF_CHARS = String.raw`[^\s~^:?*\[\\\u0000-\u001f\u007f]`;
export const REF_RE = new RegExp(`^refs/${REF_CHARS}{1,500}$`);
export const REF_NAME_RE = new RegExp(`^${REF_CHARS}{1,255}$`);
export const WORKFLOW_REF_RE = new RegExp(
  `^[A-Za-z0-9][A-Za-z0-9-]{0,38}/[A-Za-z0-9._-]{1,100}/${REF_CHARS}{1,300}@refs/${REF_CHARS}{1,255}$`,
);
export const EVENT_RE = /^[a-z_]{1,64}$/;
export const RUN_ID_RE = /^[1-9][0-9]{0,19}$/;
/** A release name: a tag-like word. No whitespace, no `..`, no `//`, no trailing `/` or `.`. */
export const RELEASE_RE = /^[A-Za-z0-9][A-Za-z0-9._+/-]{0,127}$/;
export const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
export const SHA256_RE = /^[0-9a-f]{64}$/;
export const LOWER_ADDRESS_RE = /^0x[0-9a-f]{40}$/;
export const LOWER_TX_HASH_RE = /^0x[0-9a-f]{64}$/;
export const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
/** A workspace-relative POSIX path: no leading `/`, no backslash, no control characters. */
// eslint-disable-next-line no-control-regex -- refusing control characters is the point
export const RELATIVE_PATH_RE = /^[^/\\\u0000-\u001f\u007f][^\\\u0000-\u001f\u007f]{0,1023}$/;
/** Segments a relative path must never contain: `.`, `..`, an empty segment, a trailing `/`. */
export const BAD_PATH_SEGMENT_RE = /(?:^|\/)\.{1,2}(?:\/|$)|\/\/|\/$/;
export const HTTPS_URL_RE = /^https:\/\/[^\s/?#@]+(?:\/[^\s?#]*)?$/;

export const isSafeRelease = (value: string): boolean =>
  RELEASE_RE.test(value) &&
  !value.includes('..') &&
  !value.includes('//') &&
  !value.endsWith('/') &&
  !value.endsWith('.') &&
  !value.toLowerCase().endsWith('.lock');

export const isSafeRelativePath = (value: string): boolean =>
  RELATIVE_PATH_RE.test(value) && !BAD_PATH_SEGMENT_RE.test(value);

const relativePath = z
  .string()
  .max(MAX_PATH_LENGTH)
  .refine(isSafeRelativePath, 'must be a workspace-relative path without "." or ".." segments');

const contractAddress = z
  .string()
  .regex(LOWER_ADDRESS_RE, 'must be a lowercase 0x-prefixed 20-byte address')
  .refine(
    (a) => a !== ZERO_ADDRESS && a !== DEAD_ADDRESS,
    'the zero and dead addresses are never a contract identity',
  );

const unique =
  <T>(key: (item: T) => string) =>
  (items: readonly T[]) =>
    new Set(items.map(key)).size === items.length;

export const ArtifactHashSchema = z
  .object({
    path: relativePath,
    sha256: z.string().regex(SHA256_RE),
    bytes: z.number().int().min(0),
  })
  .strict();

export const ManifestReferenceSchema = z
  .object({
    path: relativePath,
    sha256: z.string().regex(SHA256_RE),
    version: z.literal(1),
    chainId: z.literal(CHAIN_ID),
  })
  .strict();

export const WorkflowRunSchema = z
  .object({
    id: z.string().regex(RUN_ID_RE),
    attempt: z.number().int().min(1),
    url: z.string().max(600).regex(HTTPS_URL_RE),
    event: z.string().regex(EVENT_RE),
    workflowRef: z.string().max(600).regex(WORKFLOW_REF_RE).optional(),
    workflowSha: z.string().regex(COMMIT_RE).optional(),
  })
  .strict();

export const GeneratorSchema = z
  .object({
    name: z.literal(GENERATOR_NAME),
    version: z.string().regex(SEMVER_RE),
  })
  .strict();

export const ShipEvidenceSchema = z
  .object({
    schema: z.literal(SHIP_SCHEMA),
    declarationState: z.literal('DECLARED'),
    chainId: z.literal(CHAIN_ID),
    repository: z.string().regex(REPOSITORY_RE),
    repositoryUrl: z.string().max(600).regex(HTTPS_URL_RE),
    commit: z.string().regex(COMMIT_RE),
    ref: z.string().regex(REF_RE).optional(),
    refName: z.string().regex(REF_NAME_RE).optional(),
    refType: z.enum(['branch', 'tag']).optional(),
    release: z
      .string()
      .refine(isSafeRelease, 'must be a tag-like release name')
      .refine((r) => !isRollingTag(r), 'a rolling tag is never a release')
      .optional(),
    timestamp: z.string().regex(TIMESTAMP_RE),
    workflowRun: WorkflowRunSchema,
    contracts: z
      .array(contractAddress)
      .min(1)
      .max(MAX_CONTRACTS)
      .refine(
        unique((a) => a),
        'contracts must be unique',
      )
      .optional(),
    deploymentTx: z.string().regex(LOWER_TX_HASH_RE).optional(),
    artifactHashes: z
      .array(ArtifactHashSchema)
      .min(1)
      .max(MAX_ARTIFACTS)
      .refine(
        unique((a) => a.path),
        'artifact paths must be unique',
      )
      .optional(),
    manifest: ManifestReferenceSchema.optional(),
    generator: GeneratorSchema,
  })
  .strict()
  .refine(
    (doc) =>
      doc.contracts !== undefined || doc.deploymentTx !== undefined || doc.release !== undefined,
    'ship evidence names at least one of contracts, deploymentTx or release',
  );

export type ShipEvidence = z.infer<typeof ShipEvidenceSchema>;
export type ArtifactHash = z.infer<typeof ArtifactHashSchema>;
export type ManifestReference = z.infer<typeof ManifestReferenceSchema>;
export type WorkflowRun = z.infer<typeof WorkflowRunSchema>;
