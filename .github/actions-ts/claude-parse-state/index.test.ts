import { describe, it, expect } from "vitest";

// We can only test pure functions without mocking - test the parsing logic
const STATE_MARKER_START = "<!-- CLAUDE_ITERATION";
const STATE_MARKER_END = "-->";
const HISTORY_SECTION = "## Iteration History";

interface IterationState {
  iteration: number;
  branch: string;
  pr_number: string;
  last_ci_run: string;
  last_ci_result: "success" | "failure" | "pending" | "";
  consecutive_failures: number;
  failure_type: "ci" | "workflow" | "";
  last_failure_timestamp: string;
  complete: boolean;
}

function parseState(body: string): IterationState | null {
  const startIdx = body.indexOf(STATE_MARKER_START);
  if (startIdx === -1) {
    return null;
  }

  const endIdx = body.indexOf(STATE_MARKER_END, startIdx);
  if (endIdx === -1) {
    return null;
  }

  const stateBlock = body.slice(startIdx + STATE_MARKER_START.length, endIdx);
  const state: IterationState = {
    iteration: 0,
    branch: "",
    pr_number: "",
    last_ci_run: "",
    last_ci_result: "",
    consecutive_failures: 0,
    failure_type: "",
    last_failure_timestamp: "",
    complete: false,
  };

  for (const line of stateBlock.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) continue;

    const key = trimmed.slice(0, colonIdx).trim();
    const value = trimmed.slice(colonIdx + 1).trim();

    switch (key) {
      case "iteration":
        state.iteration = parseInt(value, 10) || 0;
        break;
      case "branch":
        state.branch = value;
        break;
      case "pr_number":
        state.pr_number = value;
        break;
      case "last_ci_run":
        state.last_ci_run = value;
        break;
      case "last_ci_result":
        state.last_ci_result = value as IterationState["last_ci_result"];
        break;
      case "consecutive_failures":
        state.consecutive_failures = parseInt(value, 10) || 0;
        break;
      case "failure_type":
        state.failure_type = value as IterationState["failure_type"];
        break;
      case "last_failure_timestamp":
        state.last_failure_timestamp = value;
        break;
      case "complete":
        state.complete = value === "true";
        break;
    }
  }

  return state;
}

function serializeState(state: IterationState): string {
  return `${STATE_MARKER_START}
iteration: ${state.iteration}
branch: ${state.branch}
pr_number: ${state.pr_number}
last_ci_run: ${state.last_ci_run}
last_ci_result: ${state.last_ci_result}
consecutive_failures: ${state.consecutive_failures}
failure_type: ${state.failure_type}
last_failure_timestamp: ${state.last_failure_timestamp}
complete: ${state.complete}
${STATE_MARKER_END}`;
}

function updateBodyWithState(body: string, state: IterationState): string {
  const stateBlock = serializeState(state);

  const startIdx = body.indexOf(STATE_MARKER_START);
  if (startIdx === -1) {
    return stateBlock + "\n\n" + body;
  }

  const endIdx = body.indexOf(STATE_MARKER_END, startIdx);
  if (endIdx === -1) {
    return stateBlock + "\n\n" + body;
  }

  return (
    body.slice(0, startIdx) +
    stateBlock +
    body.slice(endIdx + STATE_MARKER_END.length)
  );
}

