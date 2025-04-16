import eslint from "@eslint/js";

import tseslint, { type Config } from "typescript-eslint";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";

const baseConfig = tseslint.config(
  eslint.configs.recommended,
  tseslint.configs.recommended,
  eslintPluginPrettier,
);

export function createEslintConfig(...config: Parameters<typeof tseslint.config>) {
  return tseslint.config(baseConfig, config);
}

export default baseConfig;
