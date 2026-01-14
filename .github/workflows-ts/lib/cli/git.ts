/**
 * Atomic Git CLI step generators.
 * Each function generates a Step that executes exactly ONE `git` CLI command.
 *
 * Naming convention: git<Subcommand> → git <subcommand>
 * - gitConfig → git config
 * - gitCheckout → git checkout
 * - gitPush → git push
 */

import { Step } from "@github-actions-workflow-ts/lib";

// =============================================================================
// git config
// =============================================================================

/**
 * git config --global user.name/email - Configure git user
 * No outputs (action only)
 */
export function gitConfig(env: { USER_NAME: string; USER_EMAIL: string }): Step {
  return new Step({
    name: "git config",
    env,
    run: `git config --global user.name "$USER_NAME"
git config --global user.email "$USER_EMAIL"`,
  });
}

// =============================================================================
// git checkout
// =============================================================================

/**
 * git checkout -b - Create and checkout branch
 * @outputs name (branch name), existed (whether branch already existed)
 */
export function gitCheckoutBranch(
  id: string,
  env: {
    BRANCH_NAME: string;
  },
): Step {
  return new Step({
    id,
    name: "git checkout -b",
    env,
    run: `if git show-ref --verify --quiet "refs/heads/$BRANCH_NAME"; then
  git checkout "$BRANCH_NAME"
  echo "existed=true" >> $GITHUB_OUTPUT
elif git show-ref --verify --quiet "refs/remotes/origin/$BRANCH_NAME"; then
  git checkout -b "$BRANCH_NAME" "origin/$BRANCH_NAME"
  echo "existed=true" >> $GITHUB_OUTPUT
else
  git checkout -b "$BRANCH_NAME"
  echo "existed=false" >> $GITHUB_OUTPUT
fi
echo "name=$BRANCH_NAME" >> $GITHUB_OUTPUT`,
  });
}

/**
 * git checkout -b (with diff) - Create/checkout branch and capture diff from main
 * @outputs name, existing_branch, diff
 */
export function gitCheckoutBranchWithDiff(
  id: string,
  env: {
    BRANCH_NAME: string;
  },
): Step {
  return new Step({
    id,
    name: "git checkout -b (with diff)",
    env,
    run: `existing_branch="false"
diff=""

if git show-ref --verify --quiet "refs/heads/$BRANCH_NAME"; then
  git checkout "$BRANCH_NAME"
  existing_branch="true"
  diff=$(git diff main.."$BRANCH_NAME" --stat 2>/dev/null || echo "")
elif git show-ref --verify --quiet "refs/remotes/origin/$BRANCH_NAME"; then
  git checkout -b "$BRANCH_NAME" "origin/$BRANCH_NAME"
  existing_branch="true"
  diff=$(git diff main.."$BRANCH_NAME" --stat 2>/dev/null || echo "")
else
  git checkout -b "$BRANCH_NAME"
  existing_branch="false"
fi

echo "name=$BRANCH_NAME" >> $GITHUB_OUTPUT
echo "existing_branch=$existing_branch" >> $GITHUB_OUTPUT
{
  echo 'diff<<EOF'
  echo "$diff"
  echo 'EOF'
} >> $GITHUB_OUTPUT`,
  });
}

// =============================================================================
// git status
// =============================================================================

/**
 * git status - Check working directory status
 * @outputs has_changes, is_clean
 */
export function gitStatus(id: string): Step {
  return new Step({
    id,
    name: "git status",
    run: `if git diff --quiet HEAD 2>/dev/null; then
  echo "has_changes=false" >> $GITHUB_OUTPUT
  echo "is_clean=true" >> $GITHUB_OUTPUT
else
  echo "has_changes=true" >> $GITHUB_OUTPUT
  echo "is_clean=false" >> $GITHUB_OUTPUT
fi`,
  });
}

// =============================================================================
// git diff
// =============================================================================

/**
 * git diff - Get diff output
 * @outputs diff (multiline), has_changes
 */
export function gitDiff(
  id: string,
  env?: {
    REF?: string;
  },
): Step {
  const ref = env?.REF ? '"$REF"' : "HEAD";

  return new Step({
    id,
    name: "git diff",
    env,
    run: `{
  echo 'diff<<EOF'
  git diff ${ref} --stat 2>/dev/null || echo ""
  echo 'EOF'
} >> $GITHUB_OUTPUT
if git diff --quiet ${ref} 2>/dev/null; then
  echo "has_changes=false" >> $GITHUB_OUTPUT
else
  echo "has_changes=true" >> $GITHUB_OUTPUT
fi`,
  });
}

// =============================================================================
// git add
// =============================================================================

/**
 * git add -A - Stage all changes
 * No outputs (action only)
 */
export function gitAddAll(): Step {
  return new Step({
    name: "git add -A",
    run: `git add -A`,
  });
}

// =============================================================================
// git commit
// =============================================================================

/**
 * git commit - Create a commit
 * No outputs (action only)
 */
export function gitCommit(env: { MESSAGE: string }): Step {
  return new Step({
    name: "git commit",
    env,
    run: `git commit -m "$MESSAGE"`,
  });
}

// =============================================================================
// git push
// =============================================================================

/**
 * git push - Push to remote
 * No outputs (action only)
 */
export function gitPush(env?: { BRANCH?: string }): Step {
  const branch = env?.BRANCH ? '"$BRANCH"' : "HEAD";

  return new Step({
    name: "git push",
    env,
    run: `git push origin ${branch}`,
  });
}
