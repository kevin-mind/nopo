import "@total-typescript/ts-reset";
import { fileURLToPath } from "node:url";
import { includeIgnoreFile } from "@eslint/compat";
import { globby, fs, path } from "zx";
import tseslint from "typescript-eslint";
import eslint from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import globals from "globals";

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

const config: ReturnType<typeof tseslint.config> = tseslint.config(
  eslint.configs.recommended,
  tseslint.configs.recommended,
  eslintPluginPrettier,
  includeIgnoreFile(gitignorePath),
  {
    ignores: [
      "**/.react-router/**",
      "**/.vscode/**",
      "**/.git/**",
      "**/.node_modules/**",
      "**/node_modules/**",
      "**/.build/**",
      ...workspaceIgnores,
    ],
  },
  {
    files: ["docker/scripts/**/*.js"],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    files: ["fly/**/*.js"],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
);

export default config;
