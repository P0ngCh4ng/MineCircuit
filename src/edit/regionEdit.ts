// 範囲の操作（docs/design.md「範囲の編集」、#130）。Blueprint は変えず、操作（EditCommand）だけを返す。

import { BlockState } from '../domain/blockState'
import type { Blueprint } from '../domain/blueprint'
import type { CellValue } from '../domain/blockVolume'
import { clampBox, forEachInBox, type Box } from '../domain/box'
import type { Vec3 } from '../domain/vec3'
import type { CellChange, EditCommand } from './editCommand'

// 置き換えで引き継ぐ向きのプロパティ
const ORIENTATION_PROPERTIES = ['axis', 'facing', 'horizontal_facing', 'rotation', 'hinge', 'half', 'shape', 'attachment', 'face']

const EMPTY: CellValue = { state: null, blockEntity: null }

// ラベルに出すブロックの名前。ID の path（create:shaft → shaft）
function blockName(state: BlockState): string {
  return state.id.path
}

/**
 * 箱を設計図の大きさに切り詰め、中のマスを今の中身と一緒に渡す。
 * どのリージョンにもない位置（.litematic のリージョンの間のすき間）は飛ばす。
 */
function forEachCellInBox(bp: Blueprint, box: Box, fn: (pos: Vec3, cell: CellValue) => void): void {
  const clamped = clampBox(box, bp.size)
  if (!clamped) return
  forEachInBox(clamped, (pos) => {
    const loc = bp.locate(pos)
    const cell = loc && loc.region.cellAt(loc.local[0], loc.local[1], loc.local[2])
    if (cell) fn(pos, cell)
  })
}

function command(label: string, changes: CellChange[]): EditCommand | null {
  return changes.length === 0 ? null : { label: `${label}（${changes.length} 個）`, changes }
}

/** 範囲の中を空きにする。消すブロックがなければ null */
export function eraseRegion(bp: Blueprint, box: Box): EditCommand | null {
  const changes: CellChange[] = []
  forEachCellInBox(bp, box, (pos, before) => {
    if (before.state === null) return
    changes.push({ pos, before, after: EMPTY })
  })
  return command('範囲を消す', changes)
}

/** 範囲の中を state にする。onlyEmpty なら空きマスだけ。生データは消える。変わるマスがなければ null */
export function fillRegion(bp: Blueprint, box: Box, state: BlockState, onlyEmpty: boolean): EditCommand | null {
  const after: CellValue = { state, blockEntity: null }
  const changes: CellChange[] = []
  forEachCellInBox(bp, box, (pos, before) => {
    if (before.state !== null) {
      if (onlyEmpty) return
      if (before.state.equals(state) && before.blockEntity === null) return
    }
    changes.push({ pos, before, after })
  })
  return command(`${blockName(state)} で塗る`, changes)
}

// to の向きのプロパティを old の値にそろえる。to が持っていない名前は足さない
function withOrientationOf(to: BlockState, old: BlockState): BlockState {
  const props: Record<string, string> = { ...to.properties }
  let changed = false
  for (const name of ORIENTATION_PROPERTIES) {
    const value = old.properties[name]
    if (value === undefined || !(name in props) || props[name] === value) continue
    props[name] = value
    changed = true
  }
  return changed ? new BlockState(to.id, props) : to
}

/**
 * 範囲の中の from（ID とプロパティが同じもの）を to にする。生データは消える。
 * keepOrientation なら、向きのプロパティ（axis・facing・horizontal_facing など）を to も持っていれば元の値を引き継ぐ。
 * 変わるマスがなければ null
 */
export function replaceInRegion(
  bp: Blueprint,
  box: Box,
  from: BlockState,
  to: BlockState,
  keepOrientation: boolean,
): EditCommand | null {
  const changes: CellChange[] = []
  forEachCellInBox(bp, box, (pos, before) => {
    if (before.state === null || !before.state.equals(from)) return
    const next = keepOrientation ? withOrientationOf(to, before.state) : to
    if (next.equals(before.state) && before.blockEntity === null) return
    changes.push({ pos, before, after: { state: next, blockEntity: null } })
  })
  return command(`${blockName(from)} を ${blockName(to)} に置き換える`, changes)
}
