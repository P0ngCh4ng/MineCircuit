// 画面と jar を開く Worker の間でやりとりするメッセージの形

import type { JarContent, JarSummary } from '../io/modpack/jarScanner'

export interface JarScanRequest {
  readonly id: number
  readonly jar: string
  /**
   * jar の中身。ファイル全体か、画面側で必要な部分だけを読んで取り出したもの（圧縮されたまま）。
   * ファイルを読むのは画面側（Tauri のファイルの読み書きは Worker から呼べない）。展開と JSON の解釈は Worker で行う
   */
  readonly content: JarContent
}

export type JarScanResponse =
  | { readonly id: number; readonly ok: true; readonly summary: JarSummary }
  | { readonly id: number; readonly ok: false; readonly message: string }
