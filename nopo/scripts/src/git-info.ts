import { z } from "zod";
import { $ } from "./lib.ts";

const ParsedGitInfo = z.object({
  repo: z.string(),
  branch: z.string(),
  commit: z.string(),
});

export type GitInfoType = z.infer<typeof ParsedGitInfo>;

export class GitInfo {
  static exists(): boolean {
    try {
      this.git("--version");
      return true;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (error) {
      return false;
    }
  }

  static git(...pieces: string[]): string {
    return $.sync`git ${pieces}`.stdout.trim();
  }

  static get repo(): string {
    return this.git("remote", "get-url", "origin");
  }

  static get branch(): string {
    return this.git("rev-parse", "--abbrev-ref", "HEAD");
  }

  static get commit(): string {
    return this.git("rev-parse", "HEAD");
  }

  static parse(): GitInfoType {
    return ParsedGitInfo.parse({
      repo: this.repo,
      branch: this.branch,
      commit: this.commit,
    });
  }

  /**
   * Get the default branch name (typically "main" or "master").
   * Uses git symbolic-ref to find the remote HEAD reference.
   * Falls back to "main" if unable to determine.
   */
  static getDefaultBranch(): string {
    try {
      // Try to get the default branch from the remote HEAD
      const ref = this.git("symbolic-ref", "refs/remotes/origin/HEAD");
      // Extract branch name from refs/remotes/origin/main -> main
      const match = ref.match(/refs\/remotes\/origin\/(.+)/);
      if (match && match[1]) {
        return match[1];
      }
    } catch {
      // Ignore errors, fall back to common defaults
    }

    // Try common default branch names
    try {
      // Check if 'main' exists
      this.git("rev-parse", "--verify", "origin/main");
      return "main";
    } catch {
      // Try 'master' as fallback
      try {
        this.git("rev-parse", "--verify", "origin/master");
        return "master";
      } catch {
        // Default to 'main' if nothing works
        return "main";
      }
    }
  }

  /**
   * Get the list of files that have changed compared to a reference.
   * @param since - Git reference to compare against (branch, commit, tag)
   * @returns Array of file paths relative to the repository root
   */
  static getChangedFiles(since: string): string[] {
    try {
      // Get the merge base between the current HEAD and the reference
      // This handles cases where the branch has diverged from the reference
      const mergeBase = this.git("merge-base", since, "HEAD");
      const output = this.git("diff", "--name-only", mergeBase, "HEAD");
      if (!output) return [];
      return output.split("\n").filter((line) => line.length > 0);
    } catch {
      // If merge-base fails (e.g., no common ancestor), fall back to direct diff
      try {
        const output = this.git("diff", "--name-only", since, "HEAD");
        if (!output) return [];
        return output.split("\n").filter((line) => line.length > 0);
      } catch {
        // If all else fails, return empty array (no changes detected)
        return [];
      }
    }
  }
}
