import { describe, it, expect } from "vitest";
import { determineOutcome, type OutcomeParams } from "./outcome.js";

describe("determineOutcome", () => {
  const baseParams: OutcomeParams = {
    deriveResult: "success",
    execResult: "success",
    actionCount: 1,
    transitionName: "Iterate",
    phase: "1",
    repoUrl: "https://github.com/owner/repo",
  };

  describe("status determination", () => {
    it("returns Done when derive and exec both succeed", () => {
      const result = determineOutcome(baseParams);
      expect(result.status).toBe("Done");
      expect(result.emoji).toBe("✅");
    });

    it("returns Done when derive succeeds and exec is skipped", () => {
      const result = determineOutcome({
        ...baseParams,
        execResult: "skipped",
      });
      expect(result.status).toBe("Done");
      expect(result.emoji).toBe("✅");
    });

    it("returns Done when derive succeeds and action count is 0", () => {
      const result = determineOutcome({
        ...baseParams,
        execResult: "failure",
        actionCount: 0,
      });
      expect(result.status).toBe("Done");
      expect(result.emoji).toBe("✅");
    });

    it("returns Cancelled when derive is cancelled", () => {
      const result = determineOutcome({
        ...baseParams,
        deriveResult: "cancelled",
      });
      expect(result.status).toBe("Cancelled");
      expect(result.emoji).toBe("⚠️");
    });

    it("returns Cancelled when exec is cancelled", () => {
      const result = determineOutcome({
        ...baseParams,
        execResult: "cancelled",
      });
      expect(result.status).toBe("Cancelled");
      expect(result.emoji).toBe("⚠️");
    });

    it("returns Failed when derive fails", () => {
      const result = determineOutcome({
        ...baseParams,
        deriveResult: "failure",
      });
      expect(result.status).toBe("Failed");
      expect(result.emoji).toBe("❌");
    });

    it("returns Failed when exec fails with actions", () => {
      const result = determineOutcome({
        ...baseParams,
        execResult: "failure",
        actionCount: 1,
      });
      expect(result.status).toBe("Failed");
      expect(result.emoji).toBe("❌");
    });
  });

  describe("transition formatting", () => {
    it("returns transition name as-is for regular transitions", () => {
      const result = determineOutcome({
        ...baseParams,
        transitionName: "Iterate",
      });
      expect(result.transition).toBe("Iterate");
    });

    it("formats Done transition with sub-issue link for phased work", () => {
      const result = determineOutcome({
        ...baseParams,
        transitionName: "Done",
        phase: "2",
        subIssueNumber: 123,
      });
      expect(result.transition).toBe(
        "[Phase 2] Done [#123](https://github.com/owner/repo/issues/123)",
      );
    });

    it("does not format Done transition without sub-issue", () => {
      const result = determineOutcome({
        ...baseParams,
        transitionName: "Done",
        phase: "1",
        subIssueNumber: undefined,
      });
      expect(result.transition).toBe("Done");
    });

    it("does not format Done transition when phase is dash", () => {
      const result = determineOutcome({
        ...baseParams,
        transitionName: "Done",
        phase: "-",
        subIssueNumber: 123,
      });
      expect(result.transition).toBe("Done");
    });

    it("returns 'unknown' for empty transition name", () => {
      const result = determineOutcome({
        ...baseParams,
        transitionName: "",
      });
      expect(result.transition).toBe("unknown");
    });
  });

  describe("link type determination", () => {
    it("returns commit SHA for Iterate transition", () => {
      const result = determineOutcome({
        ...baseParams,
        transitionName: "Iterate",
        commitSha: "abc1234",
        prNumber: 42,
      });
      expect(result.commitSha).toBe("abc1234");
      expect(result.prNumber).toBeNull();
    });

    it("returns PR number for In Review transition", () => {
      const result = determineOutcome({
        ...baseParams,
        transitionName: "In Review",
        commitSha: "abc1234",
        prNumber: 42,
      });
      expect(result.prNumber).toBe(42);
      expect(result.commitSha).toBeNull();
    });

    it("returns PR number for PR Review transition", () => {
      const result = determineOutcome({
        ...baseParams,
        transitionName: "PR Review",
        prNumber: 42,
      });
      expect(result.prNumber).toBe(42);
      expect(result.commitSha).toBeNull();
    });

    it("returns PR number for PR Response transition", () => {
      const result = determineOutcome({
        ...baseParams,
        transitionName: "PR Response",
        prNumber: 42,
      });
      expect(result.prNumber).toBe(42);
      expect(result.commitSha).toBeNull();
    });

    it("returns PR number for PR Human Response transition", () => {
      const result = determineOutcome({
        ...baseParams,
        transitionName: "PR Human Response",
        prNumber: 42,
      });
      expect(result.prNumber).toBe(42);
      expect(result.commitSha).toBeNull();
    });

    it("returns null PR for review transition without PR number", () => {
      const result = determineOutcome({
        ...baseParams,
        transitionName: "In Review",
        prNumber: 0,
      });
      expect(result.prNumber).toBeNull();
      expect(result.commitSha).toBeNull();
    });

    it("returns null commit SHA when not provided", () => {
      const result = determineOutcome({
        ...baseParams,
        transitionName: "Iterate",
        commitSha: undefined,
      });
      expect(result.commitSha).toBeNull();
    });
  });
});