describe("parseState", () => {
  it("returns null when no state marker exists", () => {
    const body = "## Description\n\nSome issue content";
    expect(parseState(body)).toBeNull();
  });

  it("parses state from issue body", () => {
    const body = `<!-- CLAUDE_ITERATION
iteration: 3
branch: claude/issue/42
pr_number: 123
last_ci_run: 456789
last_ci_result: failure
consecutive_failures: 1
failure_type: ci
last_failure_timestamp: 2024-01-15T10:30:00Z
complete: false
-->

## Description

Issue content here`;

    const state = parseState(body);
    expect(state).toEqual({
      iteration: 3,
      branch: "claude/issue/42",
      pr_number: "123",
      last_ci_run: "456789",
      last_ci_result: "failure",
      consecutive_failures: 1,
      failure_type: "ci",
      last_failure_timestamp: "2024-01-15T10:30:00Z",
      complete: false,
    });
  });

  it("handles complete=true", () => {
    const body = `<!-- CLAUDE_ITERATION
iteration: 5
branch: claude/issue/10
pr_number: 99
last_ci_run: 111
last_ci_result: success
consecutive_failures: 0
failure_type:
last_failure_timestamp:
complete: true
-->

Content`;

    const state = parseState(body);
    expect(state?.complete).toBe(true);
  });

  it("handles empty values", () => {
    const body = `<!-- CLAUDE_ITERATION
iteration: 0
branch: claude/issue/1
pr_number:
last_ci_run:
last_ci_result:
consecutive_failures: 0
failure_type:
last_failure_timestamp:
complete: false
-->`;

    const state = parseState(body);
    expect(state).toEqual({
      iteration: 0,
      branch: "claude/issue/1",
      pr_number: "",
      last_ci_run: "",
      last_ci_result: "",
      consecutive_failures: 0,
      failure_type: "",
      last_failure_timestamp: "",
      complete: false,
    });
  });

  it("parses workflow failure type", () => {
    const body = `<!-- CLAUDE_ITERATION
iteration: 2
branch: claude/issue/5
pr_number: 10
last_ci_run: 999
last_ci_result: pending
consecutive_failures: 3
failure_type: workflow
last_failure_timestamp: 2024-01-15T12:00:00Z
complete: false
-->`;

    const state = parseState(body);
    expect(state?.failure_type).toBe("workflow");
    expect(state?.consecutive_failures).toBe(3);
    expect(state?.last_failure_timestamp).toBe("2024-01-15T12:00:00Z");
  });
});

describe("serializeState", () => {
  it("serializes state to HTML comment block", () => {
    const state: IterationState = {
      iteration: 2,
      branch: "claude/issue/5",
      pr_number: "10",
      last_ci_run: "999",
      last_ci_result: "success",
      consecutive_failures: 0,
      failure_type: "",
      last_failure_timestamp: "",
      complete: false,
    };

    const serialized = serializeState(state);
    expect(serialized).toContain("<!-- CLAUDE_ITERATION");
    expect(serialized).toContain("iteration: 2");
    expect(serialized).toContain("branch: claude/issue/5");
    expect(serialized).toContain("pr_number: 10");
    expect(serialized).toContain("failure_type:");
    expect(serialized).toContain("last_failure_timestamp:");
    expect(serialized).toContain("-->");
  });

  it("serializes failure state correctly", () => {
    const state: IterationState = {
      iteration: 3,
      branch: "claude/issue/7",
      pr_number: "15",
      last_ci_run: "111",
      last_ci_result: "failure",
      consecutive_failures: 2,
      failure_type: "ci",
      last_failure_timestamp: "2024-01-15T10:30:00Z",
      complete: false,
    };

    const serialized = serializeState(state);
    expect(serialized).toContain("failure_type: ci");
    expect(serialized).toContain(
      "last_failure_timestamp: 2024-01-15T10:30:00Z",
    );
    expect(serialized).toContain("consecutive_failures: 2");
  });
});

