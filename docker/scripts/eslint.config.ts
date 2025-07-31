import tseslint from "typescript-eslint";
import eslint from "@eslint/js";
import globals from "globals";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";

export default tseslint.config(
  eslint.configs.recommended,
  eslintPluginPrettier,
  {
    ignores: ["build"],
  },
  {
    languageOptions: {
      globals: {
        ...globals.builtin,
        ...globals.node,
      },
    },
  },
);
