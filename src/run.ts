import { type Logger, setOutput } from './actions-io.js';
import { ShipEvidenceError, quote } from './errors.js';
import { buildEvidence, serializeEvidence, sha256Hex } from './evidence.js';
import { type Env, readGitHubContext } from './github-env.js';
import { readInputs } from './inputs.js';
import { readManifestReference } from './manifest.js';
import { confine, hashFile, workspaceRoot, writeFileInside } from './paths.js';
import { type ArtifactHash, SHIP_SCHEMA, type ShipEvidence } from './schema.js';

export interface RunOptions {
  now?: () => Date;
  log: Logger;
}

export interface RunResult {
  evidence: ShipEvidence;
  evidencePath: string;
  evidenceSha256: string;
}

/**
 * With `attest: true`, fail before writing anything when the job cannot request an OIDC token
 * (`permissions: id-token: write`), so the attestation step that follows does not fail late. Only
 * the presence of the runner's variables is checked; no token is requested and none is logged.
 */
export function assertAttestPermission(env: Env): void {
  if (!env.ACTIONS_ID_TOKEN_REQUEST_URL || !env.ACTIONS_ID_TOKEN_REQUEST_TOKEN) {
    throw new ShipEvidenceError(
      'attest_permission_missing',
      'attest is true but this job cannot request an OIDC token. Give the job ' +
        '"permissions: { id-token: write, attestations: write, contents: read }" and run ' +
        'actions/attest-build-provenance on the evidence file after this step.',
    );
  }
}

/** Build, check and write the evidence file, then set the step outputs. No network, no shell. */
export async function run(env: Env, options: RunOptions): Promise<RunResult> {
  const { log } = options;
  const context = readGitHubContext(env);
  const inputs = readInputs(env);
  if (inputs.attest) assertAttestPermission(env);

  const root = await workspaceRoot(context.workspace);
  const output = confine(root, inputs.outputPath, 'output-path');

  const artifactHashes: ArtifactHash[] = [];
  const seen = new Set<string>();
  for (const item of inputs.artifacts ?? []) {
    const target = confine(root, item, 'artifact');
    if (seen.has(target.rel)) {
      throw new ShipEvidenceError(
        'duplicate_artifact',
        `artifact ${quote(target.rel)} is listed more than once.`,
      );
    }
    if (target.rel === output.rel) {
      throw new ShipEvidenceError(
        'unsafe_path',
        'output-path may not also be listed as an artifact.',
      );
    }
    seen.add(target.rel);
    const digest = await hashFile(root, target, 'artifact');
    artifactHashes.push({ path: target.rel, sha256: digest.sha256, bytes: digest.bytes });
  }

  const manifest = await readManifestReference(root, inputs.manifestPath);
  if (manifest && manifest.path === output.rel) {
    throw new ShipEvidenceError('unsafe_path', 'output-path may not be the manifest.');
  }

  const evidence = buildEvidence({
    context,
    inputs,
    ...(artifactHashes.length > 0 ? { artifactHashes } : {}),
    ...(manifest ? { manifest } : {}),
    timestamp: (options.now ?? (() => new Date()))(),
  });
  const bytes = serializeEvidence(evidence);
  await writeFileInside(root, output, 'output-path', bytes);
  const evidenceSha256 = sha256Hex(bytes);

  const wroteOutputs =
    setOutput(env, 'evidence-path', output.rel) &&
    setOutput(env, 'evidence-sha256', evidenceSha256);
  if (!wroteOutputs) log.warning('GITHUB_OUTPUT is not set; step outputs were not written.');

  log.info(`Wrote ${SHIP_SCHEMA} evidence to ${output.rel} (sha256 ${evidenceSha256}).`);
  log.info(
    `Declared: ${evidence.contracts?.length ?? 0} contract(s), deployment tx ${evidence.deploymentTx ? 'given' : 'not given'}, ` +
      `release ${evidence.release ?? 'not given'}, ${artifactHashes.length} artifact hash(es), ` +
      `manifest ${manifest ? manifest.path : 'not referenced'}.`,
  );
  if (!manifest && inputs.manifestPath === 'auto') {
    log.info(
      'No hey-project.json found in the usual places (.well-known/, public/, static/, site/, web/, docs/ …); ' +
        'set manifest-path to reference one.',
    );
  }
  log.info('This file is declared evidence. It does not publish or verify anything on HEY.');
  if (inputs.attest) {
    log.info(
      `Attest it with actions/attest-build-provenance (subject-path: ${output.rel}); verify with ` +
        `"gh attestation verify ${output.rel} --repo ${context.repository}".`,
    );
  }
  return { evidence, evidencePath: output.rel, evidenceSha256 };
}
