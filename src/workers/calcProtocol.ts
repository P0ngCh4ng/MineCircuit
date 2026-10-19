// 計算の Worker と画面の間でやりとりするメッセージ。どれも structured clone で送れる素のデータ。

import type { BlueprintSnapshot } from '../calc/blueprintSnapshot'
import type { PluginOutcome } from '../calc/pluginRegistry'
import type { VirtualPort } from '../calc/virtualPort'

/** Worker に渡す Modpack の情報。中身（設定ファイル）は必要になったときに画面側へ問い合わせる */
export interface PackInfo {
  /** 設計図に出てくる namespace のうち、Modpack にあるもの */
  readonly namespaces: readonly string[]
}

/** 画面 → Worker */
export type ToCalcWorker =
  | {
      readonly type: 'run'
      readonly requestId: number
      readonly blueprint: BlueprintSnapshot
      readonly ports: readonly VirtualPort[]
      /** Modpack がなければ null */
      readonly pack: PackInfo | null
    }
  | {
      /** 'config' の返事 */
      readonly type: 'config-reply'
      readonly callId: number
      readonly text: string | null
      /** 読めなかったときの理由 */
      readonly error?: string
    }
  | {
      /** 'list' の返事 */
      readonly type: 'list-reply'
      readonly callId: number
      readonly entries: readonly string[]
      /** 読めなかったときの理由 */
      readonly error?: string
    }

/** Worker → 画面 */
export type FromCalcWorker =
  | { readonly type: 'result'; readonly requestId: number; readonly outcomes: PluginOutcome[] }
  | { readonly type: 'failed'; readonly requestId: number; readonly message: string }
  | {
      /** プラグインが Modpack の設定ファイルを読みたい */
      readonly type: 'config'
      /** どの計算から読みたいか */
      readonly requestId: number
      readonly callId: number
      readonly path: string
    }
  | {
      /** プラグインが Modpack のフォルダの中の一覧を見たい（saves/ など） */
      readonly type: 'list'
      readonly requestId: number
      readonly callId: number
      readonly path: string
    }
