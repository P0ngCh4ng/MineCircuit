import { BlockState } from '../domain/blockState'
import type { BlockTransform } from '../domain/blockTransform'
import type { Blueprint } from '../domain/blueprint'
import type { CellValue, RawEntity } from '../domain/blockVolume'
import type { Box } from '../domain/box'
import type { NbtTag, RawNbt } from '../domain/nbt'
import type { Vec3 } from '../domain/vec3'
import { nbtEquals } from '../io/nbt/nbtEquals'
import { propertyValueOptionsFor, type BlockStateDefinitionSource } from './orientationOptions'
import { rotateState } from './rotation'

/** 1マス分の変更。pos は設計図全体の座標 */
export interface CellChange {
  readonly pos: Vec3
  readonly before: CellValue
  readonly after: CellValue
}

/**
 * リージョンの位置と大きさの変更（範囲の操作で設計図を広げるとき）。
 * 設計図全体の座標は shift だけずれる（負の向きに広げたとき）。リージョンの中身もそれに合わせて写す
 */
export interface RegionResize {
  /** Blueprint.regions の番号 */
  readonly region: number
  readonly before: { readonly offset: Vec3; readonly size: Vec3 }
  readonly after: { readonly offset: Vec3; readonly size: Vec3 }
  /** 設計図全体の座標のずれ（どのリージョンでも同じ値） */
  readonly shift: Vec3
}

/** リージョンのエンティティを丸ごと差し替える変更 */
export interface EntityChange {
  readonly region: number
  readonly before: readonly RawEntity[]
  readonly after: readonly RawEntity[]
}

/**
 * 範囲を動かす・回す・反転する操作の、位置の対応。画面が選択範囲と仮の入出力を動かすのに使う（履歴には入れないもの）。
 * source は操作の前の座標、target は操作の後の座標。貼り付けは source が null（範囲の中で動くものはなく、shift だけを当てる）
 */
export interface Relocation {
  readonly source: Box | null
  readonly target: Box
  /** 範囲の中のものの変換（shift を含まない。操作の前の座標で） */
  readonly transform: BlockTransform
  /** 設計図全体の座標のずれ（負の向きに広げたとき） */
  readonly shift: Vec3
  /**
   * 選択範囲を target に置き換えず、shift だけずらす（設計図の大きさを変える操作。#191）。
   * 省略なら、範囲を動かした操作として選択範囲を target にする
   */
  readonly keepSelection?: boolean
}

/** 編集の操作。元に戻せる変更1つ */
export interface EditCommand {
  /** 「shaft を置く」。元に戻すボタンのツールチップに出す */
  readonly label: string
  /** マスの変更。pos は resize のあとの座標 */
  readonly changes: readonly CellChange[]
  /** 大きさを変える前に書くマス（縮めて消えるブロック。#191）。pos は変える前の座標 */
  readonly cleared?: readonly CellChange[]
  /** 先に大きさを変えてから changes を書く。元に戻すときは逆 */
  readonly resize?: readonly RegionResize[]
  readonly entities?: readonly EntityChange[]
  /** 範囲を動かした操作なら、位置の対応 */
  readonly relocation?: Relocation
}

// ラベルに出すブロックの名前。ID の path（create:shaft → shaft）
function blockName(state: BlockState): string {
  return state.id.path
}

// pos の今の中身。どのリージョンにもなければ null
function currentCell(bp: Blueprint, pos: Vec3): CellValue | null {
  const loc = bp.locate(pos)
  return loc ? loc.region.cellAt(loc.local[0], loc.local[1], loc.local[2]) : null
}

/**
 * pos に state を置く操作を作る。Blueprint は変えない。
 * 置けないとき（範囲の外、replace が false で空きでない、同じ状態がすでにある）は null。
 * 新しく置いたブロックの生データは null にする。
 */
export function placeBlock(bp: Blueprint, pos: Vec3, state: BlockState, replace: boolean): EditCommand | null {
  const before = currentCell(bp, pos)
  if (!before) return null
  if (before.state !== null) {
    if (!replace) return null
    if (before.state.equals(state) && before.blockEntity === null) return null
  }
  return {
    label: `${blockName(state)} を置く`,
    changes: [{ pos, before, after: { state, blockEntity: null } }],
  }
}

