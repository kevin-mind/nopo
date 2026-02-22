import { describe, expect, it } from "vitest";
import {
  computeExpectedStatus,
  isStatusCompatible,
} from "../../src/machines/example/milestones.js";
import {
  mockExampleContext,
  mockExampleIssue,
  mockExamplePR,
} from "./mock-factories.js";

describe("computeExpectedStatus", () => {
  describe("parent-issue path (parentIssue === null)", () => {
    it("returns Backlog when issue is new and untriaged (no sub-issues, unstructured body, no type labels)", () => {
      const ctx = mockExampleContext({
        parentIssue: null,
        issue: mockExampleIssue({
          hasSubIssues: false,
          subIssues: [],
          body: "A raw description without structured sections.",
          labels: [], // no type:* labels — not yet triaged
        }),
      });
      expect(computeExpectedStatus(ctx)).toBe("Backlog");
    });

    it("returns Groomed when has sub-issues but none are active", () => {
      const ctx = mockExampleContext({
        parentIssue: null,
        issue: mockExampleIssue({
          hasSubIssues: true,
          subIssues: [{ number: 100, projectStatus: "Backlog", state: "OPEN" }],
        }),
      });
      expect(computeExpectedStatus(ctx)).toBe("Groomed");
    });

    it("returns In progress when one OPEN sub-issue has In progress status", () => {
      const ctx = mockExampleContext({
        parentIssue: null,
        issue: mockExampleIssue({
          hasSubIssues: true,
          subIssues: [
            { number: 100, projectStatus: "In progress", state: "OPEN" },
          ],
        }),
      });
      expect(computeExpectedStatus(ctx)).toBe("In progress");
    });

    it("returns In progress when one OPEN sub-issue has In review status", () => {
      const ctx = mockExampleContext({
        parentIssue: null,
        issue: mockExampleIssue({
          hasSubIssues: true,
          subIssues: [
            { number: 100, projectStatus: "In review", state: "OPEN" },
          ],
        }),
      });
      expect(computeExpectedStatus(ctx)).toBe("In progress");
    });

    it("returns Done when all sub-issues have Done status", () => {
      const ctx = mockExampleContext({
        parentIssue: null,
        issue: mockExampleIssue({
          hasSubIssues: true,
          subIssues: [
            { number: 100, projectStatus: "Done", state: "OPEN" },
            { number: 101, projectStatus: "Done", state: "OPEN" },
          ],
        }),
      });
      expect(computeExpectedStatus(ctx)).toBe("Done");
    });

    it("returns Done when all sub-issues are CLOSED", () => {
      const ctx = mockExampleContext({
        parentIssue: null,
        issue: mockExampleIssue({
          hasSubIssues: true,
          subIssues: [
            { number: 100, projectStatus: "Backlog", state: "CLOSED" },
            { number: 101, projectStatus: "Backlog", state: "CLOSED" },
          ],
        }),
      });
      expect(computeExpectedStatus(ctx)).toBe("Done");
    });

    it("returns Triaged when body has ## Approach section and type:* label", () => {
      const ctx = mockExampleContext({
        parentIssue: null,
        issue: mockExampleIssue({
          hasSubIssues: false,
          body: "## Approach\nSome text",
          labels: ["type:enhancement"],
        }),
      });
      expect(computeExpectedStatus(ctx)).toBe("Triaged");
    });
  });

  describe("sub-issue path (parentIssue !== null)", () => {
    it("returns Backlog when no PR and bot not assigned", () => {
      const ctx = mockExampleContext({
        parentIssue: mockExampleIssue({ number: 1 }),
        issue: mockExampleIssue({ assignees: [] }),
        pr: null,
        botUsername: "nopo-bot",
      });
      expect(computeExpectedStatus(ctx)).toBe("Backlog");
    });

    it("returns In progress when bot is in assignees", () => {
      const ctx = mockExampleContext({
        parentIssue: mockExampleIssue({ number: 1 }),
        issue: mockExampleIssue({ assignees: ["nopo-bot"] }),
        pr: null,
        botUsername: "nopo-bot",
      });
      expect(computeExpectedStatus(ctx)).toBe("In progress");
    });

    it("returns In review when PR is OPEN and not a draft", () => {
      const ctx = {
        ...mockExampleContext({
          parentIssue: mockExampleIssue({ number: 1 }),
          issue: mockExampleIssue({ assignees: [] }),
          botUsername: "nopo-bot",
        }),
        pr: mockExamplePR({ state: "OPEN", isDraft: false }),
      };
      expect(computeExpectedStatus(ctx)).toBe("In review");
    });

    it("returns Done when PR is MERGED", () => {
      const ctx = {
        ...mockExampleContext({
          parentIssue: mockExampleIssue({ number: 1 }),
          issue: mockExampleIssue({ assignees: [] }),
          botUsername: "nopo-bot",
        }),
        pr: mockExamplePR({ state: "MERGED" }),
      };
      expect(computeExpectedStatus(ctx)).toBe("Done");
    });

    it("returns In progress when PR is OPEN but draft and bot is assigned", () => {
      const ctx = {
        ...mockExampleContext({
          parentIssue: mockExampleIssue({ number: 1 }),
          issue: mockExampleIssue({ assignees: ["nopo-bot"] }),
          botUsername: "nopo-bot",
        }),
        pr: mockExamplePR({ state: "OPEN", isDraft: true }),
      };
      expect(computeExpectedStatus(ctx)).toBe("In progress");
    });

    it("returns Backlog when PR is OPEN but draft and bot is not assigned", () => {
      const ctx = {
        ...mockExampleContext({
          parentIssue: mockExampleIssue({ number: 1 }),
          issue: mockExampleIssue({ assignees: [] }),
          botUsername: "nopo-bot",
        }),
        pr: mockExamplePR({ state: "OPEN", isDraft: true }),
      };
      expect(computeExpectedStatus(ctx)).toBe("Backlog");
    });
  });
});

describe("isStatusCompatible", () => {
  it("returns true for exact match", () => {
    expect(isStatusCompatible("Backlog", "Backlog")).toBe(true);
    expect(isStatusCompatible("Done", "Done")).toBe(true);
    expect(isStatusCompatible("In progress", "In progress")).toBe(true);
  });

  it("returns true when actual is null and expected is Backlog", () => {
    expect(isStatusCompatible(null, "Backlog")).toBe(true);
  });

  it("returns false when actual is null and expected is not Backlog", () => {
    expect(isStatusCompatible(null, "Done")).toBe(false);
    expect(isStatusCompatible(null, "In progress")).toBe(false);
  });

  it("returns false for mismatched statuses including Triaged when expected is Backlog", () => {
    expect(isStatusCompatible("In progress", "Done")).toBe(false);
    expect(isStatusCompatible("Backlog", "Done")).toBe(false);
    expect(isStatusCompatible("Triaged", "Done")).toBe(false);
    // Triaged is NOT compatible with Backlog: if project status is Triaged,
    // milestones must also detect triage signals (## Approach + type:* label).
    // A Triaged project status with no triage artifacts is a state mismatch.
    expect(isStatusCompatible("Triaged", "Backlog")).toBe(false);
  });
});
