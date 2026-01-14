#!/usr/bin/env bash
# Create or checkout implementation branch
# Inputs: BRANCH_NAME
# Outputs: name, existing_branch, diff
set -euo pipefail

git fetch origin
if git show-ref --verify --quiet refs/remotes/origin/$BRANCH_NAME; then
  echo "Existing branch found - checking out and rebasing on main"
  git checkout $BRANCH_NAME
  git pull origin $BRANCH_NAME
  # Rebase on main to stay up to date
  git rebase origin/main || {
    echo "Rebase failed - aborting and resetting to main"
    git rebase --abort
    git reset --hard origin/main
  }
  echo "existing_branch=true" >> $GITHUB_OUTPUT
  # Capture what's already been changed vs main
  {
    echo 'diff<<EOF'
    git diff origin/main --stat
    echo ""
    echo "Detailed changes:"
    git diff origin/main
    echo 'EOF'
  } >> $GITHUB_OUTPUT
else
  echo "Creating new branch from main"
  git checkout -b $BRANCH_NAME
  echo "existing_branch=false" >> $GITHUB_OUTPUT
  echo "diff=" >> $GITHUB_OUTPUT
fi
echo "name=$BRANCH_NAME" >> $GITHUB_OUTPUT
