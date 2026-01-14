#!/usr/bin/env bash
# Salvage partial progress by committing and pushing any uncommitted changes
# Inputs: ISSUE_NUMBER, JOB_STATUS, BRANCH_NAME, GITHUB_SERVER_URL, GITHUB_REPOSITORY
set -euo pipefail

# Check if there are uncommitted changes
if ! git diff --quiet HEAD 2>/dev/null; then
  echo "Uncommitted changes detected - salvaging partial progress"

  git add -A
  git commit -m "WIP: Partial implementation of #$ISSUE_NUMBER

Implementation was interrupted ($JOB_STATUS).
See issue comments for details on what was completed."

  git push origin HEAD

  # Comment on issue explaining partial progress
  gh issue comment "$ISSUE_NUMBER" --body "⚠️ **Implementation partially completed**

The job was interrupted before finishing. Progress has been saved to branch \`$BRANCH_NAME\`.

**Next steps:**
- Review the partial changes on the branch
- Re-assign nopo-bot to continue implementation

[View partial work](${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/compare/main...$BRANCH_NAME)"
else
  echo "No uncommitted changes to salvage"
fi
