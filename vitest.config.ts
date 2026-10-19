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
    },
  }),
)
