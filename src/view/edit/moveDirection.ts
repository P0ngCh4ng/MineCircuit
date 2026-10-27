// 範囲を動かす向き（docs/ui.md「動かす」、#131）。キーの向きを、設計図の座標の1マスの動きに直す。

import type { Vec3 } from '../../domain/vec3'
import type { ViewMode } from '../stores/viewStore'
import type { MoveDirection } from '../tools/keymap'

// 水平の向きを、一番近い x か z の向きの1マスにする。同じなら x
function snapHorizontal(x: number, z: number): Vec3 {
  if (Math.abs(x) >= Math.abs(z)) return [Math.sign(x) || 1, 0, 0]
  return [0, 0, Math.sign(z)]
}

/**
 * キーの向きを1マスの動きにする。
 * 2D は画面の上が −Z、右が +X。3D は、カメラが向いている水平の向き heading [x, z] に一番近い x・z の向きを「上」にする。
 * raise / lower はどちらでも y の ±1
 */
export function moveVector(direction: MoveDirection, mode: ViewMode, heading: readonly [number, number]): Vec3 {
  if (direction === 'raise') return [0, 1, 0]
  if (direction === 'lower') return [0, -1, 0]
  const forward: Vec3 = mode === '2d' ? [0, 0, -1] : snapHorizontal(heading[0], heading[1])
  // 画面の右 = 前 × 上（y）
  const right: Vec3 = [0 - forward[2], 0, forward[0]]
  switch (direction) {
    case 'up':
      return forward
    case 'down':
      return negate(forward)
    case 'right':
      return right
    case 'left':
      return negate(right)
  }
}

// −0 を作らないよう 0 から引く
function negate(v: Vec3): Vec3 {
  return [0 - v[0], 0 - v[1], 0 - v[2]]
}
