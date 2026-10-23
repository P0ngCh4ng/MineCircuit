// 見た目の Worker と画面の間でやりとりするメッセージ。どれも structured clone で送れる素のデータ。
//
// ファイルを読むのは画面側だけ（デスクトップ版の Tauri のファイルの API は Worker から呼べないため）。
// Worker はモデルの解決・PNG の展開・アトラス作りを行い、資産のファイルが要るたびに 'read' で画面側へ頼む。

import type { AppearanceSet } from '../domain/blockModel'

/** 送るためのブロック状態 */
export interface BlockStateData {
  readonly id: string
  readonly properties: Readonly<Record<string, string>>
}

/** 画面 → Worker */
export type ToAppearanceWorker =
  | {
      readonly type: 'prepare'
      readonly requestId: number
      readonly states: readonly BlockStateData[]
    }
  | {
      /** 'read' の返事（1つのファイル）。bytes の buffer は移す */
      readonly type: 'read-reply'
      readonly callId: number
      /** ないときは null */
      readonly bytes: Uint8Array | null
      /** 読めなかったときの理由 */
      readonly error?: string
    }

/** Worker → 画面 */
export type FromAppearanceWorker =
  | {
      /** 用意できた見た目。atlas.pixels の buffer は移す */
      readonly type: 'result'
      readonly requestId: number
      readonly set: AppearanceSet
    }
  | { readonly type: 'failed'; readonly requestId: number; readonly message: string }
  | {
      /** 資産のファイルを読みたい。同じ時に頼むものはまとめて送る（画面側の jar の部分読みをまとめるため） */
      readonly type: 'read'
      readonly calls: readonly { readonly callId: number; readonly path: string }[]
    }
