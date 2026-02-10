/**
 * State Machine Plan - Event detection and planning
 *
 * Runs detect logic and outputs context_json plus skip/concurrency fields.
 * Workflows pass context_json into sm-run.
 */

import {
  getRequiredInput,
  getOptionalInput,
  setOutputs,
} from "@more/statemachine";
import { detectEvent } from "./lib/router-impl.js";

async function run(): Promise<void> {
  const token = getRequiredInput("github_token");
  const resourceNumber = getOptionalInput("resource_number") || "";
  const triggerType = getOptionalInput("trigger_type") || undefined;

  const unifiedContext = await detectEvent(token, resourceNumber, triggerType);

  setOutputs({
    context_json: JSON.stringify(unifiedContext),
    skip: String(unifiedContext.skip),
    skip_reason: unifiedContext.skip_reason,
    concurrency_group: unifiedContext.concurrency_group,
    cancel_in_progress: String(unifiedContext.cancel_in_progress),
  });
}

run().catch((err) => {
  process.exitCode = 1;
  throw err;
});
