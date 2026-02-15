import { describe, it, expect } from "vitest";
import { BaseVerifier } from "../../src/core/verifier/base-verifier.js";
import type { FieldDiff } from "../../src/core/verifier/types.js";

/**
 * Minimal TestVerifier for unit testing BaseVerifier abstract class.
 * Uses simple tree type with arbitrary fields for testing verification logic.
 */
interface TestTree {
  status: string;
  count: number;
  tags?: string[];
  metadata?: { key: string; value: string };
}

interface TestContext {
  tree: TestTree;
  finalState: string;
}

class TestVerifier extends BaseVerifier<TestTree, TestContext> {
  /** Extract tree from context (identity) */
  extractTree(context: TestContext): TestTree {
    return context.tree;
  }

  /** Shallow field comparison - returns diffs for mismatched top-level fields */
  compareTree(expected: TestTree, actual: TestTree): FieldDiff[] {
    const diffs: FieldDiff[] = [];

    if (expected.status !== actual.status) {
      diffs.push({
        path: "status",
        expected: expected.status,
        actual: actual.status,
        comparison: "exact",
      });
    }

    if (expected.count !== actual.count) {
      diffs.push({
        path: "count",
        expected: expected.count,
        actual: actual.count,
        comparison: "exact",
      });
    }

    if (expected.tags !== undefined) {
      const actualSet = new Set(actual.tags || []);
      const missing = expected.tags.filter((tag) => !actualSet.has(tag));
      if (missing.length > 0) {
        diffs.push({
          path: "tags",
          expected: expected.tags,
          actual: actual.tags,
          comparison: "superset",
        });
      }
    }

    if (expected.metadata !== undefined) {
      if (
        !actual.metadata ||
        expected.metadata.key !== actual.metadata.key ||
        expected.metadata.value !== actual.metadata.value
      ) {
        diffs.push({
          path: "metadata",
          expected: expected.metadata,
          actual: actual.metadata,
          comparison: "exact",
        });
      }
    }

    return diffs;
  }

  /** Hardcoded retrigger prediction - returns true for "working", false otherwise */
  predictRetrigger(finalState: string): boolean {
    return finalState === "working";
  }
}

describe("BaseVerifier.verifyOutcomes()", () => {
  it("passes with empty expected outcomes", () => {
    const verifier = new TestVerifier();
    const actual: TestTree = { status: "done", count: 1 };

    const result = verifier.verifyOutcomes([], actual);

    expect(result.pass).toBe(true);
    expect(result.matchedOutcomeIndex).toBeNull();
    expect(result.bestMatch.outcomeIndex).toBe(-1);
    expect(result.bestMatch.diffs).toHaveLength(0);
  });

  it("passes when single expected outcome matches", () => {
    const verifier = new TestVerifier();
    const expected: TestTree = { status: "done", count: 5 };
    const actual: TestTree = { status: "done", count: 5 };

    const result = verifier.verifyOutcomes([expected], actual);

    expect(result.pass).toBe(true);
    expect(result.matchedOutcomeIndex).toBe(0);
    expect(result.bestMatch.outcomeIndex).toBe(0);
    expect(result.bestMatch.diffs).toHaveLength(0);
  });

  it("fails when single expected outcome differs, returns diffs", () => {
    const verifier = new TestVerifier();
    const expected: TestTree = { status: "done", count: 10 };
    const actual: TestTree = { status: "pending", count: 5 };

    const result = verifier.verifyOutcomes([expected], actual);

    expect(result.pass).toBe(false);
    expect(result.matchedOutcomeIndex).toBeNull();
    expect(result.bestMatch.outcomeIndex).toBe(0);
    expect(result.bestMatch.diffs.length).toBeGreaterThan(0);
    expect(result.bestMatch.diffs).toContainEqual({
      path: "status",
      expected: "done",
      actual: "pending",
      comparison: "exact",
    });
    expect(result.bestMatch.diffs).toContainEqual({
      path: "count",
      expected: 10,
      actual: 5,
      comparison: "exact",
    });
  });

  it("passes when second outcome matches (union logic)", () => {
    const verifier = new TestVerifier();
    const outcome1: TestTree = { status: "failed", count: 0 };
    const outcome2: TestTree = { status: "done", count: 5 };
    const actual: TestTree = { status: "done", count: 5 };

    const result = verifier.verifyOutcomes([outcome1, outcome2], actual);

    expect(result.pass).toBe(true);
    expect(result.matchedOutcomeIndex).toBe(1);
    expect(result.bestMatch.outcomeIndex).toBe(1);
    expect(result.bestMatch.diffs).toHaveLength(0);
  });

  it("fails when no outcome matches, selects best match with fewest diffs", () => {
    const verifier = new TestVerifier();
    // Outcome 1: 1 diff (only count differs)
    const outcome1: TestTree = { status: "done", count: 10 };
    // Outcome 2: 2 diffs (both status and count differ)
    const outcome2: TestTree = { status: "failed", count: 0 };
    const actual: TestTree = { status: "done", count: 5 };

    const result = verifier.verifyOutcomes([outcome1, outcome2], actual);

    expect(result.pass).toBe(false);
    expect(result.matchedOutcomeIndex).toBeNull();
    // Best match should be outcome1 (fewer diffs)
    expect(result.bestMatch.outcomeIndex).toBe(0);
    expect(result.bestMatch.diffs).toHaveLength(1);
    expect(result.bestMatch.diffs[0]).toEqual({
      path: "count",
      expected: 10,
      actual: 5,
      comparison: "exact",
    });
  });

  it("handles tags superset comparison", () => {
    const verifier = new TestVerifier();
    const expected: TestTree = { status: "done", count: 1, tags: ["bug"] };
    const actual: TestTree = {
      status: "done",
      count: 1,
      tags: ["bug", "enhancement"],
    };

    const result = verifier.verifyOutcomes([expected], actual);

    expect(result.pass).toBe(true);
  });

  it("fails when expected tags missing from actual", () => {
    const verifier = new TestVerifier();
    const expected: TestTree = {
      status: "done",
      count: 1,
      tags: ["bug", "enhancement"],
    };
    const actual: TestTree = { status: "done", count: 1, tags: ["bug"] };

    const result = verifier.verifyOutcomes([expected], actual);

    expect(result.pass).toBe(false);
    expect(result.bestMatch.diffs).toContainEqual({
      path: "tags",
      expected: ["bug", "enhancement"],
      actual: ["bug"],
      comparison: "superset",
    });
  });
});

