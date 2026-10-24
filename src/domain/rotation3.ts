// ブロックの中心まわりの、90 度単位の回転（3×3 の行列）。
// blockstates の x・y では表せない向き（Create の横向きのベルトなど）に使う（docs/design.md「部品のモデルの表」）。
// 座標は Minecraft と同じ（x が東、y が上、z が南）。回転は右手系（正の軸から見て反時計回りが正の角度）。

import type { Vec3 } from './vec3'

/** 行の順に並べた 3×3 の行列。要素は -1・0・1 */
export type Rotation3 = readonly [number, number, number, number, number, number, number, number, number]

export const IDENTITY_ROTATION: Rotation3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]

/** axis のまわりに deg 度（90 の倍数）回す行列。右手系 */
export function axisRotation(axis: 'x' | 'y' | 'z', deg: number): Rotation3 {
  const turns = ((Math.round(deg / 90) % 4) + 4) % 4
  const c = [1, 0, -1, 0][turns]!
  const s = [0, 1, 0, -1][turns]!
  // -s を表から取り、-0 を作らない
  const ns = [0, -1, 0, 1][turns]!
  switch (axis) {
    case 'x':
      return [1, 0, 0, 0, c, ns, 0, s, c]
    case 'y':
      return [c, 0, s, 0, 1, 0, ns, 0, c]
    case 'z':
      return [c, ns, 0, s, c, 0, 0, 0, 1]
  }
}

/** a × b。ベクトルには b を先に、次に a を当てる */
export function multiplyRotation(a: Rotation3, b: Rotation3): Rotation3 {
  const out: number[] = []
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) out.push(a[r * 3]! * b[c]! + a[r * 3 + 1]! * b[3 + c]! + a[r * 3 + 2]! * b[6 + c]!)
  }
  return out as unknown as Rotation3
}

/** 行列をつなげる。並べた順の逆に当たる（Create の TransformStack と同じ書き方：先に書いたものが外側） */
export function composeRotations(...rotations: readonly Rotation3[]): Rotation3 {
  return rotations.reduce((acc, r) => multiplyRotation(acc, r), IDENTITY_ROTATION)
}

/** ベクトルを回す */
export function rotateVector(m: Rotation3, v: Vec3): Vec3 {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ]
}