describe("updateBodyWithState", () => {
  it("prepends state when none exists", () => {
    const body = "## Description\n\nContent";
    const state: IterationState = {
      iteration: 1,
      branch: "claude/issue/1",
      pr_number: "",
      last_ci_run: "",
      last_ci_result: "",
      consecutive_failures: 0,
      failure_type: "",
      last_failure_timestamp: "",
      complete: false,
    };

    const updated = updateBodyWithState(body, state);
    expect(updated).toMatch(/^<!-- CLAUDE_ITERATION/);
    expect(updated).toContain("## Description");
    expect(updated).toContain("Content");
  });

  it("replaces existing state", () => {
    const body = `<!-- CLAUDE_ITERATION
iteration: 1
branch: claude/issue/1
pr_number:
last_ci_run:
last_ci_result:
consecutive_failures: 0
failure_type:
last_failure_timestamp:
complete: false
-->

## Description

Content`;

    const state: IterationState = {
      iteration: 2,
      branch: "claude/issue/1",
      pr_number: "50",
      last_ci_run: "123",
      last_ci_result: "pending",
      consecutive_failures: 0,
      failure_type: "",
      last_failure_timestamp: "",
      complete: false,
    };

    const updated = updateBodyWithState(body, state);
    expect(updated).toContain("iteration: 2");
    expect(updated).toContain("pr_number: 50");
    expect(updated).toContain("## Description");
    // Should only have one state block
    const matches = updated.match(/<!-- CLAUDE_ITERATION/g);
    expect(matches).toHaveLength(1);
  });

  it("roundtrips correctly", () => {
    const state: IterationState = {
      iteration: 5,
      branch: "claude/issue/99",
      pr_number: "200",
      last_ci_run: "555",
      last_ci_result: "failure",
      consecutive_failures: 2,
      failure_type: "ci",
      last_failure_timestamp: "2024-01-15T10:30:00Z",
      complete: false,
    };

    const body = "Some content";
    const updated = updateBodyWithState(body, state);
    const parsed = parseState(updated);

    expect(parsed).toEqual(state);
  });
});

// Test state transition logic (without API calls)
describe("state transitions", () => {
  // Helper to simulate state transitions
  function resetState(state: IterationState): IterationState {
    return {
      ...state,
      consecutive_failures: 0,
      failure_type: "",
      last_failure_timestamp: "",
      last_ci_result: "",
      complete: false,
    };
  }

  function recordFailure(
    state: IterationState,
    failureType: "ci" | "workflow",
  ): IterationState {
    return {
      ...state,
      consecutive_failures: state.consecutive_failures + 1,
      failure_type: failureType,
      last_failure_timestamp: new Date().toISOString(),
    };
  }

  function markComplete(state: IterationState): IterationState {
    return {
      ...state,
      complete: true,
      consecutive_failures: 0,
      failure_type: "",
      last_failure_timestamp: "",
    };
  }

  function incrementIteration(state: IterationState): IterationState {
    return {
      ...state,
      iteration: state.iteration + 1,
    };
  }

  describe("reset", () => {
    it("clears failure state", () => {
      const state: IterationState = {
        iteration: 5,
        branch: "claude/issue/42",
        pr_number: "100",
        last_ci_run: "999",
        last_ci_result: "failure",
        consecutive_failures: 3,
        failure_type: "ci",
        last_failure_timestamp: "2024-01-15T10:30:00Z",
        complete: false,
      };

      const reset = resetState(state);
      expect(reset.consecutive_failures).toBe(0);
      expect(reset.failure_type).toBe("");
      expect(reset.last_failure_timestamp).toBe("");
      expect(reset.last_ci_result).toBe("");
      expect(reset.complete).toBe(false);
    });

    it("preserves iteration count and PR info", () => {
      const state: IterationState = {
        iteration: 5,
        branch: "claude/issue/42",
        pr_number: "100",
        last_ci_run: "999",
        last_ci_result: "failure",
        consecutive_failures: 3,
        failure_type: "ci",
        last_failure_timestamp: "2024-01-15T10:30:00Z",
        complete: false,
      };

      const reset = resetState(state);
      expect(reset.iteration).toBe(5);
      expect(reset.branch).toBe("claude/issue/42");
      expect(reset.pr_number).toBe("100");
      expect(reset.last_ci_run).toBe("999");
    });

    it("clears complete flag to allow restart", () => {
      const state: IterationState = {
        iteration: 10,
        branch: "claude/issue/42",
        pr_number: "100",
        last_ci_run: "999",
        last_ci_result: "success",
        consecutive_failures: 0,
        failure_type: "",
        last_failure_timestamp: "",
        complete: true,
      };

      const reset = resetState(state);
      expect(reset.complete).toBe(false);
    });
  });

  describe("recordFailure", () => {
    it("increments failure count", () => {
      const state: IterationState = {
        iteration: 3,
        branch: "claude/issue/1",
        pr_number: "10",
        last_ci_run: "100",
        last_ci_result: "failure",
        consecutive_failures: 1,
        failure_type: "ci",
        last_failure_timestamp: "",
        complete: false,
      };

      const failed = recordFailure(state, "ci");
      expect(failed.consecutive_failures).toBe(2);
      expect(failed.failure_type).toBe("ci");
      expect(failed.last_failure_timestamp).not.toBe("");
    });

    it("tracks workflow failures separately", () => {
      const state: IterationState = {
        iteration: 3,
        branch: "claude/issue/1",
        pr_number: "10",
        last_ci_run: "100",
        last_ci_result: "pending",
        consecutive_failures: 0,
        failure_type: "",
        last_failure_timestamp: "",
        complete: false,
      };

      const failed = recordFailure(state, "workflow");
      expect(failed.consecutive_failures).toBe(1);
      expect(failed.failure_type).toBe("workflow");
    });
  });

  describe("markComplete", () => {
    it("sets complete flag and clears failures", () => {
      const state: IterationState = {
        iteration: 5,
        branch: "claude/issue/1",
        pr_number: "10",
        last_ci_run: "100",
        last_ci_result: "success",
        consecutive_failures: 2,
        failure_type: "ci",
        last_failure_timestamp: "2024-01-15T10:30:00Z",
        complete: false,
      };

      const completed = markComplete(state);
      expect(completed.complete).toBe(true);
      expect(completed.consecutive_failures).toBe(0);
      expect(completed.failure_type).toBe("");
      expect(completed.last_failure_timestamp).toBe("");
    });
  });

  describe("incrementIteration", () => {
    it("increments iteration counter", () => {
      const state: IterationState = {
        iteration: 3,
        branch: "claude/issue/1",
        pr_number: "10",
        last_ci_run: "100",
        last_ci_result: "",
        consecutive_failures: 0,
        failure_type: "",
        last_failure_timestamp: "",
        complete: false,
      };

      const incremented = incrementIteration(state);
      expect(incremented.iteration).toBe(4);
    });
  });
});

