# grooming-ready

## What This Tests

Tests simple issue grooming: a triaged issue enters grooming, where 4 parallel analysis agents (PM, Engineer, QA, Research) plus a summary agent run. The "groomed" label is added. No sub-issues are created because the issue scope is small enough for direct implementation.

## State Machine Context

Grooming is the deep analysis step between triage and implementation. Key mechanics:

- **`needsGrooming` guard** checks: issue has "triaged" label but NOT "groomed" label
- **`emitRunClaudeGrooming`** runs 5 Claude agents in sequence: PM analysis, Engineer analysis, QA analysis, Research, then Summary
- The summary agent decides whether sub-issues are needed based on scope/complexity
- For small issues (like this one), no sub-issues are created — the issue is ready for direct iteration
- The "groomed" label is added to prevent re-grooming

## State Transitions

### Step 1: 01-detecting → 02-grooming
**Input state:** trigger="issue-groom", projectStatus="Backlog", labels=["triaged","enhancement"], body=unstructured text about housekeeping
**Transition:** Guard `needsGrooming` checks: has "triaged" but not "groomed" → true. Routes to grooming state. Runs 5 Claude mocks: grooming/pm, grooming/engineer, grooming/qa, grooming/research, grooming/summary.
**Output state:** labels=["triaged","enhancement","groomed"], no sub-issues created
**Why:** The grooming agents analyze the issue from multiple perspectives. The summary agent determines the issue is small enough for direct implementation (no phases needed). The "groomed" label is added as an idempotency guard.

## Expected Iteration History

No iteration history entries are expected. Grooming is a pre-iteration analysis step.

| Step | State | Expected `history` | Action |
|------|-------|--------------------|--------|
| 01 | detecting | _(empty)_ | — |
| 02 | grooming | _(empty)_ | — |

## Expected Final State

- **projectStatus:** Backlog (unchanged — grooming doesn't change status)
- **labels:** ["triaged", "enhancement", "groomed"]
- **subIssues:** [] (no sub-issues — small scope)
- **expected.hasGroomedLabel:** true

## Common Failure Modes

- **Missing "groomed" label:** The grooming action is responsible for adding this. If absent, the summary agent may have failed or the label action didn't fire.
- **Sub-issues created unexpectedly:** The summary agent decides scope. If sub-issues were created for this simple issue, the mock "grooming/summary" produced unexpected output.
- **Wrong trigger:** The `issue-groom` trigger is specific. If the machine routes to triage instead, the trigger detection is wrong or the "triaged" label is missing.
- **Grooming agents didn't run:** All 5 mocks must be consumed in order. If any mock is missing, the grooming flow fails.
