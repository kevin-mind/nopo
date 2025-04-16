import { createEslintConfig } from "configs/eslint.config";

export default createEslintConfig([
  {
    ignores: ["templates/**"],
  },
]);
