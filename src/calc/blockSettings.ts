// 計算に使うブロックの設定（クリエイティブモーターの回転数など）の説明。
// どのブロックのどの生データ（nbt）の項目を画面で変えられるかを、Mod ごとの知識として計算の層に置く。
// 画面（view）はこの説明を表示し、変更を編集の操作（setBlockEntityTag）にするだけ。

import type { BlockState } from '../domain/blockState'
import { nbt, type NbtTag, type RawNbt } from '../domain/nbt'
import { createBlockSettings } from './create/createBlockSettings'
import { nbtNumber } from './nbtValues'
import { resolved, type Resolved } from './provenance'

/** 整数の設定項目1つ。生データの int の項目に書く */
export interface BlockSettingField {
  /** 生データの項目名（`ScrollValue` など） */
  readonly key: string
  /** 画面の名前（「回転数」） */
  readonly label: string
  /** 単位（「RPM」）。なければ空文字 */
  readonly unit: string
  readonly min: number
  readonly max: number
  /** 生データにないとき、計算が使う内蔵の初期値 */
  readonly defaultValue: number
  /** 画面に添える説明。なければ空文字 */
  readonly hint: string
}

/** 1つのブロックで変えられる設定 */
export interface BlockSettings {
  readonly fields: readonly BlockSettingField[]
  /**
   * 生データがないブロック（アプリで置いたものなど）に値を書くとき、元にする生データ。
   * ゲームのブロックエンティティの id など、最小の項目だけを入れる。
   * ゲームがこの形を読めるかは未確認（#22 で確かめる）。
   */
  initialBlockEntity(): RawNbt
}

/** state のブロックで変えられる設定。なければ null */
export function blockSettingsFor(state: BlockState): BlockSettings | null {
  return createBlockSettings(state)
}

/** 今の値と出どころ。生データにあれば設計図、なければ内蔵の初期値 */
export function settingValue(field: BlockSettingField, blockEntity: RawNbt | null): Resolved<number> {
  const v = nbtNumber(blockEntity, field.key)
  return v === null ? resolved(field.defaultValue, 'builtin') : resolved(v, 'blueprint')
}

/** 入力の文字列を調べた結果。正しければ value、だめなら画面に出す error */
export type SettingInput = { readonly value: number } | { readonly error: string }

/** 入力の文字列を調べる。整数で、範囲の中なら値を返す */
export function parseSettingInput(field: BlockSettingField, text: string): SettingInput {
  const trimmed = text.trim()
  const range = `${field.min}〜${field.max}`
  if (!/^[+-]?\d+$/.test(trimmed)) {
    return { error: `${field.label}は整数で入れてください（${range}）。` }
  }
  const value = Number(trimmed)
  if (value < field.min || value > field.max) {
    return { error: `${field.label}は ${range} の範囲で入れてください。` }
  }
  return { value }
}

/** 生データに書く値 */
export function settingTag(_field: BlockSettingField, value: number): NbtTag {
  return nbt.int(value)
}
