import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config.ts'

// テストは src の中（対象のファイルの隣）と tests/ の両方に置ける
// 画面の部品のテストのため、環境は happy-dom にする
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
      environment: 'happy-dom',
      // 計算の分岐の網羅率（docs/verification.md「4. コードの分岐」）。npm run coverage で測る
      coverage: {
        provider: 'v8',
        include: ['src/calc/create/**/*.ts'],
        exclude: ['src/calc/create/**/*.test.ts'],
        reporter: ['text-summary', 'json-summary', 'html'],
        // 下がらないようにする下限。目標は分岐 100%（#237）。上がったら、この値も上げる
        thresholds: { statements: 98, branches: 95, functions: 99, lines: 99 },
      },
    },
  }),
)
