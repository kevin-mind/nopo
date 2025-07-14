import { z } from "zod";
import { $ } from "zx";

const ParsedGitInfo = z.object({
  repo: z.string(),
  branch: z.string(),
  commit: z.string(),
});

export type GitInfoType = z.infer<typeof ParsedGitInfo>;

export class GitInfo {
  git(...pieces: string[]): string {
    return $.sync`git ${pieces}`.stdout.trim();
  }

  get repo(): string {
    return this.git("remote", "get-url", "origin");
  }

  get branch(): string {
    return this.git("rev-parse", "--abbrev-ref", "HEAD");
  }

  get commit(): string {
    return this.git("rev-parse", "HEAD");
  }

  static parse(
    input: z.infer<typeof ParsedGitInfo> | null = new GitInfo(),
  ): GitInfoType {
    return ParsedGitInfo.parse(input);
  }
}
