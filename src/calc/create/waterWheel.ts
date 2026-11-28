// 水車が周りの液体の流れから FlowScore を決める（ST-WATER-WHEEL-FLOW）。
// 出典は Create の WaterWheelBlockEntity（determineAndApplyFlowScore・getFlowVectorAtPosition）。
import type { Blueprint } from '../../domain/blueprint'
import { addVec3, type Vec3 } from '../../domain/vec3'
import type { FluidField } from '../fluidFlow'
import { AXES, type Axis } from './kineticBlocks'

export interface WaterWheelFlow {
  /** 足し合わせた向きの数（−1〜1 に収める前） */
  readonly score: number
  /** 見るマスに設計図の外があった */
  readonly outside: boolean
  /** 広げる計算で決めた液体の流れを数えた */
  readonly simulated: boolean
}

/** 見るマス（水車の中心からのずれ）。小さい水車は軸に垂直な4方向、大きい水車は2つ先の12マス */
export function waterWheelOffsets(axis: Axis, large: boolean): Vec3[] {
  const a = AXES.indexOf(axis)
  const [u, v] = AXES.map((_, i) => i).filter((i) => i !== a)
  const make = (du: number, dv: number): Vec3 => {
    const p = [0, 0, 0]
    p[u] = du
    p[v] = dv
    return [p[0], p[1], p[2]]
  }
  if (!large) return [make(1, 0), make(-1, 0), make(0, 1), make(0, -1)]
  const result: Vec3[] = []
  for (const s of [2, -2]) {
    for (const side of [-1, 0, 1]) result.push(make(s, side), make(side, s))
  }
  return result
}

/** 中心からマスへの向きを軸のまわりに 90° 回したもの（羽の進む向き） */
function positiveMotion(offset: Vec3, axis: Axis): Vec3 {
  const len = Math.hypot(offset[0], offset[1], offset[2])
  const [x, y, z] = [offset[0] / len, offset[1] / len, offset[2] / len]
  if (axis === 'x') return [x, -z, y]
  if (axis === 'y') return [z, y, -x]
  return [-y, x, z]
}

/** マスの流れ。泡の柱は上か下の向き */
function flowAt(bp: Blueprint, field: FluidField, pos: Vec3): Vec3 {
  const state = bp.get(pos)
  if (state?.id.toString() === 'minecraft:bubble_column') return [0, state.properties.drag === 'true' ? -1 : 1, 0]
  return field.flow(pos)
}

export function waterWheelFlow(bp: Blueprint, field: FluidField, pos: Vec3, axis: Axis, large: boolean): WaterWheelFlow {
  const a = AXES.indexOf(axis)
  let score = 0
  let outside = false
  let simulated = false
  for (const offset of waterWheelOffsets(axis, large)) {
    const target = addVec3(pos, offset)
    if (!bp.locate(target)) outside = true
    const f = [...flowAt(bp, field, target)]
    f[a] = 0
    const len = Math.hypot(f[0], f[1], f[2])
    if (len === 0) continue
    const motion = positiveMotion(offset, axis)
    const dot = (f[0] * motion[0] + f[1] * motion[1] + f[2] * motion[2]) / len
    if (Math.abs(dot) <= 0.5) continue
    score += Math.sign(dot)
    if (field.simulated(target)) simulated = true
  }
  return { score, outside, simulated }
}
