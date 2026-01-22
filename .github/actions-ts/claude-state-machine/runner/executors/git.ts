import * as core from "@actions/core";
import * as exec from "@actions/exec";
import type { CreateBranchAction, GitPushAction } from "../../schemas/index.js";
import type { RunnerContext } from "../runner.js";

// ============================================================================
// Git Executors
// ============================================================================

/**
 * Result of branch preparation
 */
interface BranchPrepareResult {
  created: boolean;
  checkedOut: boolean;
  rebased: boolean;
  pushed: boolean;
  /** If rebased=true and pushed=true, this signals the caller to stop (workflow will re-trigger) */
  shouldStop: boolean;
}

/**
 * Idempotent branch preparation
 *
 * Ensures a branch exists locally and is up-to-date with the base branch:
 * 1. Create branch if it doesn't exist (locally or remotely)
 * 2. Checkout the branch
 * 3. Attempt rebase on base branch if stale
 * 4. If rebased, push and signal to stop (CI will re-trigger)
 * 5. If no rebase needed, continue
 *
 * This guarantees work always happens on an up-to-date branch.
 */
export async function executeCreateBranch(
  action: CreateBranchAction,
  ctx: RunnerContext,
): Promise<BranchPrepareResult> {
  const result: BranchPrepareResult = {
    created: false,
    checkedOut: false,
    rebased: false,
    pushed: false,
    shouldStop: false,
  };

  // First, fetch the latest from origin to have accurate remote tracking info
  core.info(`Fetching latest from origin...`);
  await exec.exec("git", ["fetch", "origin"], { ignoreReturnCode: true });

  // Check if branch exists remotely
  const remoteBranchExists = await ctx.octokit.rest.repos
    .getBranch({
      owner: ctx.owner,
      repo: ctx.repo,
      branch: action.branchName,
    })
    .then(() => true)
    .catch(() => false);

  if (!remoteBranchExists) {
    // Branch doesn't exist remotely - create it from base branch
    core.info(
      `Branch ${action.branchName} doesn't exist remotely, creating from ${action.baseBranch}`,
    );

    // Get the SHA of the base branch
    const baseRef = await ctx.octokit.rest.git.getRef({
      owner: ctx.owner,
      repo: ctx.repo,
      ref: `heads/${action.baseBranch}`,
    });

    // Create the branch remotely
    await ctx.octokit.rest.git.createRef({
      owner: ctx.owner,
      repo: ctx.repo,
      ref: `refs/heads/${action.branchName}`,
      sha: baseRef.data.object.sha,
    });

    result.created = true;
    core.info(`Created remote branch ${action.branchName}`);

    // Fetch again to get the new branch
    await exec.exec("git", ["fetch", "origin"], { ignoreReturnCode: true });
  }

  // Now checkout the branch locally
  // First, try to checkout existing local branch
  let checkoutExitCode = await exec.exec(
    "git",
    ["checkout", action.branchName],
    { ignoreReturnCode: true },
  );

  if (checkoutExitCode !== 0) {
    // Local branch doesn't exist, create tracking branch from remote
    checkoutExitCode = await exec.exec(
      "git",
      ["checkout", "-b", action.branchName, `origin/${action.branchName}`],
      { ignoreReturnCode: true },
    );

    if (checkoutExitCode !== 0) {
      // Last resort: create from local base branch
      checkoutExitCode = await exec.exec(
        "git",
        ["checkout", "-b", action.branchName, `origin/${action.baseBranch}`],
        { ignoreReturnCode: true },
      );
    }
  }

  if (checkoutExitCode !== 0) {
    throw new Error(`Failed to checkout branch ${action.branchName}`);
  }

  result.checkedOut = true;
  core.info(`Checked out branch ${action.branchName}`);

  // Make sure we're tracking the remote
  await exec.exec(
    "git",
    ["branch", "--set-upstream-to", `origin/${action.branchName}`],
    { ignoreReturnCode: true },
  );

  // Check if we need to rebase on the base branch
  // Count commits that base branch has that we don't
  let commitsCount = "";
  await exec.exec(
    "git",
    ["rev-list", "--count", `HEAD..origin/${action.baseBranch}`],
    {
      ignoreReturnCode: true,
      listeners: {
        stdout: (data) => {
          commitsCount += data.toString();
        },
      },
    },
  );

  const commitsBehind = parseInt(commitsCount.trim(), 10) || 0;

  if (commitsBehind > 0) {
    core.info(
      `Branch is ${commitsBehind} commits behind origin/${action.baseBranch}, attempting rebase...`,
    );

    const rebaseExitCode = await exec.exec(
      "git",
      ["rebase", `origin/${action.baseBranch}`],
      { ignoreReturnCode: true },
    );

    if (rebaseExitCode !== 0) {
      // Rebase failed, abort and continue without rebase
      core.warning(`Rebase failed, aborting and continuing with current state`);
      await exec.exec("git", ["rebase", "--abort"], { ignoreReturnCode: true });
      // Continue without rebasing - let CI catch any conflicts
      return result;
    }

    result.rebased = true;
    core.info(`Successfully rebased on origin/${action.baseBranch}`);

    // Push the rebased changes
    const pushExitCode = await exec.exec(
      "git",
      ["push", "origin", action.branchName, "--force-with-lease"],
      { ignoreReturnCode: true },
    );

    if (pushExitCode === 0) {
      result.pushed = true;
      result.shouldStop = true;
      core.info(
        `Pushed rebased changes. Stopping execution - CI will re-trigger with up-to-date branch.`,
      );
    } else {
      core.warning(`Failed to push rebased changes, continuing anyway`);
    }
  } else {
    core.info(`Branch is up-to-date with origin/${action.baseBranch}`);
  }

  return result;
}

