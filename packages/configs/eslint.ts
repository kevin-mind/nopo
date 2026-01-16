import eslint from "@eslint/js";

import globals from "globals";

import tseslint from "typescript-eslint";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";

export { globals };

export default function createEslintConfig(
  ...config: Parameters<typeof tseslint.config>
): ReturnType<typeof tseslint.config> {
  return tseslint.config(
    eslint.configs.recommended,
    tseslint.configs.recommended,
    eslintPluginPrettier,
    {
      ignores: ["**/dist/**", "**/build/**", "**/.build/**"],
    },
    {
      languageOptions: {
        globals: {
          ...globals.builtin,
          console: "readonly",
        },
      },
    },
    ...config,
  );
}
