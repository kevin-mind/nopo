import { describe, it, expect } from "vitest";

// We can only test pure functions without mocking - test the parsing logic
const STATE_MARKER_START = "<!-- CLAUDE_ITERATION";
const STATE_MARKER_END = "-->";

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
