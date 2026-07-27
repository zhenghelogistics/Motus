const js = require('@eslint/js')
const globals = require('globals')
const react = require('eslint-plugin-react')
const reactHooks = require('eslint-plugin-react-hooks')

module.exports = [
  { ignores: ['frontend/dist/**', 'frontend/node_modules/**', 'node_modules/**'] },

  // Backend — Node, CommonJS
  {
    files: ['api/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: true }], // catch (_) {} is used deliberately throughout for optional/best-effort steps
    },
  },

  // Frontend — React, ESM, browser
  {
    files: ['frontend/src/**/*.{js,jsx}'],
    plugins: { react, 'react-hooks': reactHooks },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser },
    },
    settings: { react: { version: 'detect' } },
    rules: {
      ...js.configs.recommended.rules,
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: true }], // catch (_) {} is used deliberately throughout for optional/best-effort steps
      'react/prop-types': 'off', // this codebase doesn't use prop-types anywhere
      'react/react-in-jsx-scope': 'off', // React 18 JSX runtime doesn't need it
      'react/no-unescaped-entities': 'off', // lots of legitimate apostrophes in copy text
    },
  },
]
