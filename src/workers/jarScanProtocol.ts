// 画面と jar を開く Worker の間でやりとりするメッセージの形

import type { JarSummary } from '../io/modpack/jarScanner'

export interface JarScanRequest {
  readonly id: number
  readonly jar: string
  readonly bytes: Uint8Array
}

export type JarScanResponse =
  | { readonly id: number; readonly ok: true; readonly summary: JarSummary }
  | { readonly id: number; readonly ok: false; readonly message: string }
