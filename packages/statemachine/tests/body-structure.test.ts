import { describe, it, expect } from "vitest";
import { parseMarkdown } from "@more/issue-state";
import {
  extractSubIssueBodyStructure,
  extractParentIssueBodyStructure,
} from "../src/core/parser/extractors.js";

/**
 * Helper to parse markdown into a Root AST.
 */
function parse(md: string) {
  return parseMarkdown(md);
}

describe("extractSubIssueBodyStructure", () => {
  it("extracts empty body structure", () => {
    const ast = parse("");
    const result = extractSubIssueBodyStructure(ast);

    expect(result.hasDescription).toBe(false);
    expect(result.hasTodos).toBe(false);
    expect(result.hasHistory).toBe(false);
    expect(result.hasAgentNotes).toBe(false);
    expect(result.hasQuestions).toBe(false);
    expect(result.hasAffectedAreas).toBe(false);
    expect(result.todoStats).toBeNull();
    expect(result.questionStats).toBeNull();
    expect(result.historyEntries).toEqual([]);
    expect(result.agentNotesEntries).toEqual([]);
  });

  it("detects Description section", () => {
    const ast = parse("## Description\n\nSome description text.");
    const result = extractSubIssueBodyStructure(ast);
    expect(result.hasDescription).toBe(true);
  });

  it('detects Todos section with "Todos" heading', () => {
    const ast = parse(
      "## Todos\n\n- [ ] First task\n- [x] Second task\n- [ ] Third task",
    );
    const result = extractSubIssueBodyStructure(ast);

    expect(result.hasTodos).toBe(true);
    expect(result.todoStats).not.toBeNull();
    expect(result.todoStats?.total).toBe(3);
    expect(result.todoStats?.completed).toBe(1);
    expect(result.todoStats?.uncheckedNonManual).toBe(2);
  });

  it('detects Todos section with "Todo" heading (singular alias)', () => {
    const ast = parse("## Todo\n\n- [ ] A task\n- [x] Done task");
    const result = extractSubIssueBodyStructure(ast);

    expect(result.hasTodos).toBe(true);
    expect(result.todoStats).not.toBeNull();
    expect(result.todoStats?.total).toBe(2);
    expect(result.todoStats?.completed).toBe(1);
  });

  it("detects Questions section with stats", () => {
    const ast = parse(
      "## Questions\n\n- [ ] Unanswered question?\n- [x] Answered question",
    );
    const result = extractSubIssueBodyStructure(ast);

    expect(result.hasQuestions).toBe(true);
    expect(result.questionStats).not.toBeNull();
    expect(result.questionStats?.total).toBe(2);
    expect(result.questionStats?.answered).toBe(1);
    expect(result.questionStats?.unanswered).toBe(1);
  });

  it("detects Iteration History section with entries", () => {
    const ast = parse(
      [
        "## Iteration History",
        "",
        "| Time | # | Phase | Action | SHA | Run |",
        "| --- | --- | --- | --- | --- | --- |",
        "| Jan 1 00:00 | 1 | 1 | ⏳ Iterating... | - | - |",
        "| Jan 1 00:05 | 1 | 1 | ✅ CI Passed | - | - |",
      ].join("\n"),
    );
    const result = extractSubIssueBodyStructure(ast);

    expect(result.hasHistory).toBe(true);
    expect(result.historyEntries).toHaveLength(2);
    expect(result.historyEntries[0]?.iteration).toBe(1);
    expect(result.historyEntries[0]?.action).toBe("⏳ Iterating...");
    expect(result.historyEntries[1]?.action).toBe("✅ CI Passed");
  });

  it("detects Affected Areas section", () => {
    const ast = parse(
      "## Affected Areas\n\n- `src/foo.ts` (modify) - Update logic",
    );
    const result = extractSubIssueBodyStructure(ast);
    expect(result.hasAffectedAreas).toBe(true);
  });

  it("returns null todoStats when no todos exist", () => {
    const ast = parse("## Todos\n\nNo task list here.");
    const result = extractSubIssueBodyStructure(ast);

    // Section exists but no checkbox items
    expect(result.hasTodos).toBe(true);
    expect(result.todoStats).toBeNull();
  });

  it("handles full sub-issue body", () => {
    const ast = parse(
      [
        "## Description",
        "",
        "Implement the feature.",
        "",
        "## Todos",
        "",
        "- [ ] Write tests",
        "- [ ] Implement logic",
        "- [x] Create plan",
        "",
        "## Questions",
        "",
        "- [x] What framework?",
        "",
        "## Affected Areas",
        "",
        "- `src/lib.ts` (new)",
        "",
        "## Iteration History",
        "",
        "| Time | # | Phase | Action | SHA | Run |",
        "| --- | --- | --- | --- | --- | --- |",
        "| Jan 1 00:00 | 1 | 1 | ⏳ Iterating... | - | - |",
      ].join("\n"),
    );
    const result = extractSubIssueBodyStructure(ast);

    expect(result.hasDescription).toBe(true);
    expect(result.hasTodos).toBe(true);
    expect(result.hasQuestions).toBe(true);
    expect(result.hasAffectedAreas).toBe(true);
    expect(result.hasHistory).toBe(true);
    expect(result.hasAgentNotes).toBe(false);
    expect(result.todoStats?.total).toBe(3);
    expect(result.todoStats?.completed).toBe(1);
    expect(result.questionStats?.total).toBe(1);
    expect(result.questionStats?.answered).toBe(1);
    expect(result.historyEntries).toHaveLength(1);
  });
});

describe("extractParentIssueBodyStructure", () => {
  it("extends sub-issue structure with parent-only flags", () => {
    const ast = parse(
      [
        "## Description",
        "",
        "Parent issue description.",
        "",
        "## Requirements",
        "",
        "- Req 1",
        "",
        "## Approach",
        "",
        "Use TDD.",
        "",
        "## Acceptance Criteria",
        "",
        "- It works",
        "",
        "## Testing",
        "",
        "Unit + integration",
        "",
        "## Related",
        "",
        "- #123",
        "",
        "## Todos",
        "",
        "- [ ] Phase 1",
        "",
        "## Iteration History",
        "",
        "| Time | # | Phase | Action | SHA | Run |",
        "| --- | --- | --- | --- | --- | --- |",
        "| Jan 1 00:00 | 0 | 1 | 🚀 Initialized with 2 phase(s) | - | - |",
      ].join("\n"),
    );
    const result = extractParentIssueBodyStructure(ast);

    // Sub-issue flags
    expect(result.hasDescription).toBe(true);
    expect(result.hasTodos).toBe(true);
    expect(result.hasHistory).toBe(true);
    expect(result.hasAgentNotes).toBe(false);
    expect(result.hasQuestions).toBe(false);
    expect(result.hasAffectedAreas).toBe(false);

    // Parent-only flags
    expect(result.hasRequirements).toBe(true);
    expect(result.hasApproach).toBe(true);
    expect(result.hasAcceptanceCriteria).toBe(true);
    expect(result.hasTesting).toBe(true);
    expect(result.hasRelated).toBe(true);
  });

  it("returns false for missing parent-only sections", () => {
    const ast = parse("## Description\n\nJust a description.");
    const result = extractParentIssueBodyStructure(ast);

    expect(result.hasDescription).toBe(true);
    expect(result.hasRequirements).toBe(false);
    expect(result.hasApproach).toBe(false);
    expect(result.hasAcceptanceCriteria).toBe(false);
    expect(result.hasTesting).toBe(false);
    expect(result.hasRelated).toBe(false);
  });
});
