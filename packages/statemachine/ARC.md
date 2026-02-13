# State Machine Architecture

## Overview

The state machine automates GitHub issue lifecycle management. It receives webhook events (issue edits, CI completions, PR reviews, etc.), determines the appropriate action via a deterministic XState machine, executes those actions against the GitHub API, and verifies the resulting state matches predictions.

The system runs across three GitHub Actions steps: **Plan** (predict), **Run** (execute), **Verify** (check).

```
Webhook Event
  │
  ▼
┌──────────┐     ┌──────────┐     ┌──────────┐
│  sm-plan │────▶│  sm-run  │────▶│sm-verify │
│ (predict)│     │(execute) │     │ (check)  │
└──────────┘     └──────────┘     └──────────┘
  │                │                │
  │ expected_state │ final_state    │ verified
  │ context_json   │ actions_json   │ diff_json
  ▼                ▼                ▼
```

---

## Plan → Run → Verify Loop

### Step 1: Plan (`sm-plan`)

1. **Detect event** — Parse webhook payload, resolve the issue/discussion resource, determine trigger type (e.g., `issue-edited`, `pr-review-requested`, `merge-queue-entered`)
2. **Derive actions** — Run the XState machine with a `DETECT` event. The machine evaluates guards top-to-bottom and transitions to a single final state. Entry actions on that state emit a list of `Action` objects.
3. **Predict expected state** — Extract a `PredictableStateTree` from the current context, apply the state's mutator to predict the post-execution state, wrap in `ExpectedState` JSON.
4. **Log run start** — Write `⏳ running...` history entry to the issue body for immediate user feedback.
5. **Output** — `context_json`, `expected_state_json`, concurrency settings.

### Step 2: Run (`sm-run`)

1. **Re-derive** — Run the state machine again (independently of plan) to get `DeriveResult` with `pendingActions`.
2. **Execute** — Run each action sequentially against the GitHub API via the executor registry. Actions include: update project fields, create branches, create PRs, run Claude, append history, close issues, etc.
3. **Log run end** — Find the `⏳ running...` history entry and replace it with the outcome (e.g., `✅ Iterate`, `❌ CI Failed`).
4. **Determine retrigger** — Check if `finalState` is in the retrigger allowlist (`orchestrationRunning`, `triaging`, `resetting`, `prReviewAssigned`). If yes, dispatch `sm-trigger.yml` for the next iteration.
5. **Output** — `final_state`, `should_retrigger`, `success`, `actions_json`.

### Step 3: Verify (`sm-verify`)

1. **Fetch actual state** — Call `parseIssue()` to get the real GitHub state after execution.
2. **Extract actual tree** — Build a `PredictableStateTree` from the actual issue data.
3. **Compare** — For each predicted outcome, compare against actual. Passes if ANY outcome matches (union semantics).
4. **Check retrigger** — Verify `expectedRetrigger` matches `actual_should_retrigger`.
5. **On failure** — Log `❌ Verification failed` to history, set issue to Blocked, unassign bot.
6. **Output** — `verified`, `diff_json`.

---

## XState Machine

### State Topology

The machine has a single `detecting` state that receives a `DETECT` event and transitions to exactly one final state based on guard evaluation order.

```
                    ┌─────────────────┐
        DETECT      │    detecting    │
   ───────────────▶ │  (guard chain)  │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
         [terminal]    [intermediate]   [logging]
         done          iterating        mergeQueueLogging
         blocked       orchestrating    deployedStageLogging
         error         triaging         ...
         alreadyDone   prReviewing
         alreadyBlocked commenting
                       ...
```

### Guard Evaluation Order

Guards in the `detecting` state are evaluated top-to-bottom. **First match wins.** This ordering is critical — it determines priority when multiple guards are true simultaneously.

