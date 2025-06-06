import { execSync } from "node:child_process";

interface ParsedGitInfo {
  repo: string;
  branch: string;
  commit: string;
}

export class GitInfo {
  static git(command: string, fallback: string = "") {
    try {
      return execSync(`git ${command}`).toString().trim();
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (_error) {
      console.warn(
        `Git command 'git ${command}' failed, using fallback: ${fallback}`,
      );
      return fallback;
    }
  }

  static repo(fallback?: string): string {
    return this.git("remote get-url origin", fallback);
  }

  static branch(fallback?: string): string {
    return this.git("rev-parse --abbrev-ref HEAD", fallback);
  }

  static commit(fallback?: string): string {
    return this.git("rev-parse HEAD", fallback);
  }

  static parse(defaults: Partial<ParsedGitInfo>): ParsedGitInfo {
    return {
      repo: this.repo(defaults.repo),
      branch: this.branch(defaults.branch),
      commit: this.commit(defaults.commit),
    };
  }
}
