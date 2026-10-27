// ブロックの変換（平行移動・y 軸まわりの 90° 回転・x / z の反転）。範囲を動かす・回す・反転する・貼り付けで使う
// （docs/design.md「範囲の編集」、#132）。

import type { Box } from './box'
import { HORIZONTAL_DIRECTIONS, type Direction } from './direction'
import type { Vec3 } from './vec3'

/** 反転の向き。'x' は x の向きを逆に（east ↔ west）、'z' は z の向きを逆に（north ↔ south） */
export type MirrorAxis = 'none' | 'x' | 'z'

export type QuarterTurns = 0 | 1 | 2 | 3

/**
 * 変換。pivot のまわりで、先に反転し、次に上から見て右回りに quarterTurns × 90° 回し、最後に translate だけ動かす。
 * マス p の行き先は pivot + 回転(反転(p − pivot)) + translate
 */
export interface BlockTransform {
  readonly translate: Vec3
  readonly quarterTurns: QuarterTurns
  readonly mirror: MirrorAxis
  /** 回転・反転の軸のマス */
  readonly pivot: Vec3
}

/** 平行移動だけの変換 */
export function translation(d: Vec3): BlockTransform {
  return { translate: d, quarterTurns: 0, mirror: 'none', pivot: [0, 0, 0] }
}

/** 回すも反転もしない（平行移動だけ）なら true */
export function isPureTranslation(t: BlockTransform): boolean {
  return t.quarterTurns === 0 && t.mirror === 'none'
}

/** 範囲の中心のマス。中心が2つのマスの間なら小さい側のマス */
export function boxPivot(box: Box): Vec3 {
  return [
    Math.floor((box.min[0] + box.max[0]) / 2),
    Math.floor((box.min[1] + box.max[1]) / 2),
    Math.floor((box.min[2] + box.max[2]) / 2),
  ]
}

/** 範囲を中心のマスのまわりに回す変換。turns は右回りの 90° の数（左回りは 3） */
export function rotationAbout(box: Box, turns: QuarterTurns): BlockTransform {
  return { translate: [0, 0, 0], quarterTurns: turns, mirror: 'none', pivot: boxPivot(box) }
}

/** 範囲をその中で反転する変換。範囲は動かない（幅が偶数でもずれないよう、translate で合わせる） */
export function mirrorWithin(box: Box, axis: 'x' | 'z'): BlockTransform {
  const pivot = boxPivot(box)
  const i = axis === 'x' ? 0 : 2
  const translate: [number, number, number] = [0, 0, 0]
  // pivot での反転は 2·pivot − v。範囲の中での反転は min + max − v
  translate[i] = box.min[i]! + box.max[i]! - 2 * pivot[i]!
  return { translate, quarterTurns: 0, mirror: axis, pivot }
}

// 0 を足して −0 を 0 にする
function negate(v: number): number {
  return 0 - v
}

/** 向きのベクトル（大きさは問わない）に、反転と回転だけを当てる。平行移動はしない */
export function transformVector(t: BlockTransform, v: Vec3): Vec3 {
  let x = v[0]
  let z = v[2]
  if (t.mirror === 'x') x = negate(x)
  if (t.mirror === 'z') z = negate(z)
  // 右回りに 90°：north（−z）→ east（+x）。(x, z) → (−z, x)
  for (let i = 0; i < t.quarterTurns; i++) [x, z] = [negate(z), x]
  return [x, v[1], z]
}

/** transformVector の逆 */
export function inverseTransformVector(t: BlockTransform, v: Vec3): Vec3 {
  let x = v[0]
  let z = v[2]
  // 左回りに 90°：(x, z) → (z, −x)
  for (let i = 0; i < t.quarterTurns; i++) [x, z] = [z, negate(x)]
  if (t.mirror === 'x') x = negate(x)
  if (t.mirror === 'z') z = negate(z)
  return [x, v[1], z]
}

/** マスの行き先 */
export function transformPos(t: BlockTransform, pos: Vec3): Vec3 {
  const p = t.pivot
  const v = transformVector(t, [pos[0] - p[0], pos[1] - p[1], pos[2] - p[2]])
  return [p[0] + v[0] + t.translate[0], p[1] + v[1] + t.translate[1], p[2] + v[2] + t.translate[2]]
}

/** transformPos の逆。行き先から元のマスを求める */
export function inverseTransformPos(t: BlockTransform, pos: Vec3): Vec3 {
  const p = t.pivot
  const v = inverseTransformVector(t, [pos[0] - p[0] - t.translate[0], pos[1] - p[1] - t.translate[1], pos[2] - p[2] - t.translate[2]])
  return [p[0] + v[0], p[1] + v[1], p[2] + v[2]]
}

/**
 * 連続な位置（エンティティの pos など）の行き先。マスの中心 p + 0.5 が transformPos(p) + 0.5 に移るようにする
 */
export function transformPoint(t: BlockTransform, point: Vec3): Vec3 {
  const p = t.pivot
  const v = transformVector(t, [point[0] - p[0] - 0.5, point[1] - p[1] - 0.5, point[2] - p[2] - 0.5])
  return [p[0] + 0.5 + v[0] + t.translate[0], p[1] + 0.5 + v[1] + t.translate[1], p[2] + 0.5 + v[2] + t.translate[2]]
}

/** 範囲の行き先（角を変換して、最小と最大を取り直す） */
export function transformBox(t: BlockTransform, box: Box): Box {
  const a = transformPos(t, box.min)
  const b = transformPos(t, box.max)
  return {
    min: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])],
    max: [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])],
  }
}

/** 水平の向きを、反転してから回す。up / down は変えない */
export function transformDirection(t: BlockTransform, dir: Direction): Direction {
  let d = dir
  if ((t.mirror === 'x' && (d === 'east' || d === 'west')) || (t.mirror === 'z' && (d === 'north' || d === 'south'))) {
    d = d === 'east' ? 'west' : d === 'west' ? 'east' : d === 'north' ? 'south' : 'north'
  }
  const i = HORIZONTAL_DIRECTIONS.indexOf(d)
  if (i < 0) return d
  return HORIZONTAL_DIRECTIONS[(i + t.quarterTurns) % 4]!
}

/** transformDirection の逆 */
export function inverseTransformDirection(t: BlockTransform, dir: Direction): Direction {
  const i = HORIZONTAL_DIRECTIONS.indexOf(dir)
  let d = i < 0 ? dir : HORIZONTAL_DIRECTIONS[(i + 4 - t.quarterTurns) % 4]!
  if ((t.mirror === 'x' && (d === 'east' || d === 'west')) || (t.mirror === 'z' && (d === 'north' || d === 'south'))) {
    d = d === 'east' ? 'west' : d === 'west' ? 'east' : d === 'north' ? 'south' : 'north'
  }
  return d
}

/** 反転の左右が入れ替わるか（左手と右手が入れ替わる）。扉の hinge、階段の inner_left など */
export function flipsHandedness(t: BlockTransform): boolean {
  return t.mirror !== 'none'
}
