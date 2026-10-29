// 置くブロックを ID だけで選んだときの、既定のブロック状態（#149。docs/design.md「置くブロック（ブラシ）」）。
// Create の回るブロックは、回転軸を決めるプロパティ（axis・facing）がないと計算から外れる（#148）。
// 足りないものだけを補い、利用者が書いた値は変えない。

import { BlockState } from '../../domain/blockState'
import { isKineticBlock, kineticShape } from './kineticBlocks'

/** 補う値。軸は縦、向きは水平にしか向かないブロックもあるので北 */
const DEFAULT_PROPERTIES: Readonly<Record<string, string>> = { axis: 'y', facing: 'north' }

/** 補う組み合わせ。少ないものから試す */
const CANDIDATES: readonly (readonly string[])[] = [['axis'], ['facing'], ['axis', 'facing']]

export interface CompletedState {
  /** 補った状態。補えなければ元のまま */
  readonly state: BlockState
  /** 補えなかったときの理由（お知らせに出す）。補えた・補う必要がなければ null */
  readonly problem: string | null
}

/** 回転軸が決まらないときの知らせ */
export function missingAxisMessage(state: BlockState): string {
  return `${state.key} は回転軸を決める状態（axis・facing）がないか読めないため、計算から外れます。置くブロックの状態を選び直してください。`
}

/**
 * Create の回るブロックの足りない状態を補う。Create の回るブロックでなければ null（知らないブロック）。
 * 回転軸がすでに決まっていればそのまま。値が読めない（axis=w など）ときは変えずに理由を返す
 */
export function completeCreateState(state: BlockState): CompletedState | null {
  if (state.id.namespace !== 'create' || !isKineticBlock(state.id.path)) return null
  if (kineticShape(state.id.path, state)) return { state, problem: null }
  for (const names of CANDIDATES) {
    const missing = names.filter((n) => state.properties[n] === undefined)
    if (missing.length !== names.length) continue
    const props = { ...state.properties }
    for (const n of missing) props[n] = DEFAULT_PROPERTIES[n]!
    const next = new BlockState(state.id, props)
    if (kineticShape(state.id.path, next)) return { state: next, problem: null }
  }
  return { state, problem: missingAxisMessage(state) }
}
