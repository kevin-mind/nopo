import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import {
  HISTORY_SECTION,
  parseHistoryRow,
  parseHistory,
  getLatestHistoryEntry,
  formatHistoryCells,
  createHistoryRow,
  createHistoryTable,
  addHistoryEntry,
  updateHistoryEntry,
  findHistoryEntries,
  getPhaseHistory,
  hasHistoryEntry,
} from "../../parser/history-parser.js";

describe("HISTORY_SECTION constant", () => {
  test("has expected value", () => {
    expect(HISTORY_SECTION).toBe("## Iteration History");
  });
});

describe("parseHistoryRow", () => {
  test("parses a basic row (old format)", () => {
    const row = "| 1 | Phase 1 | Initial implementation | abc123 | - |";
    const result = parseHistoryRow(row);
    expect(result).toEqual({
      iteration: 1,
      phase: "Phase 1",
      action: "Initial implementation",
      timestamp: null,
      sha: "abc123",
      runLink: null,
    });
  });

  test("parses row with new format (timestamp first column)", () => {
    // New format: | Time | # | Phase | Action | SHA | Run |
    const row =
      "| Jan 22 19:04 | 1 | Phase 1 | Initial implementation | abc123 | - |";
    const result = parseHistoryRow(row);
    expect(result).toEqual({
      iteration: 1,
      phase: "Phase 1",
      action: "Initial implementation",
      timestamp: "Jan 22 19:04",
      sha: "abc123",
      runLink: null,
    });
  });

  test("parses row with markdown link for SHA", () => {
    const row =
      "| 2 | Phase 1 | Pushed code | [`abc1234`](https://github.com/o/r/commit/abc1234) | - |";
    const result = parseHistoryRow(row);
    expect(result?.sha).toBe("abc1234");
  });

  test("parses row with run link", () => {
    const row =
      "| 3 | Phase 2 | CI passed | - | [Run](https://github.com/runs/123) |";
    const result = parseHistoryRow(row);
    expect(result?.runLink).toBe("https://github.com/runs/123");
  });

  test("handles dash for missing values", () => {
    const row = "| 1 | Init | Started | - | - |";
    const result = parseHistoryRow(row);
    expect(result?.timestamp).toBeNull();
    expect(result?.sha).toBeNull();
    expect(result?.runLink).toBeNull();
  });

  test("returns null for header row", () => {
    const row = "| # | Phase | Action | SHA | Run |";
    expect(parseHistoryRow(row)).toBeNull();
  });

  test("returns null for separator row", () => {
    const row = "|---|-------|--------|-----|-----|";
    expect(parseHistoryRow(row)).toBeNull();
  });

  test("returns null for malformed rows", () => {
    expect(parseHistoryRow("Not a table row")).toBeNull();
    expect(parseHistoryRow("| too | few |")).toBeNull();
  });

  test("returns null for invalid iteration number", () => {
    const row = "| abc | Phase 1 | Action | - | - |";
    expect(parseHistoryRow(row)).toBeNull();
  });
});

describe("parseHistory", () => {
  test("parses multiple history entries", () => {
    const body = `
## Iteration History

| # | Phase | Action | SHA | Run |
|---|-------|--------|-----|-----|
| 1 | Phase 1 | Started | - | - |
| 2 | Phase 1 | Pushed | abc123 | - |
| 3 | Phase 1 | CI passed | - | [Run](https://example.com) |
`;
    const entries = parseHistory(body);
    expect(entries).toHaveLength(3);
    expect(entries[0]?.iteration).toBe(1);
    expect(entries[1]?.sha).toBe("abc123");
    expect(entries[2]?.runLink).toBe("https://example.com");
  });

  test("returns empty array if no history section", () => {
    const body = "## Other Section\n\nSome content";
    expect(parseHistory(body)).toHaveLength(0);
  });

  test("stops parsing at next section", () => {
    const body = `
## Iteration History

| # | Phase | Action | SHA | Run |
|---|-------|--------|-----|-----|
| 1 | Phase 1 | Only entry | - | - |

## Next Section

| 2 | Phase 2 | Should not include | - | - |
`;
    const entries = parseHistory(body);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.action).toBe("Only entry");
  });

  test("handles empty history table", () => {
    const body = `
## Iteration History

| # | Phase | Action | SHA | Run |
|---|-------|--------|-----|-----|
`;
    expect(parseHistory(body)).toHaveLength(0);
  });
});

