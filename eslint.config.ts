import path from "node:path";
import { fileURLToPath } from "node:url";
import eslint from "@eslint/js";
import { includeIgnoreFile } from "@eslint/compat";

import tseslint from "typescript-eslint";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const gitignorePath = path.resolve(__dirname, ".gitignore");

export default tseslint.config(
  includeIgnoreFile(gitignorePath),
  eslint.configs.recommended,
  tseslint.configs.recommended,
  eslintPluginPrettier,
  {
    ignores: [
      "**/.react-router/**",
      "**/.turbo/**",
      "**/.vscode/**",
      "**/.git/**",
      "**/.node_modules/**",
      "**/.build/**",
    ],
  },
);
