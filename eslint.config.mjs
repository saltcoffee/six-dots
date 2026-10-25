import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['main.js', 'dist/**', 'docs/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ['scripts/**/*.mjs'], languageOptions: { globals: { process: 'readonly', Buffer: 'readonly' } } },
  { files: ['src/domain/**/*.ts'], rules: {
    'no-restricted-imports': ['error', { patterns: ['obsidian', '@codemirror/*', '@lezer/*', '../editor/*', '../ui/*', '../obsidian/*'] }],
  } },
);
