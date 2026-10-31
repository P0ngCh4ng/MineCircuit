// 選択範囲の取っ手で広げる・縮めるときの計算（#200、docs/ui.md「範囲を選ぶ」）。
// Vue にも Three.js にも依存しないので、そのままテストできる。3D・2D表示が使う。

import { boxSize, type Box } from '../../domain/box'
import type { Vec3 } from '../../domain/vec3'
import type { GridLayout2D, PickRay } from '../tools/picker'

/** 取っ手が動かす面。axis の向きの、小さい側（min）か大きい側（max）の面 */
export interface FaceHandle {
  readonly axis: 0 | 1 | 2
  readonly side: 'min' | 'max'
}

/** 3D の6つの取っ手 */
export const FACE_HANDLES: readonly FaceHandle[] = [
  { axis: 0, side: 'min' },
  { axis: 0, side: 'max' },
  { axis: 1, side: 'min' },
  { axis: 1, side: 'max' },
  { axis: 2, side: 'min' },
  { axis: 2, side: 'max' },
]

/** 3D の取っ手（立方体）の一辺（マス） */
export const HANDLE_SIZE_3D = 0.4
/** 3D の取っ手を面から外へ離す量（マス）。範囲の中のブロックと重ならないようにする */
export const HANDLE_OFFSET_3D = 0.4
/** 3D の取っ手の当たりを見た目より広げる量（マス） */
const HANDLE_PAD_3D = 0.1
/** 2D の取っ手の当たりの半径（画素） */
export const HANDLE_HIT_2D = 8

/** 面の真ん中の点（面の上）。ブロック座標で、マスの境目が整数 */
export function faceCenter(box: Box, h: FaceHandle): Vec3 {
  const c: [number, number, number] = [0, 1, 2].map((a) => (box.min[a]! + box.max[a]! + 1) / 2) as [number, number, number]
  c[h.axis] = h.side === 'min' ? box.min[h.axis] : box.max[h.axis] + 1
  return c
}

/** 3D の取っ手の真ん中。面の真ん中から外へ離す */
export function handleCenter3D(box: Box, h: FaceHandle): Vec3 {
  const c = [...faceCenter(box, h)] as [number, number, number]
  c[h.axis] += h.side === 'min' ? -HANDLE_OFFSET_3D : HANDLE_OFFSET_3D
  return c
}

/** レイが当たる3Dの取っ手（いちばん手前）。当たらなければ null */
export function hitHandle3D(ray: PickRay, box: Box): FaceHandle | null {
  const half = HANDLE_SIZE_3D / 2 + HANDLE_PAD_3D
  let best: { h: FaceHandle; t: number } | null = null
  for (const h of FACE_HANDLES) {
    const c = handleCenter3D(box, h)
    const t = rayCubeHit(ray, c, half)
    if (t !== null && (!best || t < best.t)) best = { h, t }
  }
  return best?.h ?? null
}

/** レイと、真ん中 c・半分の幅 half の立方体が交わる所までの長さ。交わらなければ null */
function rayCubeHit(ray: PickRay, c: Vec3, half: number): number | null {
  let near = -Infinity
  let far = Infinity
  for (let a = 0; a < 3; a++) {
    const o = ray.origin[a]!
    const d = ray.direction[a]!
    const lo = c[a]! - half
    const hi = c[a]! + half
    if (Math.abs(d) < 1e-12) {
      if (o < lo || o > hi) return null
      continue
    }
    const t1 = (lo - o) / d
    const t2 = (hi - o) / d
    near = Math.max(near, Math.min(t1, t2))
    far = Math.min(far, Math.max(t1, t2))
  }
  if (near > far || far < 0) return null
  return Math.max(near, 0)
}

/** 2D の取っ手。4つの辺の真ん中と4つの角。x・z はマスの境目の位置（マス単位） */
export interface Handle2D {
  readonly faces: readonly FaceHandle[]
  readonly x: number
  readonly z: number
}

/** 2D の8つの取っ手 */
export function handles2D(box: Box): Handle2D[] {
  const xs = { min: box.min[0], max: box.max[0] + 1 }
  const zs = { min: box.min[2], max: box.max[2] + 1 }
  const midX = (xs.min + xs.max) / 2
  const midZ = (zs.min + zs.max) / 2
  const fx = (side: 'min' | 'max'): FaceHandle => ({ axis: 0, side })
  const fz = (side: 'min' | 'max'): FaceHandle => ({ axis: 2, side })
  const out: Handle2D[] = []
  for (const sx of ['min', 'max'] as const)
    for (const sz of ['min', 'max'] as const) out.push({ faces: [fx(sx), fz(sz)], x: xs[sx], z: zs[sz] })
  for (const s of ['min', 'max'] as const) {
    out.push({ faces: [fx(s)], x: xs[s], z: midZ })
    out.push({ faces: [fz(s)], x: midX, z: zs[s] })
  }
  return out
}

/** canvas の位置 (px, py) にある2Dの取っ手（いちばん近いもの）。なければ null */
export function hitHandle2D(px: number, py: number, layout: GridLayout2D, box: Box): Handle2D | null {
  let best: { h: Handle2D; d: number } | null = null
  for (const h of handles2D(box)) {
    const d = Math.hypot(px - (layout.originX + h.x * layout.cellSize), py - (layout.originY + h.z * layout.cellSize))
    if (d <= HANDLE_HIT_2D && (!best || d < best.d)) best = { h, d }
  }
  return best?.h ?? null
}

/** 2D の取っ手にマウスを重ねたときのカーソル */
export function handleCursor2D(h: Handle2D): string {
  if (h.faces.length === 2) return h.faces[0]!.side === h.faces[1]!.side ? 'nwse-resize' : 'nesw-resize'
  return h.faces[0]!.axis === 0 ? 'ew-resize' : 'ns-resize'
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

/** 状態表示に出す範囲の大きさ */
export function rangeSizeLabel(box: Box): string {
  return `範囲 ${boxSize(box).join(' × ')}`
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}
