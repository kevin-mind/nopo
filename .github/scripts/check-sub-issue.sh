#!/usr/bin/env bash
# Check if issue is a sub-issue and should skip triage
# Inputs: ISSUE_NUMBER
# Outputs: should_triage, issue_number, issue_title, issue_body
set -euo pipefail

echo "issue_number=$ISSUE_NUMBER" >> $GITHUB_OUTPUT

# Get issue details (needed for workflow_dispatch which doesn't have issue context)
issue_data=$(gh issue view "$ISSUE_NUMBER" --json title,body)
issue_title=$(echo "$issue_data" | jq -r '.title')
echo "issue_title=$issue_title" >> $GITHUB_OUTPUT

# Store body in a file to handle multiline content
echo "$issue_data" | jq -r '.body' > /tmp/issue_body.txt
{
  echo 'issue_body<<EOF'
  cat /tmp/issue_body.txt
  echo 'EOF'
} >> $GITHUB_OUTPUT

# Check 1: Title starts with [Sub] - this catches sub-issues immediately
# (before they're linked to parent, avoiding race condition)
if [[ "$issue_title" == "[Sub]"* ]]; then
  echo "Issue #$ISSUE_NUMBER has [Sub] prefix - skipping triage"
  echo "should_triage=false" >> $GITHUB_OUTPUT
  exit 0
fi

# Check 2: Issue has a parent (is already linked as sub-issue)
# Sub-issues should not be triaged - they're implementation tasks
parent=$(gh api graphql \
  -H "GraphQL-Features: sub_issues" \
  -f query='
    query($owner: String!, $repo: String!, $number: Int!) {
      repository(owner: $owner, name: $repo) {
        issue(number: $number) {
          parent { number }
        }
      }
    }
  ' \
  -f owner="${GITHUB_REPOSITORY_OWNER}" \
  -f repo="${GITHUB_REPOSITORY#*/}" \
  -F number="$ISSUE_NUMBER" \
  --jq '.data.repository.issue.parent.number // empty' 2>/dev/null || echo "")

if [[ -n "$parent" ]]; then
  echo "Issue #$ISSUE_NUMBER is a sub-issue of #$parent - skipping triage"
  echo "should_triage=false" >> $GITHUB_OUTPUT
else
  echo "Issue #$ISSUE_NUMBER is not a sub-issue - proceeding with triage"
  echo "should_triage=true" >> $GITHUB_OUTPUT
fi
