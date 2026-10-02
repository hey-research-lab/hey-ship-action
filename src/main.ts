import { consoleLogger } from './actions-io.js';
import { ShipEvidenceError } from './errors.js';
import { run } from './run.js';

/** The action's entry point (`dist/index.js`). */
run(process.env, { log: consoleLogger }).catch((error: unknown) => {
  if (error instanceof ShipEvidenceError) {
    consoleLogger.error(error.message, `hey-ship-action: ${error.code}`);
  } else {
    // An unexpected failure: report its class and message only, never the environment.
    const message = error instanceof Error ? `${error.name}: ${error.message}` : 'unknown error';
    consoleLogger.error(message.slice(0, 500), 'hey-ship-action: internal_error');
  }
  process.exitCode = 1;
});
