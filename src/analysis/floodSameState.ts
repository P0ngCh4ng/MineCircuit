// 隣り合う同じ種類のブロックを集める。docs/design.md「analysis：計測」。
// 「つながり」ツールで使う。面で隣り合う（6方向）ブロックのうち、ブロック状態（ID と properties）が
// 同じものをたどるだけで、回転や配管のつながりではない。本当のつながりは計算プラグインが作る。

import type { Blueprint } from '../domain/blueprint'
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
      if (s && blockStateKey(s) === key) result.push(p)
    }
  }
  return result
}

/** 集めたブロックがまたがる段の数 */
export function countLayers(positions: readonly Vec3[]): number {
  return new Set(positions.map((p) => p[1])).size
}
