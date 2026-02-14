/**
 * Issue machine event types and trigger-to-event mapping.
 */

import type { MachineContext } from "../../core/schemas.js";

/**
 * Machine events
 */
export type IssueMachineEvent =
  | { type: "START" }
  | { type: "DETECT" }
  | { type: "CI_SUCCESS" }
  | { type: "CI_FAILURE" }
  | { type: "REVIEW_APPROVED" }
  | { type: "REVIEW_CHANGES_REQUESTED" }
  | { type: "REVIEW_COMMENTED" }
  | { type: "PR_MERGED" }
  | { type: "CONTINUE" };

/**
 * Get the initial event based on trigger type
 */
export function getTriggerEvent(context: MachineContext): IssueMachineEvent {
  switch (context.trigger) {
    case "workflow-run-completed":
      if (context.ciResult === "success") {
        return { type: "CI_SUCCESS" };
      } else if (context.ciResult === "failure") {
        return { type: "CI_FAILURE" };
      }
      return { type: "START" };

    case "pr-review-submitted":
      switch (context.reviewDecision) {
        case "APPROVED":
          return { type: "REVIEW_APPROVED" };
        case "CHANGES_REQUESTED":
          return { type: "REVIEW_CHANGES_REQUESTED" };
        case "COMMENTED":
          return { type: "REVIEW_COMMENTED" };
        default:
          return { type: "START" };
      }

    default:
      return { type: "START" };
  }
}