```
 Priority  Guard                           Target State
 ────────  ──────────────────────────────   ─────────────────────────
 1         triggeredByReset                 resetting
 2         triggeredByRetry                 retrying
 3         triggeredByPivot                 pivoting
 4         allPhasesDone                    orchestrationComplete
 5         isAlreadyDone                    done
 6         isBlocked                        alreadyBlocked
 7         isError                          error
 8         triggeredByMergeQueueEntry       mergeQueueLogging
 9         triggeredByMergeQueueFailure     mergeQueueFailureLogging
 10        triggeredByPRMerged              processingMerge
 11        triggeredByDeployedStage         deployedStageLogging
 12        triggeredByDeployedProd          deployedProdLogging
 13        triggeredByDeployedStageFailure  deployedStageFailureLogging
 14        triggeredByDeployedProdFailure   deployedProdFailureLogging
 15        triggeredByTriage                triaging
 16        triggeredByComment               commenting
 17        triggeredByOrchestrate           orchestrating
 18        triggeredByPRReview & ciPassed   prReviewing
 19        triggeredByPRReview & !ciFailed  prReviewAssigned
 20        triggeredByPRReview & ciFailed   prReviewSkipped
 21        triggeredByPRResponse            prResponding
 22        triggeredByPRHumanResponse       prRespondingHuman
 23        triggeredByPRReviewApproved      awaitingMerge
 24        triggeredByPRPush                prPush
 25        triggeredByCI & readyForReview   transitioningToReview
 26        triggeredByCI & shouldContinue   iteratingFix
 27        triggeredByCI & shouldBlock      blocked
 28        triggeredByCI                    processingCI
 29        triggeredByReview & approved     awaitingMerge
 30        triggeredByReview & changes      iteratingFix
 31        triggeredByReview & commented    reviewing
 32        triggeredByReview                reviewing
 33        needsTriage                      triaging
 34        subIssueCanIterate               iterating/iteratingFix
 35        subIssueIdle                     subIssueIdle
 36        triggeredByGroom                 grooming
 37        triggeredByGroomSummary          grooming
 38        needsGrooming                    grooming
 39        needsSubIssues                   (placeholder)
 40        hasSubIssues                     orchestrating
 41        isInReview                       reviewing
 42        readyForReview                   transitioningToReview
 43        (fallback for parent w/o subs)   invalidIteration
```

### States Reference

#### Terminal States (final, no further processing)

| State | Entry Actions | Description |
|-------|--------------|-------------|
| `done` | setDone, closeIssue | Issue completed successfully |
| `blocked` | setBlocked, unassign, blockIssue | Circuit breaker — max failures reached |
| `error` | setError, logInvalidIteration | Unrecoverable error |
| `alreadyDone` | log | No-op, issue was already done |
| `alreadyBlocked` | log | No-op, issue was already blocked |

#### Iteration States

| State | Entry Actions | Description |
|-------|--------------|-------------|
| `iterating` | setWorking, incrementIteration, createBranch, createPR, runClaude | Initial implementation — Claude writes code |
| `iteratingFix` | setWorking, incrementIteration, runClaudeFixCI | Fix CI failures or address review feedback |
| `processingCI` | (conditional) | Evaluate CI result, log success/failure |
| `transitioningToReview` | clearFailures, markReady, setReview, requestReview | CI passed + todos done → request review |

#### Review States

| State | Entry Actions | Description |
|-------|--------------|-------------|
| `reviewing` | setReview | PR is under review (human or waiting) |
| `awaitingMerge` | log | PR approved, waiting for human merge |
| `prReviewing` | runClaudePRReview | Bot performs PR code review |
| `prResponding` | runClaudePRResponse | Bot addresses bot's review comments |
| `prRespondingHuman` | runClaudePRHumanResponse | Bot addresses human's review comments |
| `prReviewAssigned` | log | Ack review request, retrigger outside PR context |
| `prReviewSkipped` | log | Review requested but CI failed |
| `prPush` | convertToDraft, removeReviewer, pushToDraft | Code pushed → convert to draft for CI |

#### Orchestration States

| State | Entry Actions | Description |
|-------|--------------|-------------|
| `orchestrating` | log | Entry point — routes to sub-states via `always` transitions |
| `orchestrationRunning` | orchestrate | Init parent, advance phase, assign sub-issue |
| `orchestrationWaiting` | log | Current phase in review — wait |
| `orchestrationComplete` | allPhasesDone | All sub-issues Done/CLOSED → close parent |

The `orchestrating` state has internal `always` transitions:
1. `allPhasesDone` → `orchestrationComplete`
2. `currentPhaseInReview` → `orchestrationWaiting`
3. (fallback) → `orchestrationRunning`

#### AI-Dependent States

| State | Entry Actions | Description |
|-------|--------------|-------------|
| `triaging` | runClaudeTriage | Classify issue, add labels, set fields |
| `grooming` | runClaudeGrooming | Deep analysis with parallel agents |
| `commenting` | runClaudeComment | Respond to @claude mention |
| `pivoting` | runClaudePivot | Analyze mid-flight pivot request |

#### Control States

