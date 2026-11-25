// ベルトをつなぐ（#248。docs/create-stress.md「ベルトをつなぐ」）。
// ゲームでベルトをシャフト2本に使ったときと同じく、つなげるかを調べ、敷くベルトの区間を決める。
// Blueprint は変えない。決めた区間を編集の操作（edit/editCommand の replaceCells）にするのは画面の側。

import { BlockState } from '../../domain/blockState'
import type { Blueprint } from '../../domain/blueprint'
import type { CellValue } from '../../domain/blockVolume'
import { nbt, type NbtTag, type RawNbt } from '../../domain/nbt'
import { ResourceLocation } from '../../domain/resourceLocation'
import type { Vec3 } from '../../domain/vec3'

/** ベルトの長さの上限（`kinetics.maxBeltLength` の初期値。CKinetics.java） */
export const DEFAULT_MAX_BELT_LENGTH = 20

/** 位置を int 配列で書くようになったデータの版（Minecraft 1.20.5。`TF-NBT-POS-FORM`） */
const INT_ARRAY_POS_DATA_VERSION = 3837

const SHAFT_ID = 'create:shaft'
const BELT_ID = 'create:belt'
const BELT = ResourceLocation.parse(BELT_ID)

/**
 * ベルトの区間を敷くときに置き換えられるブロック（Minecraft 1.18 の Material.isReplaceable が true のもの。
 * 1.20 の canBeReplaced も同じ顔ぶれ）。空きマスもここに入る
 */
const REPLACEABLE = new Set([
  'minecraft:air',
  'minecraft:cave_air',
  'minecraft:void_air',
  'minecraft:structure_void',
  'minecraft:light',
  'minecraft:water',
  'minecraft:lava',
  'minecraft:bubble_column',
  'minecraft:grass',
  'minecraft:short_grass',
  'minecraft:tall_grass',
  'minecraft:fern',
  'minecraft:large_fern',
  'minecraft:dead_bush',
  'minecraft:vine',
  'minecraft:glow_lichen',
  'minecraft:hanging_roots',
  'minecraft:crimson_roots',
  'minecraft:warped_roots',
  'minecraft:nether_sprouts',
  'minecraft:seagrass',
  'minecraft:tall_seagrass',
  'minecraft:snow',
  'minecraft:fire',
  'minecraft:soul_fire',
])

type Axis = 'x' | 'y' | 'z'

/** ベルトの区間1つ。並びは始め（part=start）から終わり（part=end）へ */
export interface BeltSegment {
  readonly pos: Vec3
  readonly before: CellValue
  readonly after: CellValue
}

/** 敷くベルト */
export interface BeltPlan {
  readonly segments: readonly BeltSegment[]
}

/** つなぐときに使う値 */
export interface BeltConnectOptions {
  /** ベルトの長さの上限。省略なら初期値（20） */
  readonly maxLength?: number
  /** その位置のシャフトの回転数（符号付き）。分からなければ null */
  readonly speedAt?: (pos: Vec3) => number | null
}

/** state がベルトを掛けられるシャフトなら、その軸。ほかは null（`PL-BELT-SHAFT`） */
export function beltShaftAxis(state: BlockState | null): Axis | null {
  if (!state || state.id.toString() !== SHAFT_ID) return null
  const axis = state.properties['axis']
  return axis === 'x' || axis === 'y' || axis === 'z' ? axis : /* v8 ignore next -- ゲームはシャフトに必ず axis を残す */ null
}

function pick(axis: Axis, v: Vec3): number {
  return axis === 'x' ? v[0] : axis === 'y' ? v[1] : v[2]
}

function cellAt(bp: Blueprint, pos: Vec3): CellValue | null {
  const loc = bp.locate(pos)
  return loc ? loc.region.cellAt(loc.local[0], loc.local[1], loc.local[2]) : null
}

function posText(p: Vec3): string {
  return `(${p[0]}, ${p[1]}, ${p[2]})`
}

