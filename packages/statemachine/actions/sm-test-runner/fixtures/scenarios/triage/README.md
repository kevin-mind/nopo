# triage

## What This Tests

Tests the issue triage flow: a new issue enters detection, gets classified by Claude (labels, priority, body structure), and transitions to the triaged state. No sub-issues are created for this simple issue.

## State Machine Context

Triage is the entry point for all new issues. Key mechanics:

- **`needsTriage` guard** checks if the issue lacks the "triaged" label — this is the primary routing condition
- **`emitRunClaudeTriage`** runs Claude with the triage prompt, which produces structured output: labels (type, priority, topics), body restructuring (Description, Approach, Iteration History sections), and project field values
- **projectStatus** transitions from null → "Backlog" (via `emitSetReady` or triage action)
- The "triaged" label acts as an idempotency guard — once added, the issue won't be re-triaged on subsequent edits

## State Transitions

### Step 1: 01-detecting → 02-triaging
**Input state:** projectStatus=null, iteration=0, failures=0, labels=[], body=unstructured text
**Transition:** `DETECT` event fires. Guard `needsTriage` checks: no "triaged" label → true. Routes to triaging state.
**Output state:** projectStatus="Backlog", labels=["enhancement","priority:medium","topic:testing","triaged"], body restructured with ## Description, ## Approach, ## Todo, ## Iteration History sections
**Why:** The triage Claude mock ("triage/simple-issue") classifies this as an enhancement with medium priority and a testing topic. The body is restructured from freeform text into the standard section format. The "triaged" label is added to prevent re-triage. projectStatus is set to "Backlog" indicating the issue is ready for grooming/implementation.

## Expected Iteration History

No iteration history entries are expected. Triage is the initial classification step — no iteration has occurred yet, so no history entries are recorded.

| Step | State | Expected `history` | Action |
|------|-------|--------------------|--------|
| 01 | detecting | _(empty)_ | — |
| 02 | triaging | _(empty)_ | — |

**Note:** The issue body gains an `## Iteration History` section (with empty markers `<!-- iteration_history_start --><!-- iteration_history_end -->`) during triage, but no entries are added until the first iteration.

## Expected Final State

- **projectStatus:** Backlog (newly triaged issues start in backlog)
- **iteration:** 0 (no iteration has happened yet)
- **failures:** 0
- **labels:** ["enhancement", "priority:medium", "topic:testing", "triaged"]
- **body:** Restructured with standard sections (Description, Approach, Todo, Iteration History)
- **todos:** 2 total, 0 completed (created by triage from acceptance criteria)
- **expected.hasTriagedLabel:** true

## Common Failure Modes

- **Missing "triaged" label:** The triage action is responsible for adding this label. If absent, the Claude triage mock may have produced invalid output or the label-setting action failed.
- **projectStatus != "Backlog":** Triage sets the initial project status. If null, the status-setting action didn't fire. If something else (e.g., "In progress"), a different state path was taken.
- **Body not restructured:** The triage Claude mock produces a structured body. If the body is still the original unstructured text, the mock output wasn't applied or the body-update action failed.
- **Re-triage loop:** If the "triaged" label isn't set, subsequent `issues:edited` events would re-trigger triage indefinitely. The guard `needsTriage` prevents this.
- **Wrong labels:** The mock "triage/simple-issue" produces specific labels. Different mocks or real Claude could produce different classifications.
