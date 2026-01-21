# E2E Test Notes - State Machine Consolidation

## Goal
Run e2e test with multi-phase issue (multiple sub-issues) 3 times in a row without failure.

## Test Configuration
- Fixture: `multi-phase-sequential` (3 phases/sub-issues)
- Mode: `e2e`
- Expected outcome: All 3 sub-issues → Done, parent → Done, issue closed

---

## Test Runs

### Run 1
- **Started:** 2026-01-21 05:22:40 UTC
- **Run ID:** 21198299620
- **Status:** completed
- **Duration:** ~3 min
- **Result:** ❌ FAILED
- **Notes:** `run-state-machine` job was completely absent from workflow run (not skipped - not even present). Root cause: type mismatch in `claude-runner.yml`. The `issue_number` input was declared as `type: number` but `context_json` stores it as a string. GitHub Actions silently fails reusable workflow calls when input type validation fails.

### Run 2
- **Started:** 2026-01-21 05:39:22 UTC
- **Run ID:** 21198633376
- **Status:** completed
- **Duration:** ~10 min (timeout)
- **Result:** ❌ FAILED
- **Notes:** Still failing because of another type mismatch - `resource_number` was also `type: number`. First fix (issue_number) was not sufficient.

### Run 3
- **Started:** 2026-01-21 05:51:58 UTC
- **Run ID:** 21198880478
- **Status:** completed
- **Duration:** ~5s
- **Result:** ❌ FAILED
- **Notes:** Setup job failed - "Content already exists in this project". Leftover issues from Run 2 cleanup caused collision.

### Run 4
- **Started:** 2026-01-21 05:54:19 UTC
- **Run ID:** 21198926816
- **Status:** completed
- **Duration:** ~10 min (timeout)
- **Result:** ❌ FAILED
- **Notes:** `run-state-machine` job now runs (type fixes worked!) but fails with ZodError - schema status values don't match GitHub Project. Schema has "In Progress" but GitHub returns "In progress".

### Run 5
- **Started:** 2026-01-21 06:03:17 UTC
- **Run ID:** 21199107593
- **Status:** completed
- **Duration:** ~1 min
- **Result:** ❌ FAILED
- **Notes:** "Input required and not supplied: github_review_token" - the executor requires review token even for non-review actions.

### Run 6
- **Started:** 2026-01-21 06:07:12 UTC
- **Run ID:** 21199189907
- **Status:** completed
- **Duration:** ~40s
- **Result:** ❌ FAILED
- **Notes:** Setup failed - "Content already exists in this project". Leftover issues from Run 5 (or created by Run 6 before failure) not cleaned up properly. Test infrastructure race condition.

### Run 7
- **Started:** 2026-01-21 06:09:41 UTC
- **Run ID:** 21199243277
- **Status:** cancelled
- **Duration:** ~7 min (before cancellation)
- **Result:** ❌ FAILED
- **Notes:** Claude workflow for issue #3743 failed with "Parameter token or opts.auth is required". The executor creates Octokit with empty reviewToken on line 131 even when the token is not provided.

### Run 8
- **Started:** 2026-01-21 06:16:58 UTC
- **Run ID:** 21199403390
- **Status:** cancelled
- **Duration:** ~6 min (before cancellation)
- **Result:** ❌ FAILED
- **Notes:** Claude workflow for issue #3748 failed with "Invalid trigger type: assigned". The claude-detect-event outputs `trigger_type: "assigned"` but the state machine schema expects `"issue_assigned"`.

### Run 9
- **Started:** 2026-01-21 06:22:33 UTC
- **Run ID:** 21199521085
- **Status:** completed
- **Duration:** ~13 min (timeout)
- **Result:** ❌ FAILED
- **Notes:** Claude execution failed with "The cwd: claude/issue/3751/phase-1 does not exist!". The `worktree` field was set to the branch NAME, but the executor was using it as a directory PATH.

### Run 10
- **Started:** 2026-01-21 06:35:21 UTC
- **Run ID:** 21199794834
- **Status:** completed
- **Duration:** ~5 min
- **Result:** ❌ FAILED
- **Notes:** Worktree fix worked (using `/home/runner/work/nopo/nopo`), but Claude CLI failed with "error: unknown option '--yes'". The executor was using `--yes` but Claude CLI uses `-y` for auto-accept.

### Run 11
- **Started:** 2026-01-21 06:44:32 UTC
- **Run ID:** 21199986998
- **Status:** completed
- **Duration:** ~11 min
- **Result:** ❌ FAILED
- **Notes:** Claude CLI failed with "error: unknown option '-y'". The `-y` flag also doesn't exist - Claude CLI uses `--dangerously-skip-permissions` for auto-accept.

