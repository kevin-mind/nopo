import { describe, it, expect } from "vitest";
import { determineOutcome } from "../src/core/action-utils.js";

describe("determineOutcome", () => {
  const baseParams = {
    deriveResult: "success" as const,
    execResult: "success" as const,
    actionCount: 1,
    transitionName: "Iterate",
    phase: "1",
    subIssueNumber: 101,
    repoUrl: "https://github.com/owner/repo",
  };

  it("Iterate with no existing PR → Opened PR", () => {
    const result = determineOutcome({
      ...baseParams,
      hadExistingPR: false,
    });
    expect(result.emoji).toBe("✅");
    expect(result.transition).toBe(
      "Opened PR - [Phase 1](https://github.com/owner/repo/issues/101)",
    );
  });

  it("Iterate with existing PR → Updated PR", () => {
    const result = determineOutcome({
      ...baseParams,
      hadExistingPR: true,
    });
    expect(result.emoji).toBe("✅");
    expect(result.transition).toBe(
      "Updated PR - [Phase 1](https://github.com/owner/repo/issues/101)",
    );
  });

  it("Iterate with stopReason branch_rebased_and_pushed → Rebased", () => {
    const result = determineOutcome({
      ...baseParams,
      stopReason: "branch_rebased_and_pushed",
    });
    expect(result.emoji).toBe("🔄");
    expect(result.transition).toBe(
      "Rebased - [Phase 1](https://github.com/owner/repo/issues/101)",
    );
  });

  it("Fix CI → Fixed CI", () => {
    const result = determineOutcome({
      ...baseParams,
      transitionName: "Fix CI",
      hadExistingPR: true,
    });
    expect(result.emoji).toBe("🔧");
    expect(result.transition).toBe(
      "Fixed CI - [Phase 1](https://github.com/owner/repo/issues/101)",
    );
  });

  it("Fix CI with rebase → Rebased (overrides Fix CI)", () => {
    const result = determineOutcome({
      ...baseParams,
      transitionName: "Fix CI",
      stopReason: "branch_rebased_and_pushed",
    });
    expect(result.emoji).toBe("🔄");
    expect(result.transition).toBe(
      "Rebased - [Phase 1](https://github.com/owner/repo/issues/101)",
    );
  });

  it("Iterate without phase info → no phase link suffix", () => {
    const result = determineOutcome({
      ...baseParams,
      phase: "-",
      subIssueNumber: undefined,
      hadExistingPR: false,
    });
    expect(result.transition).toBe("Opened PR");
  });

  it("non-iterate transitions are not affected", () => {
    const result = determineOutcome({
      ...baseParams,
      transitionName: "Triage",
    });
    expect(result.transition).toBe("Triage");
    expect(result.emoji).toBe("✅");
  });

  it("failed iterate is not enriched", () => {
    const result = determineOutcome({
      ...baseParams,
      execResult: "failure",
      hadExistingPR: false,
    });
    expect(result.emoji).toBe("❌");
    expect(result.transition).toBe("Iterate");
  });
});
