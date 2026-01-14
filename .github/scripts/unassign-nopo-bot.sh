#!/usr/bin/env bash
# Unassign nopo-bot from an issue on failure
# Inputs: ISSUE_NUMBER
set -euo pipefail

echo "Implementation failed - unassigning nopo-bot from issue #$ISSUE_NUMBER"
gh issue edit "$ISSUE_NUMBER" --remove-assignee "nopo-bot"
# Note: Partial work (if any) was already saved by the salvage step above
