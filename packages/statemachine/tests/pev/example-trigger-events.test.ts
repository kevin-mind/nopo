import { describe, expect, it } from "vitest";
import {
  getTriggerEvent,
  type ExampleTrigger,
  type ExampleCIResult,
  type ExampleReviewDecision,
} from "../../src/machines/example/events.js";

describe("getTriggerEvent", () => {
  describe("workflow-run-completed", () => {
    it("ciResult=success → CI_SUCCESS", () => {
      expect(
        getTriggerEvent({
          trigger: "workflow-run-completed",
          ciResult: "success",
          reviewDecision: null,
        }),
      ).toEqual({ type: "CI_SUCCESS" });
    });

    it("ciResult=failure → CI_FAILURE", () => {
      expect(
        getTriggerEvent({
          trigger: "workflow-run-completed",
          ciResult: "failure",
          reviewDecision: null,
        }),
      ).toEqual({ type: "CI_FAILURE" });
    });

    it.each<ExampleCIResult | null>(["cancelled", "skipped", null])(
      "ciResult=%s → START",
      (ciResult) => {
        expect(
          getTriggerEvent({
            trigger: "workflow-run-completed",
            ciResult,
            reviewDecision: null,
          }),
        ).toEqual({ type: "START" });
      },
    );
  });

  describe("pr-review-submitted", () => {
    it("reviewDecision=APPROVED → REVIEW_APPROVED", () => {
      expect(
        getTriggerEvent({
          trigger: "pr-review-submitted",
          ciResult: null,
          reviewDecision: "APPROVED",
        }),
      ).toEqual({ type: "REVIEW_APPROVED" });
    });

    it("reviewDecision=CHANGES_REQUESTED → REVIEW_CHANGES_REQUESTED", () => {
      expect(
        getTriggerEvent({
          trigger: "pr-review-submitted",
          ciResult: null,
          reviewDecision: "CHANGES_REQUESTED",
        }),
      ).toEqual({ type: "REVIEW_CHANGES_REQUESTED" });
    });

    it("reviewDecision=COMMENTED → REVIEW_COMMENTED", () => {
      expect(
        getTriggerEvent({
          trigger: "pr-review-submitted",
          ciResult: null,
          reviewDecision: "COMMENTED",
        }),
      ).toEqual({ type: "REVIEW_COMMENTED" });
    });

    it("reviewDecision=null → START", () => {
      expect(
        getTriggerEvent({
          trigger: "pr-review-submitted",
          ciResult: null,
          reviewDecision: null,
        }),
      ).toEqual({ type: "START" });
    });
  });

  describe("pr-merged", () => {
    it("pr-merged → PR_MERGED", () => {
      expect(
        getTriggerEvent({
          trigger: "pr-merged",
          ciResult: null,
          reviewDecision: null,
        }),
      ).toEqual({ type: "PR_MERGED" });
    });
  });

  describe("default triggers → START", () => {
    const defaultTriggers: ExampleTrigger[] = [
      "issue-assigned",
      "issue-edited",
      "issue-closed",
      "issue-triage",
      "issue-groom",
      "issue-groom-summary",
      "issue-orchestrate",
      "issue-comment",
      "issue-pivot",
      "issue-reset",
      "issue-retry",
      "pr-review-requested",
      "pr-review",
      "pr-review-approved",
      "pr-response",
      "pr-human-response",
      "pr-push",
      "merge-queue-entered",
      "merge-queue-failed",
      "deployed-stage",
      "deployed-prod",
      "deployed-stage-failed",
      "deployed-prod-failed",
    ];

    it.each(defaultTriggers)("%s → START", (trigger) => {
      expect(
        getTriggerEvent({ trigger, ciResult: null, reviewDecision: null }),
      ).toEqual({ type: "START" });
    });
  });
});