describe("getLatestHistoryEntry", () => {
  test("returns last entry", () => {
    const body = `
## Iteration History

| # | Phase | Action | SHA | Run |
|---|-------|--------|-----|-----|
| 1 | Phase 1 | First | - | - |
| 2 | Phase 1 | Second | - | - |
| 3 | Phase 2 | Third | - | - |
`;
    const latest = getLatestHistoryEntry(body);
    expect(latest?.iteration).toBe(3);
    expect(latest?.phase).toBe("Phase 2");
    expect(latest?.action).toBe("Third");
  });

  test("returns null for empty history", () => {
    expect(getLatestHistoryEntry("No history here")).toBeNull();
  });
});

describe("formatHistoryCells", () => {
  beforeEach(() => {
    vi.stubEnv("GITHUB_SERVER_URL", "https://github.com");
    vi.stubEnv("GITHUB_REPOSITORY", "owner/repo");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("formats SHA as link", () => {
    const { shaCell } = formatHistoryCells("abc1234567890");
    expect(shaCell).toContain("[`abc1234`]");
    expect(shaCell).toContain("/commit/abc1234567890");
  });

  test("formats run link", () => {
    const { runCell } = formatHistoryCells(
      undefined,
      "https://example.com/run",
    );
    expect(runCell).toBe("[Run](https://example.com/run)");
  });

  test("returns dash for missing values", () => {
    const { shaCell, runCell } = formatHistoryCells();
    expect(shaCell).toBe("-");
    expect(runCell).toBe("-");
  });

  test("uses provided repo URL", () => {
    const { shaCell } = formatHistoryCells(
      "abc123",
      undefined,
      "https://custom.com",
    );
    expect(shaCell).toContain("https://custom.com");
  });
});

describe("createHistoryRow", () => {
  test("creates formatted row", () => {
    const row = createHistoryRow(
      5,
      "Phase 2",
      "Completed work",
      undefined,
      undefined,
      "https://test.com",
    );
    expect(row).toContain("| 5 |");
    expect(row).toContain("| Phase 2 |");
    expect(row).toContain("| Completed work |");
  });

  test("handles numeric phase", () => {
    const row = createHistoryRow(1, 2, "Action");
    expect(row).toContain("| 2 |");
  });
});

describe("createHistoryTable", () => {
  test("creates full table with header", () => {
    const entries = [
      {
        iteration: 1,
        phase: "1",
        action: "Started",
        timestamp: null,
        sha: null,
        runLink: null,
      },
      {
        iteration: 2,
        phase: "1",
        action: "Done",
        timestamp: "Jan 22 19:04",
        sha: "abc123",
        runLink: null,
      },
    ];
    const table = createHistoryTable(entries);
    expect(table).toContain("## Iteration History");
    // New format: Time is first column
    expect(table).toContain("| Time | # | Phase | Action | SHA | Run |");
    expect(table).toContain("| - | 1 | 1 | Started |");
    expect(table).toContain("| Jan 22 19:04 | 2 | 1 | Done |");
  });
});

describe("addHistoryEntry", () => {
  test("adds entry to existing history", () => {
    const body = `
## Iteration History

| # | Phase | Action | Time | SHA | Run |
|---|-------|--------|------|-----|-----|
| 1 | Phase 1 | First | - | - | - |
`;
    const result = addHistoryEntry(body, 2, "Phase 1", "Second");
    expect(result).toContain("| 1 | Phase 1 | First |");
    expect(result).toContain("| 2 | Phase 1 | Second |");
  });

  test("creates history section if missing", () => {
    const body = "## Description\n\nSome text";
    const result = addHistoryEntry(body, 1, "Init", "Started");
    expect(result).toContain("## Iteration History");
    // New format: Time is first column
    expect(result).toContain("| Time | # | Phase | Action | SHA | Run |");
    expect(result).toContain("| - | 1 | Init | Started |");
  });

  test("includes SHA when provided", () => {
    const body =
      "## Iteration History\n\n| # | Phase | Action | Time | SHA | Run |\n|---|-------|--------|------|-----|-----|";
    // addHistoryEntry(body, iteration, phase, message, timestamp, sha, runLink, repoUrl)
    const result = addHistoryEntry(
      body,
      1,
      "1",
      "Pushed",
      undefined,
      "abc123def",
    );
    expect(result).toContain("[`abc123d`]");
  });

  test("includes run link with run_id as link text when URL contains run_id", () => {
    const body =
      "## Iteration History\n\n| # | Phase | Action | Time | SHA | Run |\n|---|-------|--------|------|-----|-----|";
    // addHistoryEntry(body, iteration, phase, message, timestamp, sha, runLink, repoUrl)
    const result = addHistoryEntry(
      body,
      1,
      "1",
      "CI done",
      undefined,
      undefined,
      "https://github.com/owner/repo/actions/runs/12345678901",
    );
    expect(result).toContain(
      "[12345678901](https://github.com/owner/repo/actions/runs/12345678901)",
    );
  });

  test("falls back to [Run] format when URL does not contain run_id", () => {
    const body =
      "## Iteration History\n\n| # | Phase | Action | Time | SHA | Run |\n|---|-------|--------|------|-----|-----|";
    // addHistoryEntry(body, iteration, phase, message, timestamp, sha, runLink, repoUrl)
    const result = addHistoryEntry(
      body,
      1,
      "1",
      "CI done",
      undefined,
      undefined,
      "https://some-other-url.com/run",
    );
    expect(result).toContain("[Run](https://some-other-url.com/run)");
  });

  test("deduplicates entries with same run_id by appending action with arrow separator", () => {
    const runUrl = "https://github.com/owner/repo/actions/runs/12345678901";
    const body = `
## Iteration History

| Time | # | Phase | Action | SHA | Run |
|---|---|---|---|---|---|
| Jan 22 19:04 | 1 | Phase 1 | ⏳ running... | - | [12345678901](${runUrl}) |
`;
    const result = addHistoryEntry(
      body,
      1,
      "Phase 1",
      "✅ Done",
      "2026-01-22T19:10:00Z",
      undefined,
      runUrl,
    );

    // Should have one row with combined actions
    expect(result).toContain("⏳ running... → ✅ Done");
    // Should only have one run ID reference (deduplicated)
    const lines = result
      .split("\n")
      .filter(
        (l) => l.startsWith("|") && !l.includes("---") && !l.includes("Time"),
      );
    expect(lines.length).toBe(1);
    // Should update timestamp to latest
    expect(result).toContain("Jan 22 19:10");
  });

  test("creates new row when run_id is different", () => {
    const runUrl1 = "https://github.com/owner/repo/actions/runs/12345678901";
    const runUrl2 = "https://github.com/owner/repo/actions/runs/99999999999";
    const body = `
## Iteration History

| Time | # | Phase | Action | SHA | Run |
|---|---|---|---|---|---|
| Jan 22 19:04 | 1 | Phase 1 | ⏳ running... | - | [12345678901](${runUrl1}) |
`;
    const result = addHistoryEntry(
      body,
      1,
      "Phase 1",
      "New run",
      undefined,
      undefined,
      runUrl2,
    );

    // Should have two separate rows
    expect(result).toContain("[12345678901]");
    expect(result).toContain("[99999999999]");
    expect(result).not.toContain("→");
  });

  test("creates new row when no runLink provided", () => {
    const body = `
## Iteration History

| Time | # | Phase | Action | SHA | Run |
|---|---|---|---|---|---|
| Jan 22 19:04 | 1 | Phase 1 | First | - | - |
`;
    const result = addHistoryEntry(body, 1, "Phase 1", "Second");

    // Should have two separate rows (no deduplication without run_id)
    expect(result).toContain("| First |");
    expect(result).toContain("| Second |");
    expect(result).not.toContain("→");
  });

  test("includes timestamp when provided", () => {
    const body =
      "## Iteration History\n\n| # | Phase | Action | Time | SHA | Run |\n|---|-------|--------|------|-----|-----|";
    const result = addHistoryEntry(
      body,
      1,
      "1",
      "Started",
      "2026-01-22T19:04:52Z",
    );
    expect(result).toContain("| Jan 22 19:04 |");
  });
});

describe("updateHistoryEntry", () => {
  test("updates matching entry", () => {
    const body = `
## Iteration History

| # | Phase | Action | Time | SHA | Run |
|---|-------|--------|------|-----|-----|
| 1 | Phase 1 | In progress | - | - | - |
`;
    const { body: newBody, updated } = updateHistoryEntry(
      body,
      1,
      "Phase 1",
      "In progress",
      "Completed",
    );
    expect(updated).toBe(true);
    expect(newBody).toContain("| 1 | Phase 1 | Completed |");
    expect(newBody).not.toContain("In progress");
  });

  test("updates with SHA and run link", () => {
    const body = `
## Iteration History

| # | Phase | Action | Time | SHA | Run |
|---|-------|--------|------|-----|-----|
| 2 | 1 | In progress | - | - | - |
`;
    // updateHistoryEntry(body, iteration, phase, pattern, newMessage, timestamp, sha, runLink, repoUrl)
    const { body: newBody, updated } = updateHistoryEntry(
      body,
      2,
      "1",
      "In progress",
      "Done",
      undefined,
      "abc123",
      "https://run.url",
    );
    expect(updated).toBe(true);
    expect(newBody).toContain("Done");
    expect(newBody).toContain("abc123");
    expect(newBody).toContain("run.url");
  });

  test("returns unchanged body if no match", () => {
    const body = `
## Iteration History

| # | Phase | Action | Time | SHA | Run |
|---|-------|--------|------|-----|-----|
| 1 | Phase 1 | Action | - | - | - |
`;
    const { body: newBody, updated } = updateHistoryEntry(
      body,
      99,
      "Phase 99",
      "Not found",
      "New message",
    );
    expect(updated).toBe(false);
    expect(newBody).toBe(body);
  });

  test("preserves existing SHA if not provided", () => {
    const body = `
## Iteration History

| # | Phase | Action | Time | SHA | Run |
|---|-------|--------|------|-----|-----|
| 1 | 1 | In progress | - | [\`abc1234\`](url) | - |
`;
    const { body: newBody, updated } = updateHistoryEntry(
      body,
      1,
      "1",
      "In progress",
      "Updated",
    );
    expect(updated).toBe(true);
    expect(newBody).toContain("abc1234");
  });

  test("updates most recent matching entry", () => {
    const body = `
## Iteration History

| # | Phase | Action | Time | SHA | Run |
|---|-------|--------|------|-----|-----|
| 1 | 1 | In progress | - | - | - |
| 2 | 1 | In progress | - | - | - |
`;
    const { body: newBody, updated } = updateHistoryEntry(
      body,
      2,
      "1",
      "In progress",
      "Updated",
    );
    expect(updated).toBe(true);
    // First row should be unchanged
    const lines = newBody.split("\n");
    const row1 = lines.find((l) => l.includes("| 1 | 1 |"));
    const row2 = lines.find((l) => l.includes("| 2 | 1 |"));
    expect(row1).toContain("In progress");
    expect(row2).toContain("Updated");
  });

  test("preserves existing timestamp if not provided", () => {
    const body = `
## Iteration History

| # | Phase | Action | Time | SHA | Run |
|---|-------|--------|------|-----|-----|
| 1 | 1 | In progress | Jan 22 19:04 | - | - |
`;
    const { body: newBody, updated } = updateHistoryEntry(
      body,
      1,
      "1",
      "In progress",
      "Updated",
    );
    expect(updated).toBe(true);
    expect(newBody).toContain("Jan 22 19:04");
  });
});

describe("findHistoryEntries", () => {
  test("finds entries matching pattern", () => {
    const body = `
## Iteration History

| # | Phase | Action | SHA | Run |
|---|-------|--------|-----|-----|
| 1 | 1 | CI failed | - | - |
| 2 | 1 | CI passed | - | - |
| 3 | 2 | CI failed | - | - |
`;
    const entries = findHistoryEntries(body, "CI failed");
    expect(entries).toHaveLength(2);
    expect(entries[0]?.iteration).toBe(1);
    expect(entries[1]?.iteration).toBe(3);
  });

  test("returns empty array for no matches", () => {
    const body = `
## Iteration History

| # | Phase | Action | SHA | Run |
|---|-------|--------|-----|-----|
| 1 | 1 | Something | - | - |
`;
    expect(findHistoryEntries(body, "No match")).toHaveLength(0);
  });
});

describe("getPhaseHistory", () => {
  test("returns entries for specific phase", () => {
    const body = `
## Iteration History

| # | Phase | Action | SHA | Run |
|---|-------|--------|-----|-----|
| 1 | 1 | Action 1 | - | - |
| 2 | 2 | Action 2 | - | - |
| 3 | 1 | Action 3 | - | - |
`;
    const phase1 = getPhaseHistory(body, "1");
    expect(phase1).toHaveLength(2);
    expect(phase1[0]?.iteration).toBe(1);
    expect(phase1[1]?.iteration).toBe(3);
  });

  test("handles numeric phase parameter", () => {
    const body = `
## Iteration History

| # | Phase | Action | SHA | Run |
|---|-------|--------|-----|-----|
| 1 | 2 | Test | - | - |
`;
    const phase2 = getPhaseHistory(body, 2);
    expect(phase2).toHaveLength(1);
  });
});

describe("hasHistoryEntry", () => {
  test("returns true when pattern exists", () => {
    const body = `
## Iteration History

| # | Phase | Action | SHA | Run |
|---|-------|--------|-----|-----|
| 1 | 1 | Initialization complete | - | - |
`;
    expect(hasHistoryEntry(body, "Initialization")).toBe(true);
  });

  test("returns false when pattern not found", () => {
    const body = `
## Iteration History

| # | Phase | Action | SHA | Run |
|---|-------|--------|-----|-----|
| 1 | 1 | Something else | - | - |
`;
    expect(hasHistoryEntry(body, "Not present")).toBe(false);
  });

  test("returns false for empty history", () => {
    expect(hasHistoryEntry("No history section", "Pattern")).toBe(false);
  });
});

// ============================================================================
// Schema Migration Tests
// ============================================================================

describe("schema migration", () => {
  describe("column addition (old table missing Time column)", () => {
    const oldFormatTable = `## Description

Some description text.

## Iteration History

| # | Phase | Action | SHA | Run |
|---|-------|--------|-----|-----|
| 1 | 1 | Started task | - | - |
| 2 | 1 | Pushed code | abc123 | [Run](https://example.com/run/1) |
`;

    test("addHistoryEntry migrates old format to new format with Time column", () => {
      const result = addHistoryEntry(oldFormatTable, 3, "1", "CI passed");

      // Should have new header format with Time first
      expect(result).toContain("| Time | # | Phase | Action | SHA | Run |");

      // Old rows should be migrated with "-" for missing Time column
      expect(result).toContain("| - | 1 | 1 | Started task |");
      expect(result).toContain("| - | 2 | 1 | Pushed code |");

      // New row should also have "-" for Time (no timestamp provided)
      expect(result).toContain("| - | 3 | 1 | CI passed |");

      // SHA and Run links should be preserved
      expect(result).toContain("abc123");
      expect(result).toContain("[Run](https://example.com/run/1)");
    });

    test("updateHistoryEntry migrates old format to new format with Time column", () => {
      const { body: result, updated } = updateHistoryEntry(
        oldFormatTable,
        2,
        "1",
        "Pushed code",
        "Code reviewed",
      );

      expect(updated).toBe(true);

      // Should have new header format with Time first
      expect(result).toContain("| Time | # | Phase | Action | SHA | Run |");

      // Old rows should be migrated with "-" for missing Time column
      expect(result).toContain("| - | 1 | 1 | Started task |");

      // Updated row should have new message
      expect(result).toContain("| - | 2 | 1 | Code reviewed |");

      // Should NOT contain old message
      expect(result).not.toContain("Pushed code");
    });
  });

  describe("column removal (table has unknown extra column)", () => {
    const tableWithExtraColumn = `## Iteration History

| Time | # | Phase | Action | Priority | SHA | Run |
|------|---|-------|--------|----------|-----|-----|
| Jan 1 10:00 | 1 | 1 | Started | High | - | - |
| Jan 1 11:00 | 2 | 1 | Completed | Medium | def456 | [Run](https://example.com) |
`;

    test("addHistoryEntry drops unknown 'Priority' column", () => {
      const result = addHistoryEntry(
        tableWithExtraColumn,
        3,
        "2",
        "New phase",
        "2026-01-22T12:00:00Z",
      );

      // Should have schema-defined header (no Priority column)
      expect(result).toContain("| Time | # | Phase | Action | SHA | Run |");
      expect(result).not.toContain("Priority");
      expect(result).not.toContain("High");
      expect(result).not.toContain("Medium");

      // Existing data should be preserved (except dropped column)
      expect(result).toContain("| Jan 1 10:00 | 1 | 1 | Started |");
      expect(result).toContain("| Jan 1 11:00 | 2 | 1 | Completed |");
      expect(result).toContain("def456");
      expect(result).toContain("[Run](https://example.com)");

      // New entry should be added
      expect(result).toContain("| Jan 22 12:00 | 3 | 2 | New phase |");
    });

    test("updateHistoryEntry drops unknown column during migration", () => {
      const { body: result, updated } = updateHistoryEntry(
        tableWithExtraColumn,
        1,
        "1",
        "Started",
        "Updated message",
      );

      expect(updated).toBe(true);

      // Should have schema-defined header (no Priority column)
      expect(result).toContain("| Time | # | Phase | Action | SHA | Run |");
      expect(result).not.toContain("Priority");

      // Updated row should have new message
      expect(result).toContain("| Jan 1 10:00 | 1 | 1 | Updated message |");
    });
  });

  describe("column reordering (table has columns in wrong order)", () => {
    const reorderedTable = `## Iteration History

| Action | Phase | # | Run | SHA | Time |
|--------|-------|---|-----|-----|------|
| Task one | 1 | 1 | - | - | Jan 5 09:00 |
| Task two | 1 | 2 | [Run](https://run.url) | xyz789 | Jan 5 10:00 |
`;

    test("addHistoryEntry reorders columns to match schema", () => {
      const result = addHistoryEntry(reorderedTable, 3, "2", "Task three");

      // Should have schema-defined column order: Time, #, Phase, Action, SHA, Run
      expect(result).toContain("| Time | # | Phase | Action | SHA | Run |");

      // Existing data should be reordered correctly
      // Row 1: Time=Jan 5 09:00, #=1, Phase=1, Action=Task one, SHA=-, Run=-
      expect(result).toContain("| Jan 5 09:00 | 1 | 1 | Task one | - | - |");

      // Row 2: Time=Jan 5 10:00, #=2, Phase=1, Action=Task two, SHA=xyz789, Run=[Run](...)
      expect(result).toContain("| Jan 5 10:00 | 2 | 1 | Task two |");
      expect(result).toContain("xyz789");
      expect(result).toContain("[Run](https://run.url)");

      // New row should be in correct order
      expect(result).toContain("| - | 3 | 2 | Task three |");
    });

    test("updateHistoryEntry reorders columns to match schema", () => {
      const { body: result, updated } = updateHistoryEntry(
        reorderedTable,
        2,
        "1",
        "Task two",
        "Updated task two",
      );

      expect(updated).toBe(true);

      // Should have schema-defined column order
      expect(result).toContain("| Time | # | Phase | Action | SHA | Run |");

      // First row should be reordered correctly
      expect(result).toContain("| Jan 5 09:00 | 1 | 1 | Task one | - | - |");

      // Updated row should have new message in correct column order
      expect(result).toContain("| Jan 5 10:00 | 2 | 1 | Updated task two |");
      expect(result).toContain("xyz789");
      expect(result).toContain("[Run](https://run.url)");
    });
  });

  describe("combined migration scenarios", () => {
    test("handles table with missing column AND wrong order", () => {
      // Table has: Action, #, Phase, SHA, Run (missing Time, wrong order)
      const messyTable = `## Iteration History

| Action | # | Phase | SHA | Run |
|--------|---|-------|-----|-----|
| First action | 1 | 1 | - | - |
| Second action | 2 | 1 | abc123 | [Run](https://run.url) |
`;

      const result = addHistoryEntry(
        messyTable,
        3,
        "2",
        "Third action",
        "2026-01-22T15:30:00Z",
      );

      // Should have correct schema order with Time added
      expect(result).toContain("| Time | # | Phase | Action | SHA | Run |");

      // Existing rows should have Time filled with "-"
      expect(result).toContain("| - | 1 | 1 | First action | - | - |");
      expect(result).toContain("| - | 2 | 1 | Second action |");

      // New row should have timestamp
      expect(result).toContain("| Jan 22 15:30 | 3 | 2 | Third action |");
    });

    test("handles table with extra column AND wrong order", () => {
      // Table has: Status, Action, #, Phase, Priority, SHA, Run (extra columns, wrong order)
      const messyTable = `## Iteration History

| Status | Action | # | Phase | Priority | SHA | Run | Time |
|--------|--------|---|-------|----------|-----|-----|------|
| Done | Task A | 1 | 1 | P1 | - | - | Jan 1 08:00 |
`;

      const result = addHistoryEntry(messyTable, 2, "1", "Task B");

      // Should have correct schema order (Status and Priority dropped)
      expect(result).toContain("| Time | # | Phase | Action | SHA | Run |");

      // Unknown columns should be dropped
      expect(result).not.toContain("Status");
      expect(result).not.toContain("Priority");
      expect(result).not.toContain("Done");
      expect(result).not.toContain("P1");

      // Known data should be preserved and reordered
      expect(result).toContain("| Jan 1 08:00 | 1 | 1 | Task A | - | - |");
      expect(result).toContain("| - | 2 | 1 | Task B |");
    });

    test("preserves content after history section during migration", () => {
      const bodyWithContentAfter = `## Description

Issue description here.

## Iteration History

| # | Phase | Action | SHA | Run |
|---|-------|--------|-----|-----|
| 1 | 1 | Started | - | - |

## Notes

Some additional notes here.

## References

- Link 1
- Link 2
`;

      const result = addHistoryEntry(
        bodyWithContentAfter,
        2,
        "1",
        "Continued",
        "2026-01-22T16:00:00Z",
      );

      // Description should be preserved
      expect(result).toContain("## Description");
      expect(result).toContain("Issue description here.");

      // History should be migrated
      expect(result).toContain("| Time | # | Phase | Action | SHA | Run |");
      expect(result).toContain("| - | 1 | 1 | Started |");
      expect(result).toContain("| Jan 22 16:00 | 2 | 1 | Continued |");

      // Content after history should be preserved
      expect(result).toContain("## Notes");
      expect(result).toContain("Some additional notes here.");
      expect(result).toContain("## References");
      expect(result).toContain("- Link 1");
      expect(result).toContain("- Link 2");
    });
  });
});
