// 範囲（箱）。両端の角を含む。範囲の選択と一括操作で使う（docs/design.md「範囲の編集」、#129）。

import type { Vec3 } from './vec3'

/** x・y・z の最小と最大の角。どちらの角も範囲に含む */
export interface Box {
  readonly min: Vec3
  readonly max: Vec3
}

/** 2つの角から箱を作る。角の順は問わない */
export function boxFromCorners(a: Vec3, b: Vec3): Box {
  return {
    min: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])],
    max: [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])],
  }
}

/** 1マスだけの箱 */
export function singleCellBox(pos: Vec3): Box {
  return { min: [pos[0], pos[1], pos[2]], max: [pos[0], pos[1], pos[2]] }
}

/** 大きさ（各辺のマスの数） */
export function boxSize(box: Box): Vec3 {
  return [box.max[0] - box.min[0] + 1, box.max[1] - box.min[1] + 1, box.max[2] - box.min[2] + 1]
}

/** マスの数 */
export function boxVolume(box: Box): number {
  const [x, y, z] = boxSize(box)
  return x * y * z
}

/** 1マスだけか */
export function isSingleCell(box: Box): boolean {
  return boxVolume(box) === 1
}

export function boxContains(box: Box, pos: Vec3): boolean {
  for (let a = 0; a < 3; a++) {
    if (pos[a]! < box.min[a]! || pos[a]! > box.max[a]!) return false
  }
  return true
}

export function boxEquals(a: Box, b: Box): boolean {
  for (let i = 0; i < 3; i++) {
    if (a.min[i] !== b.min[i] || a.max[i] !== b.max[i]) return false
  }
  return true
}

/** 大きさ size の設計図（0 から size − 1）と重なる部分。重ならなければ null */
export function clampBox(box: Box, size: Vec3): Box | null {
  const min: number[] = []
  const max: number[] = []
  for (let a = 0; a < 3; a++) {
    min.push(Math.max(0, box.min[a]!))
    max.push(Math.min(size[a]! - 1, box.max[a]!))
    if (min[a]! > max[a]!) return null
  }
  return { min: [min[0]!, min[1]!, min[2]!], max: [max[0]!, max[1]!, max[2]!] }
}

/** 箱の中のマスを y → z → x の順にたどる */
export function forEachInBox(box: Box, fn: (pos: Vec3) => void): void {
  for (let y = box.min[1]; y <= box.max[1]; y++) {
    for (let z = box.min[2]; z <= box.max[2]; z++) {
      for (let x = box.min[0]; x <= box.max[0]; x++) fn([x, y, z])
    }
  }
}
