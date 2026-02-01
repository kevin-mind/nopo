# State Machine Test Results

## Individual State Transition Tests (Mock Claude + Mock CI)

| # | Transition | Run ID | Outcome | Link |
|---|------------|--------|---------|------|
| 1 | detecting → triaging | 21558576499 | ✅ Pass | https://github.com/kevin-mind/nopo/actions/runs/21558576499 |
| 2 | triaging → iterating | 21558597153 | ✅ Pass | https://github.com/kevin-mind/nopo/actions/runs/21558597153 |
| 3 | iterating → processingCI | 21558643557 | ✅ Pass | https://github.com/kevin-mind/nopo/actions/runs/21558643557 |
| 4 | processingCI → transitioningToReview | 21558756707 | ✅ Pass | https://github.com/kevin-mind/nopo/actions/runs/21558756707 |
| 5 | transitioningToReview → reviewing | 21558774735 | ✅ Pass | https://github.com/kevin-mind/nopo/actions/runs/21558774735 |
| 6 | reviewing → processingReview | 21558790996 | ✅ Pass | https://github.com/kevin-mind/nopo/actions/runs/21558790996 |
| 7 | processingReview → awaitingMerge | 21558805606 | ✅ Pass | https://github.com/kevin-mind/nopo/actions/runs/21558805606 |
| 8 | awaitingMerge → processingMerge | 21558823232 | ✅ Pass | https://github.com/kevin-mind/nopo/actions/runs/21558823232 |
| 9 | processingMerge → done | 21558870889 | ✅ Pass | https://github.com/kevin-mind/nopo/actions/runs/21558870889 |

## Full Flow Tests (Real Claude + Mock CI)

| # | Run ID | Outcome | Link | Notes |
|---|--------|---------|------|-------|

## Full Flow Tests (Mock Claude + Real CI)

| # | Run ID | Outcome | Link | Notes |
|---|--------|---------|------|-------|
| 1 | 21564565048 | ❌ Failed | https://github.com/kevin-mind/nopo/actions/runs/21564565048 | Triage ran twice - fixture didn't sync nopo-bot assignment |
| 2 | 21564642541 | ❌ Failed | https://github.com/kevin-mind/nopo/actions/runs/21564642541 | Same issue - side effects applied after execution |
| 3 | 21564697567 | ✅ Pass | https://github.com/kevin-mind/nopo/actions/runs/21564697567 | All 9 transitions verified |

## Full Flow Tests (Real Claude + Mock CI)

| # | Run ID | Outcome | Link | Notes |
|---|--------|---------|------|-------|

## Full E2E Tests (Real Claude + Real CI)

| # | Run ID | Outcome | Link | Notes |
|---|--------|---------|------|-------|
| 1 | 21558891072 | ❌ Failed | https://github.com/kevin-mind/nopo/actions/runs/21558891072 | No Claude CLI installed |
| 2 | 21558915189 | ⚠️ Cancelled | https://github.com/kevin-mind/nopo/actions/runs/21558915189 | ~6h timeout |
| 3 | 21564123421 | ⚠️ Cancelled | https://github.com/kevin-mind/nopo/actions/runs/21564123421 | Cancelled manually |

## Fixes Applied

1. Added `_e2e` label for cleanup
2. Fixed assignee setup in `setupGitHubState`
3. Fixed CI trigger logic (only for iterating/iteratingFix states)
4. Fixed fixture assignees in `04-processingCI.json` and `10-done.json`
5. Added Claude CLI installation for non-mock mode
6. Added fixture sync between transitions in continue mode (`syncFixtureWithAppliedSideEffects`)
7. Apply side effects BEFORE state machine execution, not after
