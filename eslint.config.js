import { defineConfig } from 'eslint/config'
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import pluginVue from 'eslint-plugin-vue'
import globals from 'globals'
import layerDependency from './eslint-rules/layer-dependency.js'

export default defineConfig(
  { ignores: ['dist/', 'node_modules/', 'prototype/', '.agents/', 'coverage/'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  // 書き方の好みに関わる規則は入れず、誤りを見つける規則だけを使う
  pluginVue.configs['flat/essential'],
  {
    files: ['**/*.vue'],
    languageOptions: { parserOptions: { parser: tseslint.parser } },
  },
  {
    languageOptions: { globals: { ...globals.browser } },
    plugins: { minecircuit: { rules: { 'layer-dependency': layerDependency } } },
    rules: {
      // 層と依存の向き（CLAUDE.md「フォルダ構成」）
      'minecircuit/layer-dependency': 'error',
      // any を使わない（CLAUDE.md「コードの書き方」）
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // 設定ファイル、Lint のルール、テストは Node で動く
    files: ['*.config.{js,ts}', 'eslint-rules/**', 'tests/**', 'src/**/*.test.ts'],
    languageOptions: { globals: { ...globals.node } },
  },
)
