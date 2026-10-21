// ブラウザ版とデスクトップ版（Tauri）のどちらで動いているかを調べる。
// この判定をしてよいのは view/platform/ だけ（CLAUDE.md「フォルダ構成」）。
// io・edit・analysis・calc は、どちらで動いているかを知らないままにする。
import { isTauri } from '@tauri-apps/api/core'

/** 動いている場所。'browser' はブラウザ版、'desktop' は Tauri で包んだデスクトップ版 */
export type Platform = 'browser' | 'desktop'

/**
 * デスクトップ版（Tauri の WebView の中）で動いていれば true。
 * Tauri が WebView に置く目印（globalThis.isTauri）を見るだけなので、ブラウザで呼んでもよい。
 */
export function isDesktop(): boolean {
  return isTauri()
}

/** 動いている場所を返す */
export function currentPlatform(): Platform {
  return isDesktop() ? 'desktop' : 'browser'
}