// Test breakpoint detection logic
describe("breakpoint detection", () => {
  interface BreakpointResult {
    shouldStop: boolean;
    isCISuccess: boolean;
    isBreakpoint: boolean;
    reason: string;
  }

  function checkBreakpoints(
    iteration: number,
    ciResult: string,
    consecutiveFailures: number,
    maxIterations = 10,
    maxFailures = 5,
  ): BreakpointResult {
    if (iteration >= maxIterations) {
      return {
        shouldStop: true,
        isCISuccess: false,
        isBreakpoint: true,
        reason: `Max iterations (${maxIterations}) reached`,
      };
    }

    if (consecutiveFailures >= maxFailures) {
      return {
        shouldStop: true,
        isCISuccess: false,
        isBreakpoint: true,
        reason: `Circuit breaker: ${consecutiveFailures} consecutive failures`,
      };
    }

    if (ciResult === "success") {
      return {
        shouldStop: true,
        isCISuccess: true,
        isBreakpoint: false,
        reason: "CI passed - ready for review",
      };
    }

    return {
      shouldStop: false,
      isCISuccess: false,
      isBreakpoint: false,
      reason: "",
    };
  }

  it("detects CI success as a stop condition (not breakpoint)", () => {
    const result = checkBreakpoints(3, "success", 0);
    expect(result.shouldStop).toBe(true);
    expect(result.isCISuccess).toBe(true);
    expect(result.isBreakpoint).toBe(false);
  });

  it("detects max iterations as breakpoint", () => {
    const result = checkBreakpoints(10, "failure", 1);
    expect(result.shouldStop).toBe(true);
    expect(result.isBreakpoint).toBe(true);
    expect(result.reason).toContain("Max iterations");
  });

  it("detects circuit breaker as breakpoint", () => {
    const result = checkBreakpoints(3, "failure", 5);
    expect(result.shouldStop).toBe(true);
    expect(result.isBreakpoint).toBe(true);
    expect(result.reason).toContain("Circuit breaker");
  });

  it("allows continuation when no breakpoint", () => {
    const result = checkBreakpoints(3, "failure", 2);
    expect(result.shouldStop).toBe(false);
    expect(result.isBreakpoint).toBe(false);
  });

  it("respects custom max iterations", () => {
    const result = checkBreakpoints(5, "failure", 1, 5);
    expect(result.isBreakpoint).toBe(true);
    expect(result.reason).toContain("Max iterations (5)");
  });

  it("respects custom max failures", () => {
    const result = checkBreakpoints(3, "failure", 3, 10, 3);
    expect(result.isBreakpoint).toBe(true);
    expect(result.reason).toContain("3 consecutive failures");
  });
});

