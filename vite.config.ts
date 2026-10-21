import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// npm run tauri:dev から起動されたとき（Tauri の CLI が TAURI_ENV_PLATFORM を渡す）
const tauriDev = process.env.TAURI_ENV_PLATFORM !== undefined

// 静的サイトとして出力する。base を相対にして、どこに置いても開けるようにする
// デスクトップ版（src-tauri/）も、この出力（dist/）をそのまま使う
export default defineConfig({
  base: './',
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // Tauri の CLI のエラーを消さないよう、画面を消さない
  clearScreen: !tauriDev,
  server: {
    // tauri dev は src-tauri/tauri.conf.json の devUrl（5173）を開くので、ほかのポートに逃げない
    strictPort: tauriDev,
    // Rust 側の変更（ビルド結果を含む）で画面を読み直さない
    watch: { ignored: ['**/src-tauri/**'] },
  },
})
