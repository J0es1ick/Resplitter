import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'data/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['scripts/*.cjs'],
    languageOptions: { globals: { require: 'readonly', console: 'readonly', process: 'readonly' } },
    rules: { '@typescript-eslint/no-require-imports': 'off' }
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error'
    }
  },
  {
    files: ['tests/**/*.ts'],
    rules: { '@typescript-eslint/no-floating-promises': 'off' }
  }
);