| State | Entry Actions | Description |
|-------|--------------|-------------|
| `resetting` | resetIssue | Reset to Backlog, clear failures, remove sub-issues from project |
| `retrying` | retryIssue | Clear failures, set In Progress, reassign bot |
| `processingMerge` | setDone, closeIssue, merged | PR merged → close sub-issue |
| `rebased` | log | Branch rebased, CI will re-trigger |
| `subIssueIdle` | (none) | Sub-issue edited but bot not assigned |
| `invalidIteration` | setError | Parent without sub-issues tried to iterate |

#### Logging States (final, append history only)

| State | History Message |
|-------|---------------|
| `mergeQueueLogging` | 🚀 Entered queue |
| `mergeQueueFailureLogging` | ❌ Removed from queue |
| `mergedLogging` | 🚢 Merged |
| `deployedStageLogging` | 🚀 Deployed to stage |
| `deployedProdLogging` | 🎉 Released to production |
| `deployedStageFailureLogging` | ❌ Stage deploy failed |
| `deployedProdFailureLogging` | ❌ Prod deploy failed |

### Retrigger States

After execution, `sm-run` checks if the final state requires automatic retrigger:

| State | Why Retrigger |
|-------|--------------|
| `orchestrationRunning` | Assigned sub-issue → sm-plan routes to iterate |
| `triaging` | After triage → grooming should start |
| `resetting` | After reset → automation continues |
| `prReviewAssigned` | Ack review request → retrigger outside PR check context |

All other states either produce natural webhooks (e.g., `iterating` → CI completes → `triggeredByCI`) or are terminal/waiting-for-human.

---

## Verification System

### Architecture

The verification system predicts state changes *before* execution and compares against actual state *after* execution. This creates a closed-loop feedback system that catches bugs in both the machine logic and the mutator predictions.

```
BEFORE EXECUTION                    AFTER EXECUTION

┌─────────────────┐                 ┌─────────────────┐
│ Current State   │                 │  Actual State   │
│ (from GitHub)   │                 │  (from GitHub)  │
└────────┬────────┘                 └────────┬────────┘
         │                                   │
    extractPredictableTree()           extractPredictableTree()
         │                                   │
         ▼                                   ▼
┌─────────────────┐                 ┌─────────────────┐
│ PredictableState│                 │ PredictableState│
│      Tree       │                 │      Tree       │
└────────┬────────┘                 └────────┬────────┘
         │                                   │
    mutator(tree, context)                   │
         │                                   │
         ▼                                   │
┌─────────────────┐                          │
│ Expected State  │      compareStateTree()  │
│  (outcomes[])   │─────────────────────────▶│
└─────────────────┘                          │
                                             ▼
                                    ┌─────────────────┐
                                    │  VerifyResult   │
                                    │  pass / diffs   │
                                    └─────────────────┘
```

### PredictableStateTree

The subset of issue state that can be predicted deterministically:

```typescript
PredictableStateTree {
  issue: {
    number, state, projectStatus, iteration, failures,
    labels[], assignees[], hasBranch, hasPR,
    pr: { isDraft, state } | null,
    body: {
      hasDescription, hasTodos, hasHistory, hasAgentNotes,
      hasQuestions, hasAffectedAreas, hasRequirements,
      hasApproach, hasAcceptanceCriteria, hasTesting, hasRelated,
      todoStats: { total, completed, uncheckedNonManual } | null,
      questionStats: { total, answered } | null,
      historyEntries: { iteration, phase, action }[],
      agentNotesEntries: { key, value }[],
    }
  },
  subIssues: [{
    number, state, projectStatus, labels[],
    hasBranch, hasPR,
    pr: { isDraft, state } | null,
    body: { ...same section flags + todoStats + historyEntries }
  }]
}
```

### Mutators

Each final state has a registered **mutator** — a pure function that takes the current `PredictableStateTree` and `MachineContext`, and returns an array of possible outcome trees.

```typescript
type StateMutator = (
  tree: PredictableStateTree,
  context: MachineContext,
) => PredictableStateTree[];
```

Returns an array because some states have multiple possible outcomes (union semantics). Verification passes if ANY outcome matches actual state.

#### Mutator Registry

