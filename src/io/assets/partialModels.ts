// 部品のモデルの表（docs/design.md「部品のモデルの表」）。
// ゲームでは描画のコード（BlockEntityRenderer）が状態に合わせて部品のモデル（partial model）を選んで描くブロックがある
// （Create のベルトなど）。その選び方を Mod ごとの表に書き写し、ここから引く。
// 表は Mod ごとの場所（io/assets/create/ など）に置き、builtinPartialModels.ts に登録する
// （docs/design.md「Mod ごとのものを足す口」）。

import type { BlockState } from '../../domain/blockState'
import type { Rotation3 } from '../../domain/rotation3'
import { BUILTIN_PARTIAL_MODELS } from './builtinPartialModels'

/** 重ねる部品のモデル1つ */
export interface PartialPlacement {
  /** モデルの ID（`create:block/belt/start`） */
  readonly model: string
  /** ブロックの中心まわりの回転 */
  readonly matrix: Rotation3
}

/** 状態から、重ねる部品のモデルを選ぶ */
export type PartialRule = (state: BlockState) => readonly PartialPlacement[]

/** Mod ごとの表。ブロックの ID（`create:belt`）→ 選び方 */
export type PartialModelTable = Readonly<Record<string, PartialRule>>

/** そのブロック状態に重ねる部品のモデル。どの表にもなければ空。同じ ID が2つの表にあれば先に登録したもの */
export function partialModelsFor(state: BlockState, tables: readonly PartialModelTable[] = BUILTIN_PARTIAL_MODELS): readonly PartialPlacement[] {
  const id = state.id.toString()
  for (const table of tables) {
    if (Object.hasOwn(table, id)) return table[id]!(state)
  }
  return []
}
