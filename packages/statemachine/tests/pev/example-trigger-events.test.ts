import { describe, it, expect } from "vitest";
import {
  getTriggerEvent,
  type ExampleTrigger,
} from "../../src/machines/example/events.js";

describe("getTriggerEvent", () => {
  describe("workflow-run-completed", () => {
    it("ciResult=success returns CI_SUCCESS", () => {
      expect(
        getTriggerEvent({
          trigger: "workflow-run-completed",
          ciResult: "success",
          reviewDecision: null,
        }),
      ).toEqual({ type: "CI_SUCCESS" });
    });

    it("ciResult=failure returns CI_FAILURE", () => {
      expect(
        getTriggerEvent({
          trigger: "workflow-run-completed",
          ciResult: "failure",
          reviewDecision: null,
        }),
      ).toEqual({ type: "CI_FAILURE" });
    });

    it("ciResult=cancelled returns START", () => {
      expect(
        getTriggerEvent({
          trigger: "workflow-run-completed",
          ciResult: "cancelled",
          reviewDecision: null,
        }),
      ).toEqual({ type: "START" });
    });

    it("ciResult=skipped returns START", () => {
      expect(
        getTriggerEvent({
          trigger: "workflow-run-completed",
          ciResult: "skipped",
          reviewDecision: null,
        }),
      ).toEqual({ type: "START" });
    });

    it("ciResult=null returns START", () => {
      expect(
        getTriggerEvent({
          trigger: "workflow-run-completed",
          ciResult: null,
          reviewDecision: null,
        }),
      ).toEqual({ type: "START" });
    });
  });

  describe("pr-review-submitted", () => {
    it("reviewDecision=APPROVED returns REVIEW_APPROVED", () => {
      expect(
        getTriggerEvent({
          trigger: "pr-review-submitted",
          ciResult: null,
          reviewDecision: "APPROVED",
        }),
      ).toEqual({ type: "REVIEW_APPROVED" });
    });

    it("reviewDecision=CHANGES_REQUESTED returns REVIEW_CHANGES_REQUESTED", () => {
      expect(
        getTriggerEvent({
          trigger: "pr-review-submitted",
          ciResult: null,
          reviewDecision: "CHANGES_REQUESTED",
        }),
      ).toEqual({ type: "REVIEW_CHANGES_REQUESTED" });
    });

    it("reviewDecision=COMMENTED returns REVIEW_COMMENTED", () => {
      expect(
        getTriggerEvent({
          trigger: "pr-review-submitted",
          ciResult: null,
          reviewDecision: "COMMENTED",
        }),
      ).toEqual({ type: "REVIEW_COMMENTED" });
    });

    it("reviewDecision=null returns START", () => {
      expect(
        getTriggerEvent({
          trigger: "pr-review-submitted",
          ciResult: null,
          reviewDecision: null,
        }),
      ).toEqual({ type: "START" });
    });
  });

  it("pr-merged returns PR_MERGED", () => {
    expect(
      getTriggerEvent({
        trigger: "pr-merged",
        ciResult: null,
        reviewDecision: null,
      }),
    ).toEqual({ type: "PR_MERGED" });
  });

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

  for (const trigger of defaultTriggers) {
    it(`${trigger} returns START`, () => {
      expect(
        getTriggerEvent({ trigger, ciResult: null, reviewDecision: null }),
      ).toEqual({ type: "START" });
    });
  }
});