/**
 * Push commits to a branch
 * Note: This assumes the code is running in a git repository context
 */
export async function executeGitPush(
  action: GitPushAction,
  _ctx: RunnerContext,
): Promise<{ pushed: boolean }> {
  const args = ["push", "origin", action.branchName];
  if (action.force) {
    args.push("--force");
  }

  let stderr = "";

  const exitCode = await exec.exec("git", args, {
    ignoreReturnCode: true,
    listeners: {
      stderr: (data) => {
        stderr += data.toString();
      },
    },
  });

  if (exitCode !== 0) {
    core.warning(`Git push failed: ${stderr}`);
    return { pushed: false };
  }

  core.info(`Pushed to ${action.branchName}`);
  return { pushed: true };
}

/**
 * Checkout a branch
 */
export async function checkoutBranch(branchName: string): Promise<boolean> {
  let stderr = "";

  const exitCode = await exec.exec("git", ["checkout", branchName], {
    ignoreReturnCode: true,
    listeners: {
      stderr: (data) => {
        stderr += data.toString();
      },
    },
  });

  if (exitCode !== 0) {
    core.warning(`Git checkout failed: ${stderr}`);
    return false;
  }

  core.info(`Checked out branch ${branchName}`);
  return true;
}

/**
 * Create or checkout a branch
 */
export async function createOrCheckoutBranch(
  branchName: string,
  baseBranch: string = "main",
): Promise<boolean> {
  // Try to checkout first
  let exitCode = await exec.exec("git", ["checkout", branchName], {
    ignoreReturnCode: true,
  });

  if (exitCode === 0) {
    core.info(`Checked out existing branch ${branchName}`);
    return true;
  }

  // Create from base branch
  exitCode = await exec.exec(
    "git",
    ["checkout", "-b", branchName, `origin/${baseBranch}`],
    {
      ignoreReturnCode: true,
    },
  );

  if (exitCode === 0) {
    core.info(`Created and checked out branch ${branchName}`);
    return true;
  }

  core.warning(`Failed to create or checkout branch ${branchName}`);
  return false;
}

/**
 * Get current branch name
 */
export async function getCurrentBranch(): Promise<string | null> {
  let stdout = "";

  const exitCode = await exec.exec(
    "git",
    ["rev-parse", "--abbrev-ref", "HEAD"],
    {
      ignoreReturnCode: true,
      listeners: {
        stdout: (data) => {
          stdout += data.toString();
        },
      },
    },
  );

  if (exitCode !== 0) {
    return null;
  }

  return stdout.trim();
}

/**
 * Get current commit SHA
 */
export async function getCurrentSha(): Promise<string | null> {
  let stdout = "";

  const exitCode = await exec.exec("git", ["rev-parse", "HEAD"], {
    ignoreReturnCode: true,
    listeners: {
      stdout: (data) => {
        stdout += data.toString();
      },
    },
  });

  if (exitCode !== 0) {
    return null;
  }

  return stdout.trim();
}

/**
 * Check if there are uncommitted changes
 */
export async function hasUncommittedChanges(): Promise<boolean> {
  let stdout = "";

  await exec.exec("git", ["status", "--porcelain"], {
    listeners: {
      stdout: (data) => {
        stdout += data.toString();
      },
    },
  });

  return stdout.trim().length > 0;
}

/**
 * Stage all changes
 */
export async function stageAllChanges(): Promise<boolean> {
  const exitCode = await exec.exec("git", ["add", "-A"], {
    ignoreReturnCode: true,
  });
  return exitCode === 0;
}

/**
 * Commit changes
 */
export async function commit(message: string): Promise<boolean> {
  const exitCode = await exec.exec("git", ["commit", "-m", message], {
    ignoreReturnCode: true,
  });
  return exitCode === 0;
}

/**
 * Fetch from remote
 */
export async function fetch(remote: string = "origin"): Promise<boolean> {
  const exitCode = await exec.exec("git", ["fetch", remote], {
    ignoreReturnCode: true,
  });
  return exitCode === 0;
}

/**
 * Rebase on a branch
 */
export async function rebase(branch: string): Promise<boolean> {
  const exitCode = await exec.exec("git", ["rebase", branch], {
    ignoreReturnCode: true,
  });
  return exitCode === 0;
}
