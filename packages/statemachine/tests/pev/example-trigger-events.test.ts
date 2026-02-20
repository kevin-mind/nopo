import { describe, expect, it } from "vitest";
import {
  getTriggerEvent,
  type ExampleTrigger,
} from "../../src/machines/example/events.js";

describe("getTriggerEvent", () => {
  describe("workflow-run-completed", () => {
    it("returns CI_SUCCESS when ciResult is success", () => {
      expect(
        getTriggerEvent({
          trigger: "workflow-run-completed",
          ciResult: "success",
          reviewDecision: null,
        }),
      ).toEqual({ type: "CI_SUCCESS" });
    });

    it("returns CI_FAILURE when ciResult is failure", () => {
      expect(
        getTriggerEvent({
          trigger: "workflow-run-completed",
          ciResult: "failure",
          reviewDecision: null,
        }),
      ).toEqual({ type: "CI_FAILURE" });
    });

    it("returns START when ciResult is cancelled", () => {
      expect(
        getTriggerEvent({
          trigger: "workflow-run-completed",
          ciResult: "cancelled",
          reviewDecision: null,
        }),
      ).toEqual({ type: "START" });
    });

    it("returns START when ciResult is skipped", () => {
      expect(
        getTriggerEvent({
          trigger: "workflow-run-completed",
          ciResult: "skipped",
          reviewDecision: null,
        }),
      ).toEqual({ type: "START" });
    });

    it("returns START when ciResult is null", () => {
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
    it("returns REVIEW_APPROVED when reviewDecision is APPROVED", () => {
      expect(
        getTriggerEvent({
          trigger: "pr-review-submitted",
          ciResult: null,
          reviewDecision: "APPROVED",
        }),
      ).toEqual({ type: "REVIEW_APPROVED" });
    });

    it("returns REVIEW_CHANGES_REQUESTED when reviewDecision is CHANGES_REQUESTED", () => {
      expect(
        getTriggerEvent({
          trigger: "pr-review-submitted",
          ciResult: null,
          reviewDecision: "CHANGES_REQUESTED",
        }),
      ).toEqual({ type: "REVIEW_CHANGES_REQUESTED" });
    });

    it("returns REVIEW_COMMENTED when reviewDecision is COMMENTED", () => {
      expect(
        getTriggerEvent({
          trigger: "pr-review-submitted",
          ciResult: null,
          reviewDecision: "COMMENTED",
        }),
      ).toEqual({ type: "REVIEW_COMMENTED" });
    });

    it("returns START when reviewDecision is null", () => {
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
    it("returns PR_MERGED", () => {
      expect(
        getTriggerEvent({
          trigger: "pr-merged",
          ciResult: null,
          reviewDecision: null,
        }),
      ).toEqual({ type: "PR_MERGED" });
    });
  });

  describe("default triggers return START", () => {
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

    it.each(defaultTriggers)("%s returns START", (trigger) => {
      expect(
        getTriggerEvent({ trigger, ciResult: null, reviewDecision: null }),
      ).toEqual({ type: "START" });
    });
  });
});
