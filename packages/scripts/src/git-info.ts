import { execSync } from "node:child_process";

export interface ParsedGitInfo {
  repo: string;
  branch: string;
  commit: string;
}

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
  static git(command: string) {
    return execSync(`git ${command}`, { stdio: "ignore" }).toString().trim();
  }

  static get repo(): string {
    return this.git("remote get-url origin");
  }

  static get branch(): string {
    return this.git("rev-parse --abbrev-ref HEAD");
  }

  static get commit(): string {
    return this.git("rev-parse HEAD");
  }

  static parse(): ParsedGitInfo {
    return this;
  }
}