| Final State | Mutator | What It Predicts |
|-------------|---------|-----------------|
| **Terminal** | | |
| `done` | `doneMutator` | projectStatus→Done, state→CLOSED |
| `blocked` | `blockedMutator` | projectStatus→Blocked, bot unassigned, history entry |
| `error` | `errorMutator` | projectStatus→Error |
| `alreadyDone` | `noopMutator` | No changes |
| `alreadyBlocked` | `noopMutator` | No changes |
| **Iteration** | | |
| `iterating` | `iteratingMutator` | projectStatus→In progress, iteration+1, bot assigned, branch+PR created |
| `iteratingFix` | `iteratingFixMutator` | iteration+1, history entry |
| **Review** | | |
| `reviewing` | `reviewingMutator` | History entry (review requested) |
| `transitioningToReview` | `transitioningToReviewMutator` | projectStatus→In review, pr.isDraft→false, failures→0, history |
| `awaitingMerge` | `awaitingMergeMutator` | History entry (awaiting merge) |
| **Orchestration** | | |
| `orchestrationRunning` | `orchestrationRunningMutator` | Sub-issue assignment, phase advancement, history |
| `orchestrationWaiting` | `orchestrationWaitingMutator` | No changes (waiting for review) |
| `orchestrationComplete` | `orchestrationCompleteMutator` | projectStatus→Done, state→CLOSED, history: all phases complete |
| **AI-Dependent** | | |
| `triaging` | `triagingMutator` | "triaged" label added, body sections populated |
| `grooming` | `groomingMutator` | "groomed" label added |
| `commenting` | `commentingMutator` | No structural changes (comment is external) |
| `pivoting` | `pivotingMutator` | History entry |
| **Logging** | | |
| `mergeQueueLogging` | `mergeQueueLoggingMutator` | History: 🚀 Entered queue |
| `mergeQueueFailureLogging` | `mergeQueueFailureLoggingMutator` | History: ❌ Removed from queue |
| `mergedLogging` | `mergedLoggingMutator` | History: 🚢 Merged |
| `deployedStageLogging` | `deployedStageLoggingMutator` | History: 🚀 Deployed to stage |
| `deployedProdLogging` | `deployedProdLoggingMutator` | History: 🎉 Released to production |
| `deployedStageFailureLogging` | `deployedStageFailureLoggingMutator` | History: ❌ Stage deploy failed |
| `deployedProdFailureLogging` | `deployedProdFailureLoggingMutator` | History: ❌ Prod deploy failed |
| **Control** | | |
| `processingCI` | `processingCIMutator` | History entry (✅ or ❌ based on ciResult) |
| `prPush` | `prPushMutator` | pr.isDraft→true, sub projectStatus→In progress, history |
| `resetting` | `resettingMutator` | projectStatus→Backlog, failures→0, bot unassigned, subs removed from project |
| `rebased` | `rebasedMutator` | History: 🔄 Rebased |
| `processingMerge` | `processingMergeMutator` | projectStatus→Done, state→CLOSED, history: merged |
| `invalidIteration` | `invalidIterationMutator` | projectStatus→Error |
| `subIssueIdle` | `subIssueIdleMutator` | No changes |
| `prReviewAssigned` | `prReviewAssignedMutator` | History entry |
| **PR Review (AI-dependent)** | | |
| `prReviewing` | `noopMutator` | No predictable structural changes |
| `prResponding` | `noopMutator` | No predictable structural changes |
| `prRespondingHuman` | `noopMutator` | No predictable structural changes |
| `prReviewSkipped` | `noopMutator` | No predictable structural changes |

### Comparison Rules

The compare engine uses different strategies per field type:

| Field | Strategy | Rationale |
|-------|----------|-----------|
| `state` | Exact | OPEN/CLOSED must match exactly |
| `projectStatus` | Exact | Status must match exactly |
| `iteration` | `actual >= expected` | Other actions may increment further |
| `failures` | Exact OR 0 | May be cleared by success path |
| `labels` | Superset (`expected ⊆ actual`) | Other systems may add labels |
| `assignees` | Superset | Other systems may add assignees |
| `hasBranch`, `hasPR` | Only enforce if `expected=true` | Can't un-create a branch |
| `pr.isDraft`, `pr.state` | Exact | Draft/merge state must match |
| Body section flags | Only enforce if `expected=true` | Sections aren't removed |
| `todoStats.total` | `actual >= expected` | More todos may be added |
| `todoStats.completed` | `actual >= expected` | More may be completed |
| `todoStats.uncheckedNonManual` | `actual <= expected` | Should decrease or stay |
| History entries | Match by `(iteration, phase, action.startsWith())` | Prefix match allows appended context |

### Union Outcomes

Some mutators return multiple possible `PredictableStateTree` outcomes. Verification passes if ANY outcome matches. This handles states where the exact outcome depends on AI behavior (e.g., triage may or may not add certain labels).

---

## History System

### Entry Lifecycle

History entries track the lifecycle of each state machine run in the issue body's "Iteration History" table.