describe("BaseVerifier.verify()", () => {
  it("passes when retrigger matches expected", () => {
    const verifier = new TestVerifier();
    const expected: TestTree = { status: "done", count: 5 };
    const actual: TestTree = { status: "done", count: 5 };

    const result = verifier.verify([expected], actual, {
      expectedRetrigger: true,
      actualRetrigger: true,
    });

    expect(result.pass).toBe(true);
    expect(result.result.pass).toBe(true);
    expect(result.retriggerPass).toBe(true);
  });

  it("fails when retrigger differs from expected", () => {
    const verifier = new TestVerifier();
    const expected: TestTree = { status: "done", count: 5 };
    const actual: TestTree = { status: "done", count: 5 };

    const result = verifier.verify([expected], actual, {
      expectedRetrigger: true,
      actualRetrigger: false,
    });

    expect(result.pass).toBe(false);
    expect(result.result.pass).toBe(true); // outcomes match
    expect(result.retriggerPass).toBe(false); // but retrigger mismatch
  });

  it("passes when actualRetrigger is undefined (skip retrigger check)", () => {
    const verifier = new TestVerifier();
    const expected: TestTree = { status: "done", count: 5 };
    const actual: TestTree = { status: "done", count: 5 };

    const result = verifier.verify([expected], actual, {
      expectedRetrigger: true,
      actualRetrigger: undefined,
    });

    expect(result.pass).toBe(true);
    expect(result.result.pass).toBe(true);
    expect(result.retriggerPass).toBe(true); // undefined = skip check
  });

  it("fails when outcomes mismatch but retrigger matches", () => {
    const verifier = new TestVerifier();
    const expected: TestTree = { status: "done", count: 10 };
    const actual: TestTree = { status: "pending", count: 5 };

    const result = verifier.verify([expected], actual, {
      expectedRetrigger: false,
      actualRetrigger: false,
    });

    expect(result.pass).toBe(false);
    expect(result.result.pass).toBe(false); // outcomes don't match
    expect(result.retriggerPass).toBe(true); // retrigger matches
  });

  it("passes when outcomes match, retrigger undefined", () => {
    const verifier = new TestVerifier();
    const expected: TestTree = { status: "done", count: 5 };
    const actual: TestTree = { status: "done", count: 5 };

    const result = verifier.verify([expected], actual, {
      expectedRetrigger: false,
      actualRetrigger: undefined,
    });

    expect(result.pass).toBe(true);
    expect(result.retriggerPass).toBe(true);
  });

  it("fails when both outcomes and retrigger mismatch", () => {
    const verifier = new TestVerifier();
    const expected: TestTree = { status: "done", count: 10 };
    const actual: TestTree = { status: "pending", count: 5 };

    const result = verifier.verify([expected], actual, {
      expectedRetrigger: true,
      actualRetrigger: false,
    });

    expect(result.pass).toBe(false);
    expect(result.result.pass).toBe(false);
    expect(result.retriggerPass).toBe(false);
  });

  it("passes with multiple outcomes where one matches and retrigger matches", () => {
    const verifier = new TestVerifier();
    const outcome1: TestTree = { status: "failed", count: 0 };
    const outcome2: TestTree = { status: "done", count: 5 };
    const actual: TestTree = { status: "done", count: 5 };

    const result = verifier.verify([outcome1, outcome2], actual, {
      expectedRetrigger: true,
      actualRetrigger: true,
    });

    expect(result.pass).toBe(true);
    expect(result.result.matchedOutcomeIndex).toBe(1);
    expect(result.retriggerPass).toBe(true);
  });

  it("fails when outcome matches but retrigger mismatches", () => {
    const verifier = new TestVerifier();
    const outcome1: TestTree = { status: "failed", count: 0 };
    const outcome2: TestTree = { status: "done", count: 5 };
    const actual: TestTree = { status: "done", count: 5 };

    const result = verifier.verify([outcome1, outcome2], actual, {
      expectedRetrigger: true,
      actualRetrigger: false,
    });

    expect(result.pass).toBe(false);
    expect(result.result.pass).toBe(true); // outcome matches
    expect(result.retriggerPass).toBe(false); // retrigger mismatches
  });
});
