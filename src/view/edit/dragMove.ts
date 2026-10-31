// 範囲をマウスでつかんで動かす・写すときの計算（#199、docs/ui.md「動かす」）。
// Vue にも Three.js にも依存しないので、そのままテストできる。画面の口は useDragMove.ts。

import { boxContains, type Box } from '../../domain/box'
import type { Blueprint } from '../../domain/blueprint'
import { translation } from '../../domain/blockTransform'
import { addVec3, type Vec3 } from '../../domain/vec3'
import { pasteOverlapCount, type BlueprintClip } from '../../edit/regionClip'
import type { PickRay } from '../tools/picker'
import type { PasteCell } from '../stores/pasteStore'

/** 行き先の見本。貼り付けの見本と同じ形で描く */
export interface MovePreview {
  readonly cells: readonly PasteCell[]
  readonly box: Box
  /** 行き先に重なるブロックの数 */
  readonly blocked: number
}

/**
 * 範囲 box（中身は clip）を d だけ動かす（copy なら写す）ときの見本。
 * 動かすときは、元の範囲の中は空くので重ならない。写すときは元の範囲とも重なる
 */
export function previewMove(bp: Blueprint, clip: BlueprintClip, box: Box, d: Vec3, copy: boolean): MovePreview {
  const at = addVec3(box.min, d)
  const cells: PasteCell[] = []
  let blocked = 0
  for (const { pos, cell } of clip.cells) {
    if (cell.state === null) continue
    const to = addVec3(at, pos)
    cells.push({ pos: to, state: cell.state })
    if (!copy && boxContains(box, to)) continue
    if (bp.get(to) !== null) blocked++
  }
  if (copy) blocked = pasteOverlapCount(bp, clip, at, translation([0, 0, 0]))
  return { cells, box: { min: at, max: addVec3(box.max, d) }, blocked }
}

const AXIS_NAMES = ['x', 'y', 'z'] as const

/** ずれの文（「x +3・z −1」）。動かないなら「動かない」 */
export function offsetLabel(d: Vec3): string {
  const parts = d.flatMap((v, a) => (v === 0 ? [] : [`${AXIS_NAMES[a]} ${v > 0 ? '+' : '−'}${Math.abs(v)}`]))
  return parts.length === 0 ? '動かない' : parts.join('・')
}

/** 状態表示に出す知らせ */
export const DRAG_MOVE_MESSAGES = {
  moving: (d: Vec3, copy: boolean) =>
    `${copy ? '写す先' : '動かす先'} ${offsetLabel(d)}。${copy ? '' : 'Alt を押して離すと写す、'}Ctrl を押して離すと上書き`,
  blocked: (count: number, copy: boolean) =>
    `${copy ? '写す先' : '動かす先'}にブロックがあります（${count} 個）。Ctrl を押して離すと上書きします`,
} as const

/** レイと水平な面（高さ y）の交わる点の [x, z]。交わらない（面と平行・後ろ向き）なら null */
export function planeHit(ray: PickRay, y: number): [number, number] | null {
  const dy = ray.direction[1]
  if (Math.abs(dy) < 1e-9) return null
  const t = (y - ray.origin[1]) / dy
  if (t < 0) return null
  return [ray.origin[0] + ray.direction[0] * t, ray.origin[2] + ray.direction[2] * t]
}

/**
 * 点 point を通り軸 axis に沿った直線の上で、レイに一番近い点の位置（point からの距離。軸の正の向きが正）。
 * レイが直線と平行なら null
 */
export function axisParam(ray: PickRay, point: Vec3, axis: 0 | 1 | 2): number | null {
  // 直線 P(s) = point + s·u、レイ R(t) = o + t·d の最も近い所
  const u: Vec3 = [axis === 0 ? 1 : 0, axis === 1 ? 1 : 0, axis === 2 ? 1 : 0]
  const d = ray.direction
  const w = [point[0] - ray.origin[0], point[1] - ray.origin[1], point[2] - ray.origin[2]]
  const dot = (a: readonly number[], b: readonly number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!
  const a = 1
  const b = dot(u, d)
  const c = dot(d, d)
  const e = dot(u, w)
  const f = dot(d, w)
  const denom = a * c - b * b
  if (Math.abs(denom) < 1e-9 * c) return null
  return (b * f - c * e) / denom
}
