// 設計図の枠の取っ手で大きさを変えるときの計算（#201、docs/ui.md「設計図の大きさ」）。
// Vue にも Three.js にも依存しないので、そのままテストできる。3D・2D表示が使う。

import type { Box } from '../../domain/box'
import type { Vec3 } from '../../domain/vec3'
import type { RegionGrow } from '../../edit/blueprintResize'
import { MAX_BLUEPRINT_SIDE } from '../../edit/regionTransform'
import type { GridLayout2D, PickRay } from '../tools/picker'
import { FACE_HANDLES, faceCenter, rayCubeHit, type FaceHandle } from './rangeHandles'

/** 3D の枠の取っ手（球）の半径（マス） */
export const FRAME_HANDLE_RADIUS_3D = 0.25
/** 3D の枠の取っ手を面から外へ離す量（マス）。範囲の取っ手より外に出す */
export const FRAME_HANDLE_OFFSET_3D = 1.2
/** 3D の枠の取っ手の当たりを見た目より広げる量（マス） */
const FRAME_HANDLE_PAD_3D = 0.1
/** 2D の枠の取っ手をマス目の辺から外へ離す量（画素） */
export const FRAME_HANDLE_GAP_2D = 16
/** 2D の枠の取っ手の当たりの半径（画素） */
const FRAME_HANDLE_HIT_2D = 9

/** 2D の枠の取っ手（x・z の4つ） */
export const FRAME_HANDLES_2D: readonly FaceHandle[] = FACE_HANDLES.filter((h) => h.axis !== 1)

/** 設計図の枠の箱 */
export function frameBox(size: Vec3): Box {
  return { min: [0, 0, 0], max: [size[0] - 1, size[1] - 1, size[2] - 1] }
}

/** 3D の枠の取っ手の真ん中 */
export function frameHandleCenter3D(size: Vec3, h: FaceHandle): Vec3 {
  const c = [...faceCenter(frameBox(size), h)] as [number, number, number]
  c[h.axis] += h.side === 'min' ? -FRAME_HANDLE_OFFSET_3D : FRAME_HANDLE_OFFSET_3D
  return c
}

/** レイが当たる3Dの枠の取っ手（いちばん手前）。当たらなければ null */
export function hitFrameHandle3D(ray: PickRay, size: Vec3): FaceHandle | null {
  let best: { h: FaceHandle; t: number } | null = null
  for (const h of FACE_HANDLES) {
    const t = rayCubeHit(ray, frameHandleCenter3D(size, h), FRAME_HANDLE_RADIUS_3D + FRAME_HANDLE_PAD_3D)
    if (t !== null && (!best || t < best.t)) best = { h, t }
  }
  return best?.h ?? null
}

/** 2D の枠の取っ手の位置（canvas の画素） */
export function frameHandlePoint2D(size: Vec3, layout: GridLayout2D, h: FaceHandle): [number, number] {
  const { originX: ox, originY: oy, cellSize: cs } = layout
  const w = size[0] * cs
  const d = size[2] * cs
  const out = h.side === 'min' ? -FRAME_HANDLE_GAP_2D : FRAME_HANDLE_GAP_2D
  if (h.axis === 0) return [h.side === 'min' ? ox + out : ox + w + out, oy + d / 2]
  return [ox + w / 2, h.side === 'min' ? oy + out : oy + d + out]
}

/** canvas の位置 (px, py) にある2Dの枠の取っ手。なければ null */
export function hitFrameHandle2D(px: number, py: number, layout: GridLayout2D, size: Vec3): FaceHandle | null {
  for (const h of FRAME_HANDLES_2D) {
    const [x, y] = frameHandlePoint2D(size, layout, h)
    if (Math.hypot(px - x, py - y) <= FRAME_HANDLE_HIT_2D) return h
  }
  return null
}

/**
 * 面 h を、マスの境目 boundary（小数でよい。いちばん近い境目にそろえる）へ動かすときの、6方向に足すマス数。
 * 各辺は 1 以上 MAX_BLUEPRINT_SIDE 以下に収める
 */
export function frameGrow(size: Vec3, h: FaceHandle, boundary: number): RegionGrow {
  const b = Math.round(boundary)
  const a = h.axis
  const raw = h.side === 'max' ? b - size[a] : 0 - b
  const n = Math.min(MAX_BLUEPRINT_SIDE - size[a], Math.max(1 - size[a], raw))
  const min: [number, number, number] = [0, 0, 0]
  const max: [number, number, number] = [0, 0, 0]
  ;(h.side === 'min' ? min : max)[a] = n
  return { min, max }
}

/** 足すマス数がすべて 0 か */
export function isNoGrow(grow: RegionGrow): boolean {
  return grow.min.every((n) => n === 0) && grow.max.every((n) => n === 0)
}

/** 変えたあとの枠（今の座標）。負の向きに広げると最小の角が負になる */
export function grownFrameBox(size: Vec3, grow: RegionGrow): Box {
  return {
    min: [0 - grow.min[0], 0 - grow.min[1], 0 - grow.min[2]],
    max: [size[0] - 1 + grow.max[0], size[1] - 1 + grow.max[1], size[2] - 1 + grow.max[2]],
  }
}

/** 状態表示に出す「11 × 1 × 4 → 13 × 1 × 4」。消えるブロックがあれば数を足す */
export function frameSizeLabel(size: Vec3, grow: RegionGrow, removedBlocks: number): string {
  const next = size.map((n, a) => n + grow.min[a]! + grow.max[a]!)
  const base = `${size.join(' × ')} → ${next.join(' × ')}`
  return removedBlocks > 0 ? `${base}。ブロック ${removedBlocks} 個が消えます` : base
}