```
| Date | Iteration | Phase | Action | SHA | Run |
|------|-----------|-------|--------|-----|-----|
| Feb 13 | 1 | 1 | ✅ Iterate | abc1234 | [link] |
| Feb 13 | 1 | 1 | ✅ CI Passed → 👀 Review requested | def5678 | [link] |
```

### Write Flow

1. **`sm-plan`** writes `⏳ running...` via `appendHistory` (immediate feedback)
2. **`sm-run`** executes actions which may call `appendHistory` (e.g., merge queue logging)
3. **`sm-run` `logRunEnd`** finds the `⏳ running...` entry and replaces it with the outcome

When `appendHistory` finds an existing row with the same `runId`:
- If the existing action is `⏳ running...` → **replace** with the new action
- Otherwise → **append** with ` -> ` separator

For logging states (merge queue, deploy), `logRunEnd` is skipped (`skipLogging=true`), so the `appendHistory` replacement handles the `⏳ running...` cleanup directly.

---

## Key Invariants

1. **Single transition per run** — The `DETECT` event fires once, first matching guard wins, exactly one final state reached.
2. **Guard ordering is priority** — Reset/Retry/Pivot override everything. `allPhasesDone` overrides Blocked/Error. Terminal states block normal processing.
3. **Idempotent actions** — Branch creation, PR creation, and label operations are idempotent. Re-running a transition should not cause errors.
4. **Draft PR gateway** — PRs stay draft during iteration (CI loop). Only `transitioningToReview` marks them ready. `prPush` converts back to draft.
5. **History as audit log** — Every state machine run leaves a history entry. `⏳ running...` is always resolved to an outcome.
6. **Verification as safety net** — Failed verification blocks the issue and unassigns bot, preventing runaway automation.
7. **Retrigger allowlist** — Only 4 states auto-retrigger. All others either produce natural webhooks or are terminal.

---

## File Map

```
packages/statemachine/
├── src/
│   ├── machine/
│   │   ├── machine.ts          # XState machine definition (states, guards, transitions)
│   │   ├── guards.ts           # Guard functions (65 guards)
│   │   ├── actions.ts          # Action emitters (emit Action objects)
│   │   └── index.ts            # Public exports
│   ├── runner/
│   │   ├── derive.ts           # Run machine, extract DeriveResult
│   │   ├── runner.ts           # Execute actions sequentially
│   │   └── executors/
│   │       ├── github.ts       # GitHub API executors (issues, PRs, projects)
│   │       ├── git.ts          # Git operations (branch, push)
│   │       ├── claude.ts       # Claude Code SDK execution
│   │       └── ...             # Triage, iterate, review executors
│   ├── verify/
│   │   ├── predictable-state.ts  # PredictableStateTree schema + extraction
│   │   ├── compare.ts            # Comparison engine (diff functions)
│   │   └── mutators/
│   │       ├── index.ts          # Mutator registry (state → mutator mapping)
│   │       ├── types.ts          # StateMutator type definition
│   │       ├── helpers.ts        # Shared utilities (cloneTree, addHistoryEntry)
│   │       ├── terminal.ts       # done, blocked, error, noop mutators
│   │       ├── iteration.ts      # iterating, iteratingFix mutators
│   │       ├── review.ts         # reviewing, transitioningToReview, awaitingMerge
│   │       ├── orchestration.ts  # orchestrationRunning/Waiting/Complete
│   │       ├── ai-dependent.ts   # triaging, grooming, commenting, pivoting
│   │       ├── logging.ts        # Merge queue and deployment logging
│   │       └── control.ts        # processingCI, prPush, resetting, etc.
│   ├── parser/
│   │   ├── mutators.ts         # Issue body mutators (appendHistory, updateHistory)
│   │   └── extractors.ts       # Extract body structure from AST
│   ├── schemas/
│   │   └── state.ts            # MachineContext, TriggerType, Action schemas
│   └── constants.ts            # History messages, section names
├── actions/
│   ├── sm-plan/                # GitHub Action: detect + derive + predict + logRunStart
│   ├── sm-run/                 # GitHub Action: derive + execute + logRunEnd + retrigger
│   ├── sm-verify/              # GitHub Action: fetch actual + compare + block on failure
│   ├── sm-test-helper/         # E2E test helper (mock responses)
│   └── sm-test-runner/         # E2E test runner (scenario-based)
│       └── fixtures/scenarios/ # Test scenarios with README.md docs
└── tests/                      # Unit tests (machine, guards, verify, parser)
```
