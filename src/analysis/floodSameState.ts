// 隣り合う同じ種類のブロックを集める。docs/design.md「analysis：計測」。
// 「同じブロック」ツールで使う。面で隣り合う（6方向）ブロックのうち、ブロック状態（ID と properties）が
// 同じものをたどるだけで、回転や配管のつながりではない。本当のつながりは計算プラグインが作る。
// 種類を問わずに隣り合うブロックをたどる floodConnected は、ダブルクリックで装置をまるごと選ぶのに使う（#205）。

import type { Blueprint } from '../domain/blueprint'
import type { Box } from '../domain/box'
import { blockStateKey } from '../domain/blockState'
import { addVec3, type Vec3 } from '../domain/vec3'

const NEIGHBORS: readonly Vec3[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
]

/**
 * start から、面で隣り合う同じブロック状態のブロックを集める。
 * 結果の先頭は start。start が空（空気・範囲外）なら空の配列。
 */
export function floodSameState(bp: Blueprint, start: Vec3): Vec3[] {
  const first = bp.get(start)
  if (!first) return []
  const key = blockStateKey(first)
  return floodWhere(bp, start, (s) => blockStateKey(s) === key)
}

/**
 * start から、面で隣り合うブロック（空気でないもの。種類は問わない）を集める（#205）。
 * ダブルクリックで1つの装置をまるごと選ぶときに使う。結果の先頭は start。start が空なら空の配列
 */
export function floodConnected(bp: Blueprint, start: Vec3): Vec3[] {
  return bp.get(start) ? floodWhere(bp, start, () => true) : []
}

/** start から、面で隣り合い accept を満たすブロックを幅優先でたどる。start は満たすものとする */
function floodWhere(bp: Blueprint, start: Vec3, accept: (state: NonNullable<ReturnType<Blueprint['get']>>) => boolean): Vec3[] {
  const [w, h, d] = bp.size
  const id = (p: Vec3): number => (p[1] * d + p[2]) * w + p[0]

  const seen = new Set<number>([id(start)])
  const result: Vec3[] = [start]
  // 幅優先でたどる（result をそのまま待ち行列にする）
  for (let i = 0; i < result.length; i++) {
    for (const step of NEIGHBORS) {
      const p = addVec3(result[i], step)
      if (p[0] < 0 || p[1] < 0 || p[2] < 0 || p[0] >= w || p[1] >= h || p[2] >= d) continue
      const n = id(p)
      if (seen.has(n)) continue
      seen.add(n)
      const s = bp.get(p)
      if (s && accept(s)) result.push(p)
    }
  }
  return result
}

/** 集めたブロックを囲む一番小さい箱。空なら null */
export function boundingBoxOf(positions: readonly Vec3[]): Box | null {
  if (positions.length === 0) return null
  const min = [...positions[0]!] as [number, number, number]
  const max = [...positions[0]!] as [number, number, number]
  for (const p of positions)
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a]!, p[a]!)
      max[a] = Math.max(max[a]!, p[a]!)
    }
  return { min, max }
}

/** 集めたブロックがまたがる段の数 */
export function countLayers(positions: readonly Vec3[]): number {
  return new Set(positions.map((p) => p[1])).size
}