// Test iteration history log entry formatting
describe("addIterationLogEntry", () => {
  function addIterationLogEntry(
    body: string,
    iteration: number,
    message: string,
    sha?: string,
    runLink?: string,
  ): string {
    const serverUrl = "https://github.com";
    const repo = "test-owner/test-repo";

    // Format SHA as a full GitHub link if provided
    const shaCell = sha
      ? `[\`${sha.slice(0, 7)}\`](${serverUrl}/${repo}/commit/${sha})`
      : "-";
    // Format run link if provided
    const runCell = runLink ? `[Run](${runLink})` : "-";

    const historyIdx = body.indexOf(HISTORY_SECTION);

    if (historyIdx === -1) {
      // Add history section before the end
      const entry = `| ${iteration} | ${message} | ${shaCell} | ${runCell} |`;
      const historyTable = `

${HISTORY_SECTION}

| # | Action | SHA | Run |
|---|--------|-----|-----|
${entry}`;

      return body + historyTable;
    }

    // Find the table and add a row
    const lines = body.split("\n");
    const historyLineIdx = lines.findIndex((l) => l.includes(HISTORY_SECTION));

    if (historyLineIdx === -1) {
      return body;
    }

    // Find last table row after history section
    let insertIdx = historyLineIdx + 1;
    for (let i = historyLineIdx + 1; i < lines.length; i++) {
      if (lines[i].startsWith("|")) {
        insertIdx = i + 1;
      } else if (lines[i].trim() !== "" && !lines[i].startsWith("|")) {
        break;
      }
    }

    const entry = `| ${iteration} | ${message} | ${shaCell} | ${runCell} |`;
    lines.splice(insertIdx, 0, entry);

    return lines.join("\n");
  }

  it("creates iteration history table when none exists", () => {
    const body = "## Description\n\nSome content";
    const result = addIterationLogEntry(body, 1, "Initial implementation");

    expect(result).toContain(HISTORY_SECTION);
    expect(result).toContain("| # | Action | SHA | Run |");
    expect(result).toContain("| 1 | Initial implementation | - | - |");
  });

  it("appends to existing history table", () => {
    const body = `## Description

${HISTORY_SECTION}

| # | Action | SHA | Run |
|---|--------|-----|-----|
| 1 | Initial implementation | - | - |`;

    const result = addIterationLogEntry(body, 2, "Fixed type errors");
    expect(result).toContain("| 1 | Initial implementation | - | - |");
    expect(result).toContain("| 2 | Fixed type errors | - | - |");
  });

  it("formats commit SHA as full GitHub link", () => {
    const body = "## Description";
    const sha = "abc1234567890";
    const result = addIterationLogEntry(body, 1, "Test commit", sha);

    // Should contain shortened SHA as link text
    expect(result).toContain("[`abc1234`]");
    // Should contain full commit URL
    expect(result).toContain("/commit/abc1234567890");
  });

  it("includes run link when provided", () => {
    const body = "## Description";
    const result = addIterationLogEntry(
      body,
      1,
      "Test with run",
      undefined,
      "https://github.com/owner/repo/actions/runs/123",
    );

    expect(result).toContain(
      "[Run](https://github.com/owner/repo/actions/runs/123)",
    );
  });

  it("handles failure emoji prefix correctly", () => {
    const body = "## Description";
    const result = addIterationLogEntry(body, 1, "❌ ci failure: Build failed");

    expect(result).toContain("| 1 | ❌ ci failure: Build failed |");
  });

  it("handles success emoji prefix correctly", () => {
    const body = "## Description";
    const result = addIterationLogEntry(body, 1, "✅ Complete");

    expect(result).toContain("| 1 | ✅ Complete |");
  });

  it("handles circuit breaker emoji prefix correctly", () => {
    const body = "## Description";
    const result = addIterationLogEntry(
      body,
      5,
      "🛑 Circuit breaker triggered",
    );

    expect(result).toContain("| 5 | 🛑 Circuit breaker triggered |");
  });

  it("handles reset emoji prefix correctly", () => {
    const body = "## Description";
    const result = addIterationLogEntry(body, 3, "🔄 Manual reset by human");

    expect(result).toContain("| 3 | 🔄 Manual reset by human |");
  });

  it("handles review events correctly", () => {
    const body = "## Description";
    const result = addIterationLogEntry(body, 2, "👀 Review requested");

    expect(result).toContain("| 2 | 👀 Review requested |");
  });

  it("handles release event messages with emojis", () => {
    const body = "## Description\n\nContent";

    // Test various release event messages
    const events = [
      { msg: "🚀 Added to merge queue", iteration: 1 },
      { msg: "🎉 Merged to main", iteration: 1 },
      { msg: "🚢 Released to production", iteration: 1 },
      { msg: "❌ Removed from queue: Build failed", iteration: 1 },
    ];

    for (const event of events) {
      const result = addIterationLogEntry(body, event.iteration, event.msg);
      expect(result).toContain(`| ${event.iteration} | ${event.msg} |`);
    }
  });

  it("preserves existing content when adding history", () => {
    const body = `## Description

This is important content.

## Todo

- [ ] Item 1
- [ ] Item 2`;

    const result = addIterationLogEntry(body, 1, "Started work");

    expect(result).toContain("This is important content.");
    expect(result).toContain("## Todo");
    expect(result).toContain("- [ ] Item 1");
  });

  it("handles multiple entries in sequence", () => {
    let body = "## Description\n\nContent";

    // Simulate a full release flow
    body = addIterationLogEntry(body, 1, "✅ CI success");
    body = addIterationLogEntry(body, 1, "👁️ Review requested");
    body = addIterationLogEntry(body, 1, "📝 Review: approve");
    body = addIterationLogEntry(body, 1, "🚀 Added to merge queue");
    body = addIterationLogEntry(body, 1, "🎉 Merged to main");
    body = addIterationLogEntry(body, 1, "🚢 Released to production");

    // All entries should be present in order
    const lines = body.split("\n");
    const historyStart = lines.findIndex((l) => l.includes(HISTORY_SECTION));
    const tableLines = lines
      .slice(historyStart)
      .filter(
        (l) =>
          l.startsWith("| ") && !l.startsWith("| #") && !l.startsWith("|--"),
      );

    expect(tableLines).toHaveLength(6);
    expect(tableLines[0]).toContain("CI success");
    expect(tableLines[1]).toContain("Review requested");
    expect(tableLines[2]).toContain("Review: approve");
    expect(tableLines[3]).toContain("merge queue");
    expect(tableLines[4]).toContain("Merged to main");
    expect(tableLines[5]).toContain("Released to production");
  });

  it("handles SHA and run link together", () => {
    const body = "## Description\n\nContent";
    const sha = "fedcba9876543210";
    const runLink = "https://github.com/owner/repo/actions/runs/999";

    const result = addIterationLogEntry(
      body,
      1,
      "🎉 Merged to main",
      sha,
      runLink,
    );

    expect(result).toContain(
      "[`fedcba9`](https://github.com/test-owner/test-repo/commit/fedcba9876543210)",
    );
    expect(result).toContain(
      "[Run](https://github.com/owner/repo/actions/runs/999)",
    );
  });
});
