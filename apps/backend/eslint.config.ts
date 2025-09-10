import createEslintConfig from '@more/configs/eslint';
import type { Linter } from 'eslint';

export default createEslintConfig(
  {
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
      },
    },
  },
  {
    files: ['assets/**/*.{js,ts}'],
    rules: {
      // Add any project-specific rules here
      'no-console': 'warn',
    },
  },
  {
    ignores: [
      'static/**',
      'build/**',
      'src/backend/**',
      'node_modules/**',
      '*.config.*',
    ],
  },
) as Linter.Config;
