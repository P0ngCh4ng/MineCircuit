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
      // 計算の分岐の網羅率（docs/create-verification.md「4. コードの分岐」）。npm run coverage で測る
      coverage: {
        provider: 'v8',
        // Crafts & Additions の電力（docs/createaddition-power.md）と、Create から移した TOML の読み方も同じ扱い（#276）
        // 水車が使う液体の広がり（src/calc/fluidFlow.ts、#279）も同じ扱い
        include: ['src/calc/create/**/*.ts', 'src/calc/createaddition/**/*.ts', 'src/calc/tomlSubset.ts', 'src/calc/fluidFlow.ts'],
        exclude: ['src/calc/create/**/*.test.ts', 'src/calc/createaddition/**/*.test.ts'],
        reporter: ['text-summary', 'json-summary', 'html'],
        // 下限は 100%。通せない分岐は、その場所に理由付きの印を付ける（docs/create-verification.md「4. コードの分岐」）
        thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
      },
    },
  }),
)
