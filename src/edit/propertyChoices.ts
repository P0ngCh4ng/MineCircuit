// 右パネルでブロック状態の値を選ぶときの候補（#165。docs/design.md「edit：編集」）。
// Modpack があればブロック状態の定義から読んだ値、なければよく使う項目だけ一般の値を出す。

import type { BlockState } from '../domain/blockState'
import { DIRECTIONS, HORIZONTAL_DIRECTIONS } from '../domain/direction'
import type { PropertyValueOptions } from './rotation'

/** Modpack がないときの、よく使う項目の値 */
const GENERAL_VALUES: Readonly<Record<string, readonly string[]>> = {
  axis: ['x', 'y', 'z'],
  facing: DIRECTIONS,
  horizontal_facing: HORIZONTAL_DIRECTIONS,
}

const BOOLEAN_VALUES: readonly string[] = ['true', 'false']

/** 項目1つの候補。values が null なら候補が分からない（文字を打って直す） */
export interface PropertyChoice {
  readonly name: string
  readonly current: string
  readonly values: readonly string[] | null
}

/**
 * state の項目ごとの候補。options（Modpack のブロック状態の定義から読んだ値）を優先し、
 * なければ一般の値を使う。今の値は候補になくても先頭に入れる（読めない値でも消さないため）
 */
export function propertyChoices(state: BlockState, options: PropertyValueOptions | null): PropertyChoice[] {
  return Object.entries(state.properties).map(([name, current]) => {
    const known =
      options?.[name] ??
      GENERAL_VALUES[name] ??
      (BOOLEAN_VALUES.includes(current) ? BOOLEAN_VALUES : null)
    const values = known && !known.includes(current) ? [current, ...known] : known
    return { name, current, values }
  })
}