### Run 12
- **Started:** 2026-01-21 06:59:28 UTC
- **Run ID:** 21200299560
- **Status:** completed
- **Duration:** ~7 min
- **Result:** ❌ FAILED
- **Notes:** Claude CLI failed with "error: unknown option '--prompt'". The prompt should be passed as a positional argument, not a named option.

### Run 13
- **Started:** (pending)
- **Run ID:** (pending)
- **Status:** (pending)
- **Duration:** -
- **Result:** (pending)
- **Notes:** After fix to pass prompt as positional argument instead of `--prompt`.

---

## Issues Encountered

### Issue 1: Type mismatch in claude-runner.yml (issue_number)
- **Severity:** Critical (blocks all workflow execution)
- **Symptom:** `run-state-machine` job completely absent from workflow run
- **Root Cause:** `issue_number` declared as `type: number` in `claude-runner.yml` but `claude-detect-event` outputs it as a string via `context_json`
- **Impact:** GitHub Actions silently skips reusable workflow calls when input types don't match

### Issue 2: Type mismatch in claude-runner.yml (resource_number)
- **Severity:** Critical (blocks all workflow execution)
- **Symptom:** Same as Issue 1 - `run-state-machine` job absent
- **Root Cause:** `resource_number` also declared as `type: number` with `default: 0` (number)
- **Impact:** Same as Issue 1

### Issue 3: Test fixture collision
- **Severity:** Medium (test infrastructure only)
- **Symptom:** "Content already exists in this project" error during setup
- **Root Cause:** Run 3 tried to create test issues while Run 2's cleanup was still in progress, leaving orphaned issues
- **Impact:** Test infrastructure issue, not state machine issue

### Issue 4: Schema status value mismatch
- **Severity:** Critical (blocks state machine execution)
- **Symptom:** ZodError "Invalid enum value. Expected ... received 'In progress'"
- **Root Cause:** Schema defined statuses as "In Progress" and "Review" but GitHub Project uses "In progress" and "In review" (different case/wording)
- **Impact:** State machine fails to parse issue context

### Issue 5: Required github_review_token
- **Severity:** Critical (blocks executor for non-review actions)
- **Symptom:** "Input required and not supplied: github_review_token"
- **Root Cause:** `claude-state-executor` marked `github_review_token` as required, but non-review actions don't need it
- **Impact:** All executor runs fail if CLAUDE_REVIEWER_PAT secret is not available

### Issue 6: Test helper doesn't handle project item collisions
- **Severity:** Medium (test infrastructure)
- **Symptom:** "Content already exists in this project" error during setup
- **Root Cause:** When creating sub-issues with parent links, GitHub may auto-add them to project. Test helper then fails trying to add the same item.
- **Impact:** Test flakiness - requires manual cleanup between runs
- **Workaround:** Manual cleanup of test issues before each run

### Issue 7: Octokit creation with empty review token
- **Severity:** Critical (blocks executor)
- **Symptom:** "Parameter token or opts.auth is required" error
- **Root Cause:** `github.getOctokit(reviewToken)` called even when `reviewToken` is empty string. Octokit requires a valid token.
- **Impact:** All executor runs fail when CLAUDE_REVIEWER_PAT secret is not available (even for non-review actions)

### Issue 8: Trigger type mismatch between detect-event and state machine
- **Severity:** Critical (blocks state machine)
- **Symptom:** "Invalid trigger type: assigned" error
- **Root Cause:** `claude-detect-event` outputs `trigger_type: "assigned"` but the state machine schema expects `"issue_assigned"`. Same issue for `"edited"` → `"issue_edited"` and `"workflow_run"` → `"workflow_run_completed"`.
- **Impact:** State machine fails to parse trigger type, blocking all actions.

### Issue 9: runClaude worktree set to branch name instead of path
- **Severity:** Critical (blocks Claude execution)
- **Symptom:** "The cwd: claude/issue/3751/phase-1 does not exist!" error
- **Root Cause:** `runClaude` action sets `worktree: context.branch` (e.g., `claude/issue/3751/phase-1`), but this is a branch NAME being used as a working directory PATH. The checkout action places code at repo root, not in a subdirectory matching the branch name.
- **Impact:** Claude can't run because it tries to use a non-existent directory.

