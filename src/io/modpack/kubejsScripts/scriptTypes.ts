// KubeJS のスクリプトを動かして、レシピとタグを集めるときの入れ物（docs/design.md「KubeJS のスクリプトを動かす」）。
// Worker とやりとりするので、どれもただのデータだけにする。

import type { ItemTagFiles } from '../itemTags'
import type { ProcessingRecipe } from '../recipes'

/** kubejs/server_scripts/ のスクリプト1つ */
export interface KubeJsScriptFile {
  /** server_scripts/ からのパス（`recipes/create/milling.js`） */
  readonly path: string
  readonly text: string
}

/** スクリプトを動かすのに渡すもの */
export interface ScriptRunInput {
  /** 動かす順に並べたスクリプト（scriptFiles.ts の orderScripts） */
  readonly files: readonly KubeJsScriptFile[]
  /** jar と kubejs/data のレシピ（スクリプトが消す・置き換える相手） */
  readonly recipes: readonly ProcessingRecipe[]
  /** jar と kubejs/data のアイテムのタグ（入れ子はたどっていないもの） */
  readonly itemTags: ItemTagFiles
  /** Modpack の Mod の ID（`Platform.isLoaded` の答え） */
  readonly modIds: readonly string[]
}

/** アプリで再現しなかった呼び出し1種類 */
export interface UnsupportedCall {
  readonly name: string
  readonly count: number
}

/** 動かしていてエラーが起きた所 */
export interface ScriptError {
  /** server_scripts/ からのパス */
  readonly path: string
  readonly message: string
}

/** スクリプトを動かした結果のまとめ。プラグインが仮定に載せる */
export interface ScriptRunSummary {
  /** 動かしたファイルの数 */
  readonly files: number
  /** 足したレシピの数（読む6つの種類だけ） */
  readonly added: number
  /** 消したレシピの数 */
  readonly removed: number
  /** 材料・できる物を置き換えたレシピの数 */
  readonly replaced: number
  /** 再現しなかった呼び出し（多い順） */
  readonly unsupported: readonly UnsupportedCall[]
  readonly errors: readonly ScriptError[]
  /** 時間の上限で打ち切った、または Worker が止まった。このときスクリプトの結果は使わない */
  readonly failed: string | null
}

/** スクリプトを動かした結果 */
export interface ScriptRunOutput {
  /** スクリプトを当てはめたあとのレシピ */
  readonly recipes: ProcessingRecipe[]
  /** スクリプトを当てはめたあとのアイテムのタグ */
  readonly itemTags: ItemTagFiles
  readonly summary: ScriptRunSummary
}

/** スクリプトを動かす関数。アプリでは Worker の実装（workers/kubejsScriptsClient.ts）を渡す */
export type ScriptRunner = (input: ScriptRunInput) => Promise<ScriptRunOutput>

/** スクリプトを使わなかったときの結果（入力をそのまま返す） */
export function unchangedOutput(input: ScriptRunInput, failed: string): ScriptRunOutput {
  return {
    recipes: [...input.recipes],
    itemTags: { ...input.itemTags },
    summary: { files: 0, added: 0, removed: 0, replaced: 0, unsupported: [], errors: [], failed },
  }
}
