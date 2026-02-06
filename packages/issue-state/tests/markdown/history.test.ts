import { describe, it, expect } from "vitest";
import {
  parseHistory,
  addHistoryEntry,
  updateHistoryEntry,
  createHistoryTable,
  getLatestHistoryEntry,
  parseHistoryRow,
  findHistoryEntries,
  hasHistoryEntry,
} from "../../src/markdown/history.js";

const BODY_WITH_HISTORY = `## Description

Some description

## Iteration History

| Time | # | Phase | Action | SHA | Run |
|---|---|---|---|---|---|
| Jan 22 19:04 | 1 | 1 | Started work | [\`abc1234\`](https://github.com/o/r/commit/abc1234) | [12345](https://github.com/o/r/actions/runs/12345) |
| Jan 22 19:30 | 2 | 1 | CI passed | [\`def5678\`](https://github.com/o/r/commit/def5678) | [12346](https://github.com/o/r/actions/runs/12346) |`;

describe("parseHistory", () => {
  it("parses history entries from body", () => {
    const entries = parseHistory(BODY_WITH_HISTORY);
    expect(entries).toHaveLength(2);
    expect(entries[0]!.iteration).toBe(1);
    expect(entries[0]!.phase).toBe("1");
    expect(entries[0]!.action).toBe("Started work");
    expect(entries[0]!.sha).toBe("abc1234");
    expect(entries[0]!.runLink).toBe("https://github.com/o/r/actions/runs/12345");
    expect(entries[0]!.timestamp).toBe("Jan 22 19:04");
  });

  it("returns empty array for body without history", () => {
    expect(parseHistory("Just a description")).toEqual([]);
  });
});

describe("getLatestHistoryEntry", () => {
  it("returns last entry", () => {
    const entry = getLatestHistoryEntry(BODY_WITH_HISTORY);
    expect(entry!.iteration).toBe(2);
    expect(entry!.action).toBe("CI passed");
  });

  it("returns null for empty history", () => {
    expect(getLatestHistoryEntry("No history here")).toBeNull();
  });
});

describe("parseHistoryRow", () => {
  it("parses a single data row", () => {
    const row = "| Jan 22 19:04 | 1 | 1 | Started | - | - |";
    const entry = parseHistoryRow(row);
    expect(entry!.iteration).toBe(1);
    expect(entry!.action).toBe("Started");
  });

  it("returns null for header row", () => {
    expect(parseHistoryRow("| Time | # | Phase | Action | SHA | Run |")).toBeNull();
  });

  it("returns null for separator row", () => {
    expect(parseHistoryRow("|---|---|---|---|---|---|")).toBeNull();
  });
});

describe("addHistoryEntry", () => {
  it("creates history section when none exists", () => {
    const result = addHistoryEntry(
      "Just a description",
      1, "1", "Started",
      "2026-01-22T19:04:52Z",
    );
    expect(result).toContain("## Iteration History");
    expect(result).toContain("Started");
    expect(result).toContain("Jan 22 19:04");
  });

  it("appends to existing history", () => {
    const result = addHistoryEntry(
      BODY_WITH_HISTORY,
      3, "1", "Pushed fix",
      "2026-01-22T20:00:00Z",
    );
    const entries = parseHistory(result);
    expect(entries).toHaveLength(3);
    expect(entries[2]!.action).toBe("Pushed fix");
  });

  it("deduplicates by run ID", () => {
    const result = addHistoryEntry(
      BODY_WITH_HISTORY,
      1, "1", "Also this",
      "2026-01-22T19:10:00Z",
      undefined,
      "https://github.com/o/r/actions/runs/12345",
    );
    const entries = parseHistory(result);
    // Should update existing row instead of adding new one
    expect(entries).toHaveLength(2);
    expect(entries[0]!.action).toContain("Also this");
  });
});

describe("updateHistoryEntry", () => {
  it("updates matching entry", () => {
    const { body, updated } = updateHistoryEntry(
      BODY_WITH_HISTORY,
      1, "1", "Started",
      "Updated message",
    );
    expect(updated).toBe(true);
    const entries = parseHistory(body);
    expect(entries[0]!.action).toBe("Updated message");
  });

  it("returns unchanged if no match", () => {
    const { body, updated } = updateHistoryEntry(
      BODY_WITH_HISTORY,
      99, "99", "Not found",
      "Updated message",
    );
    expect(updated).toBe(false);
    expect(body).toBe(BODY_WITH_HISTORY);
  });
});

describe("createHistoryTable", () => {
  it("creates full table from entries", () => {
    const entries = [
      { iteration: 1, phase: "1", action: "Start", timestamp: "Jan 22 19:04", sha: null, runLink: null },
    ];
    const table = createHistoryTable(entries);
    expect(table).toContain("## Iteration History");
    expect(table).toContain("Start");
  });
});

describe("findHistoryEntries / hasHistoryEntry", () => {
  it("finds entries by pattern", () => {
    const entries = findHistoryEntries(BODY_WITH_HISTORY, "CI");
    expect(entries).toHaveLength(1);
    expect(entries[0]!.action).toBe("CI passed");
  });

  it("checks existence", () => {
    expect(hasHistoryEntry(BODY_WITH_HISTORY, "Started")).toBe(true);
    expect(hasHistoryEntry(BODY_WITH_HISTORY, "Not here")).toBe(false);
  });
});
