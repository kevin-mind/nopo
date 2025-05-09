import createEslintConfig, { globals } from "../configs/eslint.config";

export default createEslintConfig({
  files: ["**/*.js"],
  languageOptions: {
    globals: { ...globals.node },
  },
});