/** 間のマスに置けるか（`PL-BELT-BETWEEN`）。同じ軸のシャフトか、置き換えられるブロック */
function passable(state: BlockState | null, axis: Axis): boolean {
  if (state === null) return true
  if (beltShaftAxis(state) === axis) return true
  return REPLACEABLE.has(state.id.toString())
}

/** 水の源があるマスか。そこに置く区間は waterlogged=true（`PL-BELT-WATER`） */
function hasWaterSource(state: BlockState | null): boolean {
  if (!state) return false
  const id = state.id.toString()
  if (id === 'minecraft:water') {
    /* v8 ignore next -- ゲームは水に必ず level を残す */
    const level = state.properties['level'] ?? '0'
    return level === '0'
  }
  if (id === 'minecraft:bubble_column') return true
  return state.properties['waterlogged'] === 'true'
}

/**
 * 2本のシャフトをベルトでつなげるか調べる（BeltConnectorItem.canConnect と validateAxis）。
 * つなげるなら null、つなげないなら画面に出す理由
 */
export function beltConnectionProblem(bp: Blueprint, first: Vec3, second: Vec3, options: BeltConnectOptions = {}): string | null {
  const a = beltShaftAxis(bp.get(first))
  const b = beltShaftAxis(bp.get(second))
  if (a === null || b === null) return 'ベルトを掛けられるのはシャフトだけです。シャフトを2本選んでください。'
  const diff: Vec3 = [second[0] - first[0], second[1] - first[1], second[2] - first[2]]
  const maxLength = options.maxLength ?? DEFAULT_MAX_BELT_LENGTH
  const distSq = diff[0] ** 2 + diff[1] ** 2 + diff[2] ** 2
  if (distSq >= maxLength * maxLength) {
    return `ベルトが長すぎます。2本のシャフトの距離を ${maxLength} マスより短くしてください。`
  }
  if (a !== b) return '2本のシャフトの軸の向きが違います。同じ向きのシャフトどうしをつないでください。'
  if (pick(a, diff) !== 0) return '2本のシャフトが軸の向きにずれています。軸に垂直な同じ面の上で選んでください。'
  const [x, y, z] = diff.map(Math.abs) as [number, number, number]
  const sames = (x === y ? 1 : 0) + (y === z ? 1 : 0) + (z === x ? 1 : 0)
  if (sames !== 1 || (a === 'y' && diff[0] !== 0 && diff[2] !== 0)) {
    return a === 'y'
      ? '縦のシャフトは、水平にまっすぐ並んだものだけをつなげます。'
      : 'ベルトは、まっすぐか 45 度の斜めにしか掛けられません。'
  }
  const s1 = options.speedAt?.(first) ?? null
  const s2 = options.speedAt?.(second) ?? null
  if (s1 !== null && s2 !== null && s1 !== 0 && s2 !== 0 && Math.sign(s1) !== Math.sign(s2)) {
    return '2本のシャフトが逆向きに回っています。同じ向きに回るシャフトどうしをつないでください。'
  }
  const step: Vec3 = [Math.sign(diff[0]), Math.sign(diff[1]), Math.sign(diff[2])]
  for (let p = add(first, step); !same(p, second); p = add(p, step)) {
    const cell = cellAt(bp, p)
    if (!cell) return `間の ${posText(p)} が設計図の外です。`
    if (!passable(cell.state, a)) return `間の ${posText(p)} にブロックがあります。どけるか、別のシャフトを選んでください。`
  }
  return null
}

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

function same(a: Vec3, b: Vec3): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2]
}

/** 傾き（BeltConnectorItem.getSlopeBetween） */
function slopeBetween(diff: Vec3): 'horizontal' | 'upward' | 'downward' | 'vertical' {
  if (diff[1] !== 0) {
    if (diff[0] !== 0 || diff[2] !== 0) return diff[1] > 0 ? 'upward' : 'downward'
    return 'vertical'
  }
  return 'horizontal'
}

