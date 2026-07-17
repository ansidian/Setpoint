import js from '@eslint/js'
import globals from 'globals'
import importPlugin from 'eslint-plugin-import'
import reactPlugin from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'dist-demo', '.claude', '.playwright-cli', '.playwright-mcp', 'playwright-report', 'docs/']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [js.configs.recommended, reactHooks.configs.flat.recommended, reactRefresh.configs.vite],
    plugins: {
      import: importPlugin,
      react: reactPlugin,
    },
    languageOptions: {
      ecmaVersion: 'latest',
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    settings: {
      'import/extensions': ['.js', '.jsx', '.ts', '.tsx'],
      'import/parsers': {
        [tseslint.parser.meta.name]: ['.ts', '.tsx'],
      },
      'import/resolver': {
        alias: {
          map: [['@', './src']],
          extensions: ['.js', '.jsx', '.ts', '.tsx'],
        },
      },
    },
    rules: {
      'import/named': 'error',
      'import/no-unresolved': ['error', { ignore: ['\\?'] }],
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]', destructuredArrayIgnorePattern: '^_', argsIgnorePattern: '^_' }],
      'react/jsx-no-undef': 'error',
    },
  },
  {
    files: ['server/**/*.js'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ['vite.config.js'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ['playwright.config.js', 'e2e/**/*.js'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ['**/*.test.js', '**/*.test.ts'],
    rules: {
      'import/no-unresolved': ['error', { ignore: ['\\?', '^node:'] }],
    },
  },
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended, reactHooks.configs.flat.recommended, reactRefresh.configs.vite],
    plugins: {
      import: importPlugin,
      react: reactPlugin,
    },
    languageOptions: {
      ecmaVersion: 'latest',
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    settings: {
      'import/extensions': ['.js', '.jsx', '.ts', '.tsx', '.mts', '.cts'],
      'import/parsers': {
        [tseslint.parser.meta.name]: ['.ts', '.tsx', '.mts', '.cts'],
      },
      'import/resolver': {
        alias: {
          map: [['@', './src']],
          extensions: ['.js', '.jsx', '.ts', '.tsx', '.mts', '.cts'],
        },
      },
    },
    rules: {
      'import/named': 'error',
      'import/no-unresolved': ['error', { ignore: ['\\?', '^node:'] }],
      'no-unused-vars': 'off',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]', destructuredArrayIgnorePattern: '^_', argsIgnorePattern: '^_' }],
      'react/jsx-no-undef': 'error',
    },
  },
  {
    files: ['server/**/*.{ts,tsx,mts,cts}', 'scripts/**/*.{ts,tsx,mts,cts}', 'e2e/**/*.{ts,tsx,mts,cts}', '*.{ts,mts,cts}'],
    languageOptions: {
      globals: globals.node,
    },
  },
])
