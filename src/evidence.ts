import { createHash } from 'node:crypto';

import { CHAIN_ID } from './chain.js';
import { ShipEvidenceError } from './errors.js';
import { type GitHubContext, repositoryUrl, workflowRunUrl } from './github-env.js';
import type { ActionInputs } from './inputs.js';
import {
  type ArtifactHash,
  type ManifestReference,
  SHIP_SCHEMA,
  type ShipEvidence,
  ShipEvidenceSchema,
} from './schema.js';
import { GENERATOR_NAME, GENERATOR_VERSION } from './version.js';

export interface EvidenceParts {
  context: GitHubContext;
  inputs: Pick<ActionInputs, 'contracts' | 'deploymentTx' | 'release'>;
  artifactHashes?: ArtifactHash[];
  manifest?: ManifestReference;
  timestamp: Date;
}

/**
 * Assemble a `hey.ship/v1` document. Key order is fixed so the same facts always serialise to the
 * same bytes. Unknown facts are left out, never written as `null`, `[]` or `""`.
 */
export function buildEvidence(parts: EvidenceParts): ShipEvidence {
  const { context, inputs } = parts;
  const draft: Record<string, unknown> = {
    schema: SHIP_SCHEMA,
    declarationState: 'DECLARED',
    chainId: CHAIN_ID,
    repository: context.repository,
    repositoryUrl: repositoryUrl(context),
    commit: context.commit,
    ref: context.ref,
    refName: context.refName,
    refType: context.refType,
    release: inputs.release,
    timestamp: parts.timestamp.toISOString(),
    workflowRun: {
      id: context.runId,
      attempt: context.runAttempt,
      url: workflowRunUrl(context),
      event: context.event,
      workflowRef: context.workflowRef,
      workflowSha: context.workflowSha,
    },
    contracts: inputs.contracts,
    deploymentTx: inputs.deploymentTx,
    artifactHashes: parts.artifactHashes,
    manifest: parts.manifest,
    generator: { name: GENERATOR_NAME, version: GENERATOR_VERSION },
  };
  const parsed = ShipEvidenceSchema.safeParse(JSON.parse(JSON.stringify(draft)));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ShipEvidenceError(
      'invalid_evidence',
      `the evidence document failed its own schema at ${issue?.path.join('.') || '(root)'}: ${issue?.message ?? 'invalid'}.`,
    );
  }
  // Re-serialise the draft (not zod's output) so the key order above is the order written.
  return JSON.parse(JSON.stringify(draft)) as ShipEvidence;
}

/** The exact bytes written: two-space JSON with a trailing newline. */
export function serializeEvidence(evidence: ShipEvidence): Buffer {
  return Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
}

export const sha256Hex = (content: Buffer): string =>
  createHash('sha256').update(content).digest('hex');
