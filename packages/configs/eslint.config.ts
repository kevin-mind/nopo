import eslint from "@eslint/js";

import tseslint from "typescript-eslint";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";

export default function createEslintConfig(
  ...config: Parameters<typeof tseslint.config>
): ReturnType<typeof tseslint.config> {
  return tseslint.config(
    eslint.configs.recommended,
    tseslint.configs.recommended,
    eslintPluginPrettier,
    ...config,
  );
}
