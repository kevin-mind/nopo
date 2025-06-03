import { execSync } from "node:child_process";

export class GitInfo {
  static get repo(): string {
    return execSync("git remote get-url origin").toString().trim();
  }

  static get branch(): string {
    return execSync("git rev-parse --abbrev-ref HEAD").toString().trim();
  }

  static get commit(): string {
    return execSync("git rev-parse HEAD").toString().trim();
  }

  static parse() {
    return this;
  }
}
