import { z } from "zod";
import { execSync } from "node:child_process";

const ParsedGitInfo = z.object({
  repo: z.string(),
  branch: z.string(),
  commit: z.string(),
});

export class GitInfo {
  static exists() {
    try {
      this.git("--version");
      return true;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (error) {
      return false;
    }
  }
  static git(command) {
    return execSync(`git ${command}`, { stdio: "ignore" }).toString().trim();
  }

  static get repo() {
    return this.git("remote get-url origin");
  }

  static get branch() {
    return this.git("rev-parse --abbrev-ref HEAD");
  }

  static get commit() {
    return this.git("rev-parse HEAD");
  }

  static parse() {
    return ParsedGitInfo.parse(this);
  }
}
