import createEslintConfig, {
  globals,
} from "../../packages/configs/eslint.config";

export default createEslintConfig({
  files: ["**/*.{js,mjs,cjs,ts}"],
  languageOptions: {
    globals: globals.node,
  },
});
