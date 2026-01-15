/**
 * Atomic Git CLI step generators.
 * Each function generates a Step that executes exactly ONE `git` CLI command.
 *
 * Naming convention: git<Subcommand> → git <subcommand>
 * - gitConfig → git config
 * - gitCheckout → git checkout
 * - gitPush → git push
 */

import { echoKeyValue, dedentString, type GeneratedWorkflowTypes } from "@github-actions-workflow-ts/lib";
import { ExtendedStep } from "../enhanced-step";
import { heredocOutput } from "./gh";

/** Optional step properties that can be added to any step (if, name override, etc.) */
export type StepProps = Omit<GeneratedWorkflowTypes.Step, 'id' | 'run' | 'uses' | 'env' | 'with'>;

// =============================================================================
// git config
// =============================================================================

/**
 * git config --global user.name/email - Configure git user
 * No outputs (action only)
 */
export function gitConfig(id: string, env: { USER_NAME: string; USER_EMAIL: string }, props?: StepProps): ExtendedStep<any, any> {
  return new ExtendedStep({
    id,
    ...props,
    name: "git config",
    env,
    run: dedentString(`
      git config --global user.name "$USER_NAME"
      git config --global user.email "$USER_EMAIL"
    `),
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
  props?: StepProps,
): ExtendedStep<any, any> {
  return new ExtendedStep({
    id,
    ...props,
    name: "git checkout -b",
    env,
    outputs: ["name", "existed"],
    run: dedentString(`
      if git show-ref --verify --quiet "refs/heads/$BRANCH_NAME"; then
        git checkout "$BRANCH_NAME"
        ${echoKeyValue.toGithubOutput("existed", "true")}
      elif git show-ref --verify --quiet "refs/remotes/origin/$BRANCH_NAME"; then
        git checkout -b "$BRANCH_NAME" "origin/$BRANCH_NAME"
        ${echoKeyValue.toGithubOutput("existed", "true")}
      else
        git checkout -b "$BRANCH_NAME"
        ${echoKeyValue.toGithubOutput("existed", "false")}
      fi
      ${echoKeyValue.toGithubOutput("name", "$BRANCH_NAME")}
    `),
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
  props?: StepProps,
): ExtendedStep<any, any> {
  return new ExtendedStep({
    id,
    ...props,
    name: "git checkout -b (with diff)",
    env,
    outputs: ["name", "existing_branch", "diff"],
    run: dedentString(`
      existing_branch="false"
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

      ${echoKeyValue.toGithubOutput("name", "$BRANCH_NAME")}
      ${echoKeyValue.toGithubOutput("existing_branch", "$existing_branch")}
      ${heredocOutput("diff", 'echo "$diff"')}
    `),
  });
}

// =============================================================================
// git status
// =============================================================================

/**
 * git status - Check working directory status
 * @outputs has_changes, is_clean
 */
export function gitStatus(id: string): ExtendedStep<any, any> {
  return new ExtendedStep({
    id,
    name: "git status",
    outputs: ["has_changes", "is_clean"],
    run: dedentString(`
      if git diff --quiet HEAD 2>/dev/null; then
        ${echoKeyValue.toGithubOutput("has_changes", "false")}
        ${echoKeyValue.toGithubOutput("is_clean", "true")}
      else
        ${echoKeyValue.toGithubOutput("has_changes", "true")}
        ${echoKeyValue.toGithubOutput("is_clean", "false")}
      fi
    `),
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
): ExtendedStep<any, any> {
  const ref = env?.REF ? '"$REF"' : "HEAD";

  return new ExtendedStep({
    id,
    name: "git diff",
    env,
    outputs: ["diff", "has_changes"],
    run: dedentString(`
      ${heredocOutput("diff", `git diff ${ref} --stat 2>/dev/null || echo ""`)}
      if git diff --quiet ${ref} 2>/dev/null; then
        ${echoKeyValue.toGithubOutput("has_changes", "false")}
      else
        ${echoKeyValue.toGithubOutput("has_changes", "true")}
      fi
    `),
  });
}

// =============================================================================
// git add
// =============================================================================

/**
 * git add -A - Stage all changes
 * No outputs (action only)
 */
export function gitAddAll(id: string): ExtendedStep<any, any> {
  return new ExtendedStep({
    id,
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
export function gitCommit(id: string, env: { MESSAGE: string }): ExtendedStep<any, any> {
  return new ExtendedStep({
    id,
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
export function gitPush(id: string, env?: { BRANCH?: string }): ExtendedStep<any, any> {
  const branch = env?.BRANCH ? '"$BRANCH"' : "HEAD";

  return new ExtendedStep({
    id,
    name: "git push",
    env,
    run: `git push origin ${branch}`,
  });
}
