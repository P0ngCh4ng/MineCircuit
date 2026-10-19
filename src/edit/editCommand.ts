import type { BlockState } from '../domain/blockState'
import type { Blueprint } from '../domain/blueprint'
import type { CellValue } from '../domain/blockVolume'
import type { Vec3 } from '../domain/vec3'
import { propertyValueOptionsFor, type BlockStateDefinitionSource } from './orientationOptions'
import { rotateState } from './rotation'

/** 1マス分の変更。pos は設計図全体の座標 */
export interface CellChange {
  readonly pos: Vec3
  readonly before: CellValue
  readonly after: CellValue
}

/** 編集の操作。元に戻せる変更1つ */
export interface EditCommand {
  /** 「shaft を置く」。元に戻すボタンのツールチップに出す */
  readonly label: string
  readonly changes: readonly CellChange[]
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
