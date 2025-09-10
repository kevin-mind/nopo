import { z } from "zod";
import { createExec } from "./lib.ts";

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
    const exec = createExec({ verbose: false });
    // Use a subshell to run synchronously via Atomics-style blocking using spawn is complex.
    // Instead, we execute with `bash -lc` to ensure argument spacing is preserved and then block using deasync-like pattern is overkill.
    // We'll approximate by throwing on failure and returning trimmed stdout using child_process spawnSync via an inline helper.
    const { spawnSync } = await import("node:child_process");
    const res = spawnSync("git", pieces, { encoding: "utf8" });
    if (res.status !== 0) {
      throw new Error(res.stderr || "git failed");
    }
    return String(res.stdout || "").trim();
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
