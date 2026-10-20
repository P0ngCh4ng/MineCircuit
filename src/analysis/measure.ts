// 計測。docs/design.md「analysis：計測」。
// 2つのブロックの座標の差、直線距離、軸に沿った距離、囲む範囲を求める。

import { subVec3, type Vec3 } from '../domain/vec3'

/** 2つのブロックの計測結果 */
export interface Measurement {
  readonly a: Vec3
  readonly b: Vec3
  /** b - a */
  readonly delta: Vec3
  /** 直線距離（ブロックの中心どうし） */
  readonly euclidean: number
  /** 軸に沿った距離。シャフトやベルトを引く長さの目安 */
  readonly manhattan: number
  /** 2点を囲む範囲（両端のブロックを含む。同じブロックなら 1×1×1） */
  readonly boundingSize: Vec3
}

/** a から b までを測る */
export function measure(a: Vec3, b: Vec3): Measurement {
  const delta = subVec3(b, a)
  const [dx, dy, dz] = delta.map(Math.abs) as [number, number, number]
  return {
    a,
    b,
    delta,
    euclidean: Math.hypot(dx, dy, dz),
    manhattan: dx + dy + dz,
    boundingSize: [dx + 1, dy + 1, dz + 1],
  }
}
