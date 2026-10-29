// 2D表示の拡大・縮小と移動（#155）。docs/ui.md「2D表示と計測」。
// canvas にも Vue にも依存しない計算だけを置き、テストできるようにする。
// 表示の状態はマス目の置き方（GridLayout2D）そのもの。「全体を表示」は layoutGrid2D で作り直す。

import type { Vec3 } from '../../domain/vec3'
import type { GridLayout2D } from '../tools/picker'

/** 拡大・縮小で使う1マスの最小の大きさ（px） */
export const ZOOM_MIN_CELL_SIZE = 1
/** 拡大・縮小で使う1マスの最大の大きさ（px） */
export const ZOOM_MAX_CELL_SIZE = 128
/** ホイール1目盛り（deltaY = 100 px）で変わる倍率 */
export const WHEEL_ZOOM_STEP = 1.2

/**
 * ホイールの動きから倍率を出す。手前に回す（deltaY < 0）と拡大。
 * deltaMode は WheelEvent の単位（0: px、1: 行、2: ページ）
 */
export function wheelZoomFactor(deltaY: number, deltaMode = 0): number {
  const px = deltaMode === 1 ? deltaY * 33 : deltaMode === 2 ? deltaY * 800 : deltaY
  return Math.pow(WHEEL_ZOOM_STEP, -px / 100)
}

/**
 * 位置 (px, py) を中心に、マスの大きさを factor 倍にする。その位置の下のマスは動かない。
 * マスの大きさは整数にそろえ（線がにじまないように）、倍率が 1 でなければ少なくとも 1 px 変える
 */
export function zoomAt(layout: GridLayout2D, px: number, py: number, factor: number): GridLayout2D {
  const cs = layout.cellSize
  let next = Math.round(cs * factor)
  if (next === cs && factor !== 1) next = cs + (factor > 1 ? 1 : -1)
  next = Math.min(ZOOM_MAX_CELL_SIZE, Math.max(ZOOM_MIN_CELL_SIZE, next))
  if (next === cs) return layout
  // マウスの下の点（マスの単位）を、拡大・縮小のあとも同じ画面の位置に置く
  const gx = (px - layout.originX) / cs
  const gy = (py - layout.originY) / cs
  return {
    originX: Math.round(px - gx * next),
    originY: Math.round(py - gy * next),
    cellSize: next,
  }
}

/** 表示を (dx, dy) px 動かす。位置は整数にそろえる */
export function panBy(layout: GridLayout2D, dx: number, dy: number): GridLayout2D {
  return { originX: Math.round(layout.originX + dx), originY: Math.round(layout.originY + dy), cellSize: layout.cellSize }
}

/** 動かしても表示の中に残す、マス目の幅（px） */
export const KEEP_VISIBLE_PX = 48

/**
 * マス目が表示の外へ出きってしまわないように、位置を収める。
 * 段（幅 x × 奥行き z）のうち、少なくとも keep px（マス目がそれより小さければマス目全体）が表示に残る
 */
export function clampToView(layout: GridLayout2D, size: Vec3, width: number, height: number, keep = KEEP_VISIBLE_PX): GridLayout2D {
  const gridW = size[0] * layout.cellSize
  const gridH = size[2] * layout.cellSize
  const keepX = Math.min(keep, gridW, width)
  const keepY = Math.min(keep, gridH, height)
  const originX = Math.min(width - keepX, Math.max(keepX - gridW, layout.originX))
  const originY = Math.min(height - keepY, Math.max(keepY - gridH, layout.originY))
  if (originX === layout.originX && originY === layout.originY) return layout
  return { originX, originY, cellSize: layout.cellSize }
}
