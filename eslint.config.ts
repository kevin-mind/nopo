import "@total-typescript/ts-reset";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import { includeIgnoreFile } from "@eslint/compat";
import { glob } from "glob";
import tseslint from "typescript-eslint";
import eslint from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import globals from "globals";

import pkgJson from "./package.json" assert { type: "json" };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const gitignorePath = path.resolve(__dirname, ".gitignore");

const workspaceGlobs = pkgJson.workspaces || [];

// Use glob to find workspace directories
const workspaceIgnores = workspaceGlobs
  .flatMap((pattern) =>
    glob.sync(pattern, {
      cwd: __dirname,
      absolute: false,
    }),
  )
  .filter((workspaceDir) => {
    // Check if it's a directory
    const fullPath = path.resolve(__dirname, workspaceDir);
    if (!fs.statSync(fullPath).isDirectory()) return false;

    // Check if it has an eslint config
    const configFile = path.resolve(fullPath, "eslint.config.ts");
    return fs.existsSync(configFile);
  });

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
    files: ["nopo/scripts/**/*.js"],
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