/**
 * cells の空きマスに state を置く操作を作る（ドラッグで一直線に置く。#161）。1回の「元に戻す」で全部戻る。
 * 埋まっているマスと範囲の外は飛ばす。置くマスが1つもなければ null
 */
export function placeBlocks(bp: Blueprint, cells: readonly Vec3[], state: BlockState): EditCommand | null {
  const changes: CellChange[] = []
  const seen = new Set<string>()
  for (const pos of cells) {
    const key = pos.join(',')
    if (seen.has(key)) continue
    seen.add(key)
    const before = currentCell(bp, pos)
    if (!before || before.state !== null) continue
    changes.push({ pos, before, after: { state, blockEntity: null } })
  }
  if (changes.length === 0) return null
  return { label: `${blockName(state)} を一直線に置く（${changes.length} 個）`, changes }
}

/** pos のブロックを消す操作を作る。空きか範囲の外なら null */
export function eraseBlock(bp: Blueprint, pos: Vec3): EditCommand | null {
  const before = currentCell(bp, pos)
  if (!before?.state) return null
  return {
    label: `${blockName(before.state)} を消す`,
    changes: [{ pos, before, after: { state: null, blockEntity: null } }],
  }
}

/**
 * pos のブロックを1回回す操作を作る。vertical が false なら R（水平）、true なら Shift+R（縦）。
 * 生データ（nbt）はそのまま引き継ぐ。空き・範囲の外・回せる向きがないときは null。
 * modpack があれば、ブロック状態の定義から読んだ取りうる値の範囲で回す。null なら規則のとおりに回す。
 */
export function rotateBlock(
  bp: Blueprint,
  pos: Vec3,
  vertical: boolean,
  modpack: BlockStateDefinitionSource | null = null,
): EditCommand | null {
  const before = currentCell(bp, pos)
  if (!before?.state) return null
  const next = rotateState(before.state, vertical, propertyValueOptionsFor(modpack, before.state.id))
  if (next.equals(before.state)) return null
  return {
    label: `${blockName(before.state)} を回す`,
    changes: [{ pos, before, after: { state: next, blockEntity: before.blockEntity } }],
  }
}

/**
 * pos のブロックのブロック状態の項目 name を value にする操作を作る（右パネルで選んで直す。#165）。
 * 生データ（nbt）はそのまま引き継ぐ。項目がなければ足す。
 * 空き・範囲の外・すでに同じ値・名前か値が空のときは null。
 */
export function setBlockProperty(bp: Blueprint, pos: Vec3, name: string, value: string): EditCommand | null {
  const before = currentCell(bp, pos)
  if (!before?.state || name === '' || value === '') return null
  if (before.state.properties[name] === value) return null
  const next = new BlockState(before.state.id, { ...before.state.properties, [name]: value })
  return {
    label: `${blockName(before.state)} の ${name} を ${value} にする`,
    changes: [{ pos, before, after: { state: next, blockEntity: before.blockEntity } }],
  }
}

/**
 * pos のブロックの生データ（nbt）の項目 key を tag にする操作を作る。
 * 生データは書き換えず、写しを作って key だけを差し替える（ほかの項目と並びはそのまま）。
 * 元に戻すと、元の生データ（同じもの）を書き戻す。
 * 生データがないブロック（アプリで置いたものなど）は、initial の写しに key を足して作る。
 * initial に何を入れるか（ブロックエンティティの id など）は、呼ぶ側（Mod ごとの知識）が決める。
 * 空き・範囲の外・すでに同じ値のときは null。label は元に戻すボタンのツールチップに出す。
 */
export function setBlockEntityTag(
  bp: Blueprint,
  pos: Vec3,
  key: string,
  tag: NbtTag,
  initial: RawNbt | null = null,
  label: string | null = null,
): EditCommand | null {
  const before = currentCell(bp, pos)
  if (!before?.state) return null
  const base = before.blockEntity ?? initial
  const current = base?.value.get(key)
  if (before.blockEntity && current && nbtEquals(current, tag)) return null
  const value = new Map(base?.value ?? [])
  value.set(key, tag)
  return {
    label: label ?? `${blockName(before.state)} の ${key} を変える`,
    changes: [{ pos, before, after: { state: before.state, blockEntity: { type: 'compound', value } } }],
  }
}
