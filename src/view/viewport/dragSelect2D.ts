// 2D表示のドラッグで範囲を選ぶときの計算（#130、docs/ui.md「範囲を選ぶ」）。
// 画面に依存しないので、そのままテストできる。LayerView2D が使う。

import { boxFromCorners, type Box } from '../../domain/box'
import type { Vec3 } from '../../domain/vec3'
import type { GridLayout2D } from '../tools/picker'

/** 2D のマス（横が x、縦が z） */
export type Cell2D = readonly [x: number, z: number]

/**
 * canvas の中の位置 (px, py) のマス。マス目の外なら、いちばん近い端のマスにする
 * （ドラッグがマス目の外へ出ても、範囲を端まで広げられるように）
 */
export function clampedCell2D(px: number, py: number, grid: GridLayout2D, size: Vec3): Cell2D {
  const x = Math.floor((px - grid.originX) / grid.cellSize)
  const z = Math.floor((py - grid.originY) / grid.cellSize)
  return [clamp(x, 0, size[0] - 1), clamp(z, 0, size[2] - 1)]
}

/** マス目の中の位置か */
export function insideGrid2D(px: number, py: number, grid: GridLayout2D, size: Vec3): boolean {
  const x = Math.floor((px - grid.originX) / grid.cellSize)
  const z = Math.floor((py - grid.originY) / grid.cellSize)
  return x >= 0 && x < size[0] && z >= 0 && z < size[2]
}

/** ドラッグとみなすか。押したマスと今のマスが違えば（1マス以上動けば）ドラッグ */
export function isDrag2D(start: Cell2D, current: Cell2D): boolean {
  return start[0] !== current[0] || start[1] !== current[1]
}

/**
 * ドラッグで選ぶ範囲。今の段（layer）の長方形。
 * anchorLayer を渡すと（Shift+ドラッグ）、その段から今の段までの高さにする
 */
export function dragSelectionBox(start: Cell2D, end: Cell2D, layer: number, anchorLayer: number | null = null): Box {
  const bottom = anchorLayer ?? layer
  return boxFromCorners([start[0], bottom, start[1]], [end[0], layer, end[1]])
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}
