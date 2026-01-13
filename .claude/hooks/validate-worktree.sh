#!/usr/bin/env bash
# Validate that Claude is running in a git worktree (not the main repo)
# No-ops in CI environments

# Skip validation in CI
if [ "${CI:-}" = "true" ]; then
  exit 0
fi

# Check if we're in a git repository
if ! git rev-parse --is-inside-work-tree &>/dev/null; then
  exit 0
fi

# Get the git directory path
git_dir=$(git rev-parse --git-dir 2>/dev/null)

# In a worktree, .git is a file pointing to the main repo's .git/worktrees/<name>
# In the main repo, .git is a directory
if [ -d "$git_dir" ] && [ "$git_dir" = ".git" ]; then
  # We're in the main repo (not a worktree)
  current_branch=$(git branch --show-current 2>/dev/null)
  repo_root=$(pwd)

  echo ""
  echo "WARNING: You are working in the main repository, not a worktree."
  echo ""
  echo "For parallel development, it's recommended to use git worktrees:"
  echo ""
  echo "  make worktree issue=<number>"
  echo "  cd ../nopo-issue-<number>"
  echo "  claude"
  echo ""
  echo "Current location: $repo_root"
  echo "Current branch: $current_branch"
  echo ""
fi