### Issue 10: Claude CLI --yes flag doesn't exist
- **Severity:** Critical (blocks Claude execution)
- **Symptom:** "error: unknown option '--yes'" when running Claude CLI
- **Root Cause:** The executor used `--yes` flag but Claude CLI uses `-y` for auto-accept/skip permission confirmations.
- **Impact:** Claude can't run because it fails with invalid CLI argument.

### Issue 11: Claude CLI -y flag also doesn't exist
- **Severity:** Critical (blocks Claude execution)
- **Symptom:** "error: unknown option '-y'" when running Claude CLI
- **Root Cause:** Neither `--yes` nor `-y` exist in Claude CLI. The correct flag is `--dangerously-skip-permissions`.
- **Impact:** Claude can't run because it fails with invalid CLI argument.

### Issue 12: Claude CLI --prompt flag doesn't exist
- **Severity:** Critical (blocks Claude execution)
- **Symptom:** "error: unknown option '--prompt'" when running Claude CLI
- **Root Cause:** The executor used `--prompt <text>` but Claude CLI expects the prompt as a positional argument at the end of the command.
- **Impact:** Claude can't run because it fails with invalid CLI argument.

---

## Fixes Applied

### Fix 1: Change issue_number type from number to string
- **File:** `.github/workflows/claude-runner.yml`
- **Change:** `issue_number: type: number` → `issue_number: type: string`
- **Applied:** 2026-01-21

### Fix 2: Change resource_number type from number to string
- **File:** `.github/workflows/claude-runner.yml`
- **Change:** `resource_number: type: number, default: 0` → `resource_number: type: string, default: '0'`
- **Applied:** 2026-01-21

### Fix 3: Align schema status values with GitHub Project
- **File:** `.github/actions-ts/claude-state-machine/schemas/state.ts`
- **Changes:**
  - `"In Progress"` → `"In progress"` (lowercase 'p')
  - `"Review"` → `"In review"` (added 'In ' prefix)
- **Applied:** 2026-01-21

### Fix 4: Make github_review_token optional
- **Files:**
  - `.github/actions-ts/claude-state-executor/action.yml` - changed `required: true` to `required: false` with default `""`
  - `.github/actions-ts/claude-state-executor/index.ts` - changed from `getRequiredInput` to `getOptionalInput`
- **Applied:** 2026-01-21

### Fix 5: Conditional Octokit creation for review token
- **File:** `.github/actions-ts/claude-state-executor/index.ts`
- **Change:** `const reviewOctokit = github.getOctokit(reviewToken)` → `const reviewOctokit = reviewToken ? github.getOctokit(reviewToken) : undefined`
- **Applied:** 2026-01-21

### Fix 6: Align trigger types between detect-event and state machine schema
- **File:** `.github/actions-ts/claude-detect-event/index.ts`
- **Changes:**
  - `trigger_type: "assigned"` → `trigger_type: "issue_assigned"`
  - `trigger_type: "edited"` → `trigger_type: "issue_edited"`
  - `trigger_type: "workflow_run"` → `trigger_type: "workflow_run_completed"`
  - `trigger_type: "implement_command"` → `trigger_type: "issue_comment"`
- **Applied:** 2026-01-21

### Fix 7: Remove worktree from runClaude actions
- **File:** `.github/actions-ts/claude-state-machine/machine/actions.ts`
- **Change:** Removed `worktree: context.branch ?? undefined` from all runClaude action emitters. The checkout action places code at repo root (which is `process.cwd()` in the executor), so no worktree path is needed.
- **Applied:** 2026-01-21

### Fix 8: Change Claude CLI flag from --yes to -y
- **File:** `.github/actions-ts/claude-state-machine/runner/executors/claude.ts`
- **Change:** `"--yes"` → `"-y"` in the args array for Claude CLI execution
- **Applied:** 2026-01-21
- **Result:** ❌ Did not work - `-y` also doesn't exist

### Fix 9: Change Claude CLI flag to --dangerously-skip-permissions
- **File:** `.github/actions-ts/claude-state-machine/runner/executors/claude.ts`
- **Change:** `"-y"` → `"--dangerously-skip-permissions"` - the actual flag used by Claude CLI to skip permission prompts
- **Applied:** 2026-01-21

### Fix 10: Pass prompt as positional argument
- **File:** `.github/actions-ts/claude-state-machine/runner/executors/claude.ts`
- **Change:** Removed `"--prompt", prompt` and added `prompt` as the last element in args array. Claude CLI expects the prompt as a positional argument, not a named option.
- **Applied:** 2026-01-21

---

## Final Summary

(Pending completion of 3 successful runs)
