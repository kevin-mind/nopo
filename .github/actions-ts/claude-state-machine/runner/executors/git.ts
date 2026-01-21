import * as core from "@actions/core";
import * as exec from "@actions/exec";
import type { CreateBranchAction, GitPushAction } from "../../schemas/index.js";
import type { RunnerContext } from "../runner.js";

// ============================================================================
// Git Executors
// ============================================================================

/**
 * Create a new branch
 */
export async function executeCreateBranch(
  action: CreateBranchAction,
  ctx: RunnerContext,
): Promise<{ created: boolean }> {
  // Check if branch already exists
  const checkResult = await ctx.octokit.rest.repos
    .getBranch({
      owner: ctx.owner,
      repo: ctx.repo,
      branch: action.branchName,
    })
    .catch(() => null);

  if (checkResult) {
    core.info(`Branch ${action.branchName} already exists`);
    return { created: false };
  }

  // Get the SHA of the base branch
  const baseRef = await ctx.octokit.rest.git.getRef({
    owner: ctx.owner,
    repo: ctx.repo,
    ref: `heads/${action.baseBranch}`,
  });

  // Create the branch
  await ctx.octokit.rest.git.createRef({
    owner: ctx.owner,
    repo: ctx.repo,
    ref: `refs/heads/${action.branchName}`,
    sha: baseRef.data.object.sha,
  });

  core.info(`Created branch ${action.branchName} from ${action.baseBranch}`);
  return { created: true };
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

  let stdout = "";
  let stderr = "";

  const exitCode = await exec.exec("git", args, {
    ignoreReturnCode: true,
    listeners: {
      stdout: (data) => {
        stdout += data.toString();
      },
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
