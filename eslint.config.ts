import "@total-typescript/ts-reset";
import { createEslintConfig } from "configs/eslint.config";
import { fileURLToPath } from "node:url";
import { includeIgnoreFile } from "@eslint/compat";
import { globby, fs, path } from "zx";

import pkgJson from "./package.json" assert { type: "json" };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const gitignorePath = path.resolve(__dirname, ".gitignore");

const workspaceGlobs = pkgJson.workspaces || [];

const workspaceIgnores = globby
  .sync(workspaceGlobs, {
    onlyDirectories: true,
    cwd: __dirname,
    absolute: false,
  })
  .map((workspaceDir) => {
    const configFile = path.resolve(workspaceDir, "eslint.config.ts");

    if (fs.existsSync(configFile)) {
      return workspaceDir;
    }
  })
  .filter(Boolean);

export default createEslintConfig(includeIgnoreFile(gitignorePath), {
  ignores: [
    "**/.react-router/**",
    "**/.turbo/**",
    "**/.vscode/**",
    "**/.git/**",
    "**/.node_modules/**",
    "**/.build/**",
    ...workspaceIgnores,
  ],
});
