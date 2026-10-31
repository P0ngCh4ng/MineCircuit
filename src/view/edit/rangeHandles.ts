// 選択範囲を広げる・縮めるときの計算（#200・#205、docs/ui.md「範囲を選ぶ」）。
// Vue にも Three.js にも依存しないので、そのままテストできる。2D表示（辺を引く）とキー操作（Shift+矢印）が使う。

import type { Blueprint } from '../../domain/blueprint'
import { boxEquals, boxSize, forEachInBox, type Box } from '../../domain/box'
import type { Vec3 } from '../../domain/vec3'
import type { GridLayout2D } from '../tools/picker'

/** 動かす面。axis の向きの、小さい側（min）か大きい側（max）の面 */
export interface FaceHandle {
  readonly axis: 0 | 1 | 2
  readonly side: 'min' | 'max'
}

/** 2D で辺に当たるとみなす、辺からの距離（画素） */
export const EDGE_HIT_2D = 5

/**
 * canvas の位置 (px, py) の近くにある、2D の範囲の長方形の辺。角なら2つ。
 * 辺の外側・内側どちらから近づいてもよい。なければ null
 */
export function hitEdge2D(px: number, py: number, layout: GridLayout2D, box: Box): readonly FaceHandle[] | null {
  const { originX: ox, originY: oy, cellSize: cs } = layout
  const left = ox + box.min[0] * cs
  const right = ox + (box.max[0] + 1) * cs
  const top = oy + box.min[2] * cs
  const bottom = oy + (box.max[2] + 1) * cs
  const t = EDGE_HIT_2D
  // 長方形を少し広げた中にいなければ当たらない
  if (px < left - t || px > right + t || py < top - t || py > bottom + t) return null
  const faces: FaceHandle[] = []
  // 範囲が細いときは近い方の辺だけにする
  const dl = Math.abs(px - left)
  const dr = Math.abs(px - right)
  if (Math.min(dl, dr) <= t) faces.push({ axis: 0, side: dl <= dr ? 'min' : 'max' })
  const dt = Math.abs(py - top)
  const db = Math.abs(py - bottom)
  if (Math.min(dt, db) <= t) faces.push({ axis: 2, side: dt <= db ? 'min' : 'max' })
  return faces.length > 0 ? faces : null
}

/** 2D の辺にマウスを重ねたときのカーソル */
export function edgeCursor2D(faces: readonly FaceHandle[]): string {
  if (faces.length === 2) return faces[0]!.side === faces[1]!.side ? 'nwse-resize' : 'nesw-resize'
  return faces[0]!.axis === 0 ? 'ew-resize' : 'ns-resize'
}

/**
 * 面 faces を、マスの境目 boundary(axis)（小数でよい。いちばん近い境目にそろえる）へ動かした範囲。
 * 設計図（大きさ size）の中に収め、どの向きも 1 マス以上残す
 */
export function moveFaces(box: Box, faces: readonly FaceHandle[], boundary: (axis: 0 | 1 | 2) => number, size: Vec3): Box {
  const min = [...box.min] as [number, number, number]
  const max = [...box.max] as [number, number, number]
  for (const { axis: a, side } of faces) {
    const b = Math.round(boundary(a))
    if (side === 'max') max[a] = clamp(b - 1, min[a], size[a] - 1)
    else min[a] = clamp(b, 0, max[a])
  }
  return { min, max }
}

/**
 * 向き d（軸に沿った1マス。矢印キーの向き）の面を、外へ1マス広げた（shrink なら内へ1マス縮めた）範囲。
 * 設計図の中に収め、1 マスは残す
 */
export function growToward(box: Box, d: Vec3, shrink: boolean, size: Vec3): Box {
  const axis = d.findIndex((v) => v !== 0) as 0 | 1 | 2 | -1
  if (axis === -1) return box
  const side = d[axis]! > 0 ? 'max' : 'min'
  const face = side === 'max' ? box.max[axis] + 1 : box.min[axis]
  const step = (side === 'max') !== shrink ? 1 : -1
  return moveFaces(box, [{ axis, side }], () => face + step, size)
}

/** 範囲を、中のブロックが入る一番小さい箱に縮めたもの（「中身に合わせる」。#205）。中にブロックがなければ null */
export function fitToContent(bp: Blueprint, box: Box): Box | null {
  let min: [number, number, number] | null = null
  let max: [number, number, number] = [0, 0, 0]
  forEachInBox(box, (p) => {
    if (bp.get(p) === null) return
    if (!min) {
      min = [p[0], p[1], p[2]]
      max = [p[0], p[1], p[2]]
      return
    }
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a]!, p[a]!)
      max[a] = Math.max(max[a]!, p[a]!)
    }
  })
  return min ? { min, max } : null
}

/** 範囲の高さを、設計図の一番下の段から一番上の段までにしたもの（「上下すべての段」。#205） */
export function fullHeight(box: Box, size: Vec3): Box {
  return { min: [box.min[0], 0, box.min[2]], max: [box.max[0], size[1] - 1, box.max[2]] }
}

/** 変えた範囲が今と違うときだけ返す（ツールバーのボタンを押せるか） */
export function changedBox(next: Box | null, box: Box): Box | null {
  return next && !boxEquals(next, box) ? next : null
}

/** 状態表示に出す範囲の大きさ */
export function rangeSizeLabel(box: Box): string {
  return `範囲 ${boxSize(box).join(' × ')}`
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}
