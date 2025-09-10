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
}
