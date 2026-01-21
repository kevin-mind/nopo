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
- **Started:** (pending)
- **Status:** (pending)
- **Duration:** -
- **Result:** -
- **Notes:** -

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

---

## Final Summary

(Pending completion of 3 successful runs)
