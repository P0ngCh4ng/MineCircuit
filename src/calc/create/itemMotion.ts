// 物の流れの表示の、物の道の形（docs/create-throughput.md「物の動き（#233）」）。
// 位置はブロック座標の連続値（ブロック p の中心は p + 0.5）、時間は秒。

import type { Vec3 } from '../../domain/vec3'
import type { CalcItemMovePoint } from '../calcPlugin'
import { TICKS_PER_SECOND } from './createThroughput'

/** 放り出した物が 1 tick に下向きに加速する量（Minecraft の落ちる物） */
const ITEM_GRAVITY = 0.04
/** 放り出した物の速さに 1 tick ごとに掛ける値 */
const ITEM_DRAG = 0.98
/** 落ちる動きを数える上限（tick） */
const MAX_FALL_TICKS = 200

/** ブロックの中心 */
export function blockCenter(p: Vec3): Vec3 {
  return [p[0] + 0.5, p[1] + 0.5, p[2] + 0.5]
}

/** 道の形と、かかる秒数 */
export interface MotionPath {
  readonly seconds: number
  readonly path: CalcItemMovePoint[]
}

/**
 * 放り出した物の道。start から、上下の速さ vy（ブロック/tick、上が正）で出て、end の高さまで落ちる。
 * 横は start から end へ、かかる時間でまっすぐ進むとする（横の速さは、落ちる先を決める規則で決まっているので）
 */
export function throwPath(start: Vec3, end: Vec3, vy: number): MotionPath {
  const heights: number[] = [start[1]]
  let y = start[1]
  let v = vy
  for (let tick = 0; tick < MAX_FALL_TICKS; tick++) {
    v -= ITEM_GRAVITY
    y += v
    v *= ITEM_DRAG
    if (v < 0 && y <= end[1]) {
      heights.push(end[1])
      break
    }
    heights.push(y)
  }
  if (heights[heights.length - 1] !== end[1]) heights.push(end[1])
  const ticks = heights.length - 1
  const path = heights.map((h, i) => {
    const u = ticks > 0 ? i / ticks : 1
    return {
      t: i / TICKS_PER_SECOND,
      pos: [start[0] + (end[0] - start[0]) * u, h, start[2] + (end[2] - start[2]) * u] as Vec3,
    }
  })
  return { seconds: ticks / TICKS_PER_SECOND, path }
}

/** 弧の道。start から、over の上を通って end へ、seconds 秒で進む（機械アーム） */
export function arcPath(start: Vec3, over: Vec3, end: Vec3, seconds: number): MotionPath {
  const steps = 12
  const path: CalcItemMovePoint[] = []
  for (let i = 0; i <= steps; i++) {
    const u = i / steps
    const a = (1 - u) * (1 - u)
    const b = 2 * u * (1 - u)
    const c = u * u
    path.push({
      t: seconds * u,
      pos: [a * start[0] + b * over[0] + c * end[0], a * start[1] + b * over[1] + c * end[1], a * start[2] + b * over[2] + c * end[2]],
    })
  }
  return { seconds, path }
}

/**
 * 重さ付きイジェクターが投げる物の道（Create の EntityLauncher）。h は横、v は縦の距離（生データの HorizontalDistance・VerticalDistance）。
 * start はイジェクターの上、dir は投げる向き（水平の単位ベクトル）。Create と同じく、終わりに近いほど強く end に寄せる
 */
export function ejectorPath(start: Vec3, dir: Vec3, h: number, v: number, end: Vec3): MotionPath {
  const yPeak = Math.max(0, v + (h + 0.5) / 8) + (h <= 1 ? 1 : 4)
  const yMotion = Math.sqrt((2 * yPeak) / 13) + 0.015 * yPeak
  const tPeak = Math.log(98 / (25 * yMotion + 98)) / (2 * Math.log(7) - 2 * Math.log(5) - Math.log(2))
  const total = Math.max(3, Math.sqrt(yPeak - yMotion) * 4.87 + 0.115 * (yPeak - yMotion) + tPeak)
  const xError = -0.0007 * (h + 0.5) ** 2 + 0.484 - (Math.min(5, v) / 5) * Math.min(1, 0.076 * h - 0.0014 * h * h)
  const xMotion = (h - xError + 0.5) / (-10.6033 * (-1 + 0.91 ** total))
  const raw = (t: number): Vec3 => {
    const x = xMotion * -10.6033 * (-1 + 0.91 ** t)
    const f = 0.98 ** t
    const y = yMotion * -49.4983 * f + 49.4983 * yMotion - 194.033 * f - 3.92 * t + 194.033
    return [start[0] + dir[0] * x, start[1] + y, start[2] + dir[2] * x]
  }
  const last = raw(total)
  const miss: Vec3 = [end[0] - last[0], end[1] - last[1], end[2] - last[2]]
  const ticks = Math.ceil(total)
  const path: CalcItemMovePoint[] = []
  for (let i = 0; i <= ticks; i++) {
    const t = Math.min(i, total)
    const p = raw(t)
    const k = (t / total) ** 3
    path.push({ t: t / TICKS_PER_SECOND, pos: [p[0] + miss[0] * k, p[1] + miss[1] * k, p[2] + miss[2] * k] })
  }
  return { seconds: total / TICKS_PER_SECOND, path }
}

