import type { Direction } from '../../domain/direction'
import type { Vec3 } from '../../domain/vec3'
import type { PickTarget } from './tool'

/*
 * Picker：マウス位置から PickTarget を求める。docs/design.md「view」。
 * Three.js にも canvas にも依存しない計算だけを置き、3D表示（#9）と2D表示（#14）から呼ぶ。
 *
 * 座標の決まり：ブロック座標 p のブロックは [p, p+1) の立方体を占める（設計図の原点が 0）。
 * 3D表示でメッシュをずらして置く場合は、レイをブロック座標に直してから渡す。
 */

/** 3D のレイ。ブロック座標で表す。direction は正規化していなくてよい */
export interface PickRay {
  readonly origin: Vec3
  readonly direction: Vec3
}

/** 3D で当たり判定をする対象 */
export interface PickScene3D {
  /** 設計図の大きさ。この範囲の外は当たらない */
  readonly size: Vec3
  /** 今の段（y）。ブロックに当たらなければ、この段の床（y = layer の面）の空きマスを返す */
  readonly layer: number | null
  /**
   * 当たり判定の対象なら true。ブロックがあり、かつ表示しているマス。
   * 段の表示方法で隠したブロックは false にする
   */
  isSolid(pos: Vec3): boolean
}

// 軸ごとに、正の向きへ進んで入ったときに当たる面（入った側の面）
const ENTRY_FACE_POSITIVE: readonly Direction[] = ['west', 'down', 'north']
const ENTRY_FACE_NEGATIVE: readonly Direction[] = ['east', 'up', 'south']

function entryFace(axis: number, step: number): Direction {
  return (step > 0 ? ENTRY_FACE_POSITIVE : ENTRY_FACE_NEGATIVE)[axis]
}

function inBounds(p: Vec3, size: Vec3): boolean {
  return p[0] >= 0 && p[1] >= 0 && p[2] >= 0 && p[0] < size[0] && p[1] < size[1] && p[2] < size[2]
}

/** レイと箱 [0, size) が重なる範囲 [tEnter, tExit] と、入った軸。重ならなければ null */
function clipToBox(ray: PickRay, size: Vec3): { tEnter: number; tExit: number; axis: number } | null {
  let tEnter = 0
  let tExit = Infinity
  let axis = -1
  for (let i = 0; i < 3; i++) {
    const o = ray.origin[i]
    const d = ray.direction[i]
    if (d === 0) {
      if (o < 0 || o >= size[i]) return null
      continue
    }
    let t1 = (0 - o) / d
    let t2 = (size[i] - o) / d
    if (t1 > t2) [t1, t2] = [t2, t1]
    if (t1 > tEnter) {
      tEnter = t1
      axis = i
    }
    tExit = Math.min(tExit, t2)
  }
  return tEnter <= tExit ? { tEnter, tExit, axis } : null
}

/**
 * レイが最初に当たるブロックを、マス目を順にたどって求める（Amanatides & Woo の方法）。
 * 当たったブロックの座標、入った面、レイの距離 t を返す。当たらなければ null。
 */
export function castRay(ray: PickRay, scene: Pick<PickScene3D, 'size' | 'isSolid'>): { pos: Vec3; face?: Direction; t: number } | null {
  const clip = clipToBox(ray, scene.size)
  if (!clip) return null
  const { origin: o, direction: d } = ray
  // 箱に入った点から、少しだけ内側の点でマスを決める
  const t0 = clip.tEnter
  const start = [o[0] + d[0] * t0, o[1] + d[1] * t0, o[2] + d[2] * t0]
  const cell = [0, 1, 2].map((i) => Math.min(Math.max(Math.floor(start[i]), 0), scene.size[i] - 1))
  const step = [0, 1, 2].map((i) => Math.sign(d[i]))
  const tDelta = [0, 1, 2].map((i) => (d[i] === 0 ? Infinity : Math.abs(1 / d[i])))
  const tMax = [0, 1, 2].map((i) => {
    if (d[i] === 0) return Infinity
    const boundary = step[i] > 0 ? cell[i] + 1 : cell[i]
    return (boundary - o[i]) / d[i]
  })
  // 外から入ったときは入った面。レイの始点が箱の中なら面は決められない
  let face: Direction | undefined = clip.axis >= 0 ? entryFace(clip.axis, step[clip.axis]) : undefined
  let t = t0

  for (;;) {
    const pos: Vec3 = [cell[0], cell[1], cell[2]]
    if (!inBounds(pos, scene.size)) return null
    if (scene.isSolid(pos)) return face === undefined ? { pos, t } : { pos, face, t }
    // tMax が一番小さい軸の境界を越える
    let axis = 0
    if (tMax[1] < tMax[axis]) axis = 1
    if (tMax[2] < tMax[axis]) axis = 2
    t = tMax[axis]
    if (t > clip.tExit) return null
    cell[axis] += step[axis]
    tMax[axis] += tDelta[axis]
    face = entryFace(axis, step[axis])
  }
}

/** レイが段 layer の床（y = layer の面）と交わる空きマス。範囲の外や交わらなければ null */
export function pickLayerFloor(ray: PickRay, size: Vec3, layer: number): { pos: Vec3; t: number } | null {
  const dy = ray.direction[1]
  if (dy === 0) return null
  const t = (layer - ray.origin[1]) / dy
  if (t < 0) return null
  const x = Math.floor(ray.origin[0] + ray.direction[0] * t)
  const z = Math.floor(ray.origin[2] + ray.direction[2] * t)
  const pos: Vec3 = [x, layer, z]
  return inBounds(pos, size) ? { pos, t } : null
}

/**
 * 3D表示の Picker。手前にあるほうを返す。
 * - ブロック：当たったブロックと面（empty: false）
 * - 今の段の床：その段の空きマス（empty: true、face なし）
 * どちらもなければ null。
 */
export function pick3D(ray: PickRay, scene: PickScene3D): PickTarget | null {
  const hit = castRay(ray, scene)
  const floor = scene.layer === null ? null : pickLayerFloor(ray, scene.size, scene.layer)
  if (hit && (!floor || hit.t <= floor.t)) {
    if (hit.face === undefined) return { pos: hit.pos, empty: false }
    const { origin: o, direction: d } = ray
    const point: Vec3 = [o[0] + d[0] * hit.t, o[1] + d[1] * hit.t, o[2] + d[2] * hit.t]
    return { pos: hit.pos, face: hit.face, point, empty: false }
  }
  if (floor) return { pos: floor.pos, empty: !scene.isSolid(floor.pos) }
  return null
}

/** 2D表示のマス目の置き方。canvas のピクセルで表す */
export interface GridLayout2D {
  /** マス (x=0, z=0) の左上の位置 */
  readonly originX: number
  readonly originY: number
  /** 1マスの大きさ */
  readonly cellSize: number
}

/** 2D表示で当たり判定をする対象 */
export interface PickScene2D {
  readonly size: Vec3
  /** 表示している段（y） */
  readonly layer: number
  /** ブロックがあれば true */
  isFilled(pos: Vec3): boolean
}

/**
 * 2D表示の Picker。上が北（−Z）なので、横が x、縦が z。
 * (px, py) は canvas の中の位置。マス目の外なら null。
 */
export function pick2D(px: number, py: number, grid: GridLayout2D, scene: PickScene2D): PickTarget | null {
  const x = Math.floor((px - grid.originX) / grid.cellSize)
  const z = Math.floor((py - grid.originY) / grid.cellSize)
  const pos: Vec3 = [x, scene.layer, z]
  if (!inBounds(pos, scene.size)) return null
  return { pos, empty: !scene.isFilled(pos) }
}