/** 向き（getFacingFromTo と、縦のベルトの向きの決め直し） */
function facingBetween(diff: Vec3, shaftAxis: Axis): 'north' | 'south' | 'east' | 'west' {
  if (diff[0] === diff[2]) {
    // 縦（x・z の差がどちらも 0）：上へ向かうなら正の向き。軸はシャフトに垂直な水平の軸
    const positive = diff[1] > 0
    return shaftAxis === 'x' ? (positive ? 'south' : 'north') : positive ? 'east' : 'west'
  }
  if (diff[0] === 0) return diff[2] > 0 ? 'south' : 'north'
  return diff[0] > 0 ? 'east' : 'west'
}

/** 区間の並び（getBeltChainBetween）。始めから終わりまで */
function chainBetween(start: Vec3, end: Vec3, slope: string, facing: string): Vec3[] {
  const dir: Record<string, Vec3> = { north: [0, 0, -1], south: [0, 0, 1], east: [1, 0, 0], west: [-1, 0, 0] }
  const positive = facing === 'south' || facing === 'east'
  const result: Vec3[] = []
  let current = start
  let limit = 1000
  do {
    result.push(current)
    if (slope === 'vertical') current = add(current, [0, positive ? 1 : -1, 0])
    else {
      current = add(current, dir[facing]!)
      if (slope !== 'horizontal') current = add(current, [0, slope === 'upward' ? 1 : -1, 0])
    }
  } while (!same(current, end) && limit-- > 0)
  result.push(end)
  return result
}

/** 位置を生データに書く（`TF-NBT-POS-FORM`）。1.20.5 からは int 配列、それより前は {X, Y, Z} */
function posTag(p: Vec3, dataVersion: number): NbtTag {
  if (dataVersion >= INT_ARRAY_POS_DATA_VERSION) return nbt.intArray(p)
  return nbt.compound({ X: nbt.int(p[0]), Y: nbt.int(p[1]), Z: nbt.int(p[2]) })
}

/**
 * 区間の生データ（BeltBlock.initBelt と BeltBlockEntity.write。`PL-BELT-NBT`）。
 * Controller は始めの区間の位置。ワールドの位置は分からないので、設計図の中の位置で書く（`PL-BELT-NBT-ORIGIN`）
 */
function beltBlockEntity(controller: Vec3, length: number, index: number, dataVersion: number): RawNbt {
  return nbt.compound({
    id: nbt.string(BELT_ID),
    Controller: posTag(controller, dataVersion),
    IsController: nbt.byte(index === 0 ? 1 : 0),
    Length: nbt.int(length),
    Index: nbt.int(index),
    Casing: nbt.string('NONE'),
    Covered: nbt.byte(0),
  })
}

/**
 * first から second へベルトを敷く（BeltConnectorItem.createBelts）。
 * つなげないときは理由（beltConnectionProblem）。first と second が同じなら null（ゲームでも何もしない）
 */
export function planBeltConnection(
  bp: Blueprint,
  first: Vec3,
  second: Vec3,
  options: BeltConnectOptions = {},
): BeltPlan | string | null {
  if (same(first, second)) return null
  const problem = beltConnectionProblem(bp, first, second, options)
  if (problem) return problem
  const shaftAxis = beltShaftAxis(bp.get(first))!
  const diff: Vec3 = [second[0] - first[0], second[1] - first[1], second[2] - first[2]]
  let slope: string = slopeBetween(diff)
  const facing = facingBetween(diff, shaftAxis)
  const chain = chainBetween(first, second, slope, facing)
  const segments: BeltSegment[] = []
  chain.forEach((pos, index) => {
    const before = cellAt(bp, pos)!
    const pulley = beltShaftAxis(before.state) !== null
    let part = index === 0 ? 'start' : index === chain.length - 1 ? 'end' : 'middle'
    if (part === 'middle' && pulley) part = 'pulley'
    // 縦のシャフトに掛けたベルトは横倒し（ゲームでは、シャフトに当たった区間から先がすべて sideways）
    if (pulley && shaftAxis === 'y') slope = 'sideways'
    const state = new BlockState(BELT, {
      casing: 'false',
      facing,
      part,
      slope,
      waterlogged: hasWaterSource(before.state) ? 'true' : 'false',
    })
    segments.push({ pos, before, after: { state, blockEntity: beltBlockEntity(first, chain.length, index, bp.dataVersion) } })
  })
  return { segments }
}
