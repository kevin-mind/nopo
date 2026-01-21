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
- **Status:** completed
- **Duration:** ~2 min (before failure)
- **Result:** ❌ FAILED
- **Notes:** Claude workflow for issue #3743 failed with "Parameter token or opts.auth is required". The executor creates Octokit with empty reviewToken on line 131 even when the token is not provided.

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

---

## Final Summary

(Pending completion of 3 successful runs)
