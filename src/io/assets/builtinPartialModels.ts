// アプリに入れる部品のモデルの表の一覧（docs/design.md「部品のモデルの表」「Mod ごとのものを足す口」）。
// io は calc を使えないので、計算プラグインとは別にここで登録する。Mod の表は Mod ごとの場所に置き、ここに足す。

import { CREATE_PARTIAL_MODELS } from './create/createPartialModels'
import type { PartialModelTable } from './partialModels'

/** 内蔵の表。先に並べたものを先に引く */
export const BUILTIN_PARTIAL_MODELS: readonly PartialModelTable[] = [CREATE_PARTIAL_MODELS]
