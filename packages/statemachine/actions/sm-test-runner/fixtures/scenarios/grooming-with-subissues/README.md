# grooming-with-subissues

## What This Tests

Tests grooming that creates sub-issues for larger/phased work. After the grooming agents analyze the issue, the summary agent determines the scope requires multiple phases, creating 3 sub-issues with their own todos.

## State Machine Context

For larger issues, grooming creates sub-issues to break work into phases. Key mechanics:

- **`emitRunClaudeGrooming`** runs 5 agents: PM, Engineer (with phases variant), QA, Research, Summary
- The Engineer mock ("grooming/engineer-with-phases") signals that the work needs multiple phases
- Sub-issues are created with titles `[Phase N]: <Title>` and their own todo lists
- The first sub-issue gets projectStatus="Ready", subsequent ones get null (queued)
- The parent issue tracks overall progress while sub-issues track individual phases

## State Transitions

### Step 1: 01-detecting → 02-grooming
**Input state:** trigger="issue-groom", projectStatus="Backlog", labels=["triaged","enhancement","priority:high"], body=complex multi-phase feature description
**Transition:** Guard `needsGrooming` passes (has "triaged", no "groomed"). Runs 5 grooming agents. Engineer agent signals phases needed.
**Output state:** labels gain "groomed", 3 sub-issues created, hasSubIssues=true, agentNotes added
**Why:** The grooming analysis determined this feature is too complex for a single iteration. Three phases are created: Design & Planning (2 todos), Core Implementation (2 todos), Testing & Documentation (3 todos) = 7 total todos across sub-issues. The first phase is set to "Ready" status.

## Expected Iteration History

No iteration history entries are expected. Grooming is a pre-iteration analysis step.

| Step | State | Expected `history` | Action |
|------|-------|--------------------|--------|
| 01 | detecting | _(empty)_ | — |
| 02 | grooming | _(empty)_ | — |

## Expected Final State

- **labels:** ["triaged", "enhancement", "priority:high", "groomed"]
- **hasSubIssues:** true
- **subIssues:** 3 created:
  - `[Phase 1]: Design and planning` — projectStatus="Ready", 2 todos
  - `[Phase 2]: Core implementation` — projectStatus=null, 2 todos
  - `[Phase 3]: Testing and documentation` — projectStatus=null, 3 todos
- **expected.newSubIssueCreated:** 3
- **expected.todosAdded:** 7

## Common Failure Modes

- **Wrong number of sub-issues:** The mock "grooming/engineer-with-phases" defines 3 phases. If count differs, the mock output parsing failed.
- **First sub-issue not "Ready":** Only the first phase should be set to "Ready" — subsequent phases wait. If all are "Ready" or none are, the phase initialization logic is wrong.
- **Todos not distributed correctly:** Each sub-issue should have its own todo list (2+2+3=7). If todos ended up on the parent or counts are wrong, the sub-issue creation logic has a bug.
- **Missing "groomed" label:** Same as grooming-ready — the label must be added.
- **agentNotes missing:** The summary agent should add notes about the grooming decision.
