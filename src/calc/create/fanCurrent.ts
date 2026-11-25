// 扇風機の風（docs/create-throughput.md「扇風機」の TP-FAN・TP-FAN-CATALYST・TP-FAN-ON-BELT）。
// 設計図の扇風機ごとに、風の届くマスと、マスごとの処理の種類（洗う・憑依・燻す・焼く）を求める。

import type { BlockState } from '../../domain/blockState'
import type { Blueprint } from '../../domain/blueprint'
import { directionVector, isDirection, oppositeDirection, type Direction } from '../../domain/direction'
import { addVec3, type Vec3 } from '../../domain/vec3'
import { directionAxis } from './kineticBlocks'

/** 扇風機の処理の種類（優先度の高い順。AllFanProcessingTypes の getPriority） */
export type FanProcessingKind = 'splashing' | 'haunting' | 'smoking' | 'blasting'

/** 処理の種類の名前（画面・仮定の文） */
export const FAN_PROCESSING_NAMES: Readonly<Record<FanProcessingKind, string>> = {
  splashing: '洗う',
  haunting: '憑依',
  smoking: '燻す',
  blasting: '焼く',
}

/** 風の通り道のマス1つ分 */
export interface FanCell {
  /** 扇風機の位置 */
  readonly fan: Vec3
  /** 扇風機から何マス目か（1 から） */
  readonly offset: number
  /** 処理の種類。何もしない風なら null */
  readonly kind: FanProcessingKind | null
}

/** 設計図の扇風機の風 */
export interface FanCurrents {
  /** pos のマスにかかる風（放り出した物を処理する。TP-FAN-DROPPED）。いくつかの扇風機の風が重なることがある */
  cellsAt(pos: Vec3): readonly FanCell[]
  /** pos のベルト・デポの上の物を処理する風（TP-FAN-ON-BELT）。種類はブロック自身の種類か、風の種類 */
  handlersAt(pos: Vec3): readonly FanCell[]
}

/** `fanPushDistance`・`fanPullDistance` の初期値 */
const FAN_DISTANCE = 20
/** `fanRotationArgmax` の初期値 */
const FAN_ROTATION_ARGMAX = 256

/** 扇風機を通すブロック（タグ `create:fan_transparent`。0.5.1 と 6.0 の jar の中身） */
const FAN_TRANSPARENT = new Set([
  'create:blaze_burner',
  'create:lit_blaze_burner',
  'create:sail_frame',
  'create:andesite_bars',
  'create:brass_bars',
  'create:copper_bars',
  'create:copycat_base',
  'minecraft:iron_bars',
  'minecraft:mangrove_roots',
  'minecraft:campfire',
  'minecraft:soul_campfire',
])
/** 当たり判定のないブロック（風を止めない） */
const NO_COLLISION = new Set([
  'minecraft:air',
  'minecraft:cave_air',
  'minecraft:void_air',
  'minecraft:water',
  'minecraft:lava',
  'minecraft:fire',
  'minecraft:soul_fire',
])

/**
 * 風の向き。回転数を facing の向きの符号に直した値が正なら facing（押す）、負なら逆（引く）。回転数 0 なら null
 * （EncasedFanBlockEntity.getAirFlowDirection、KineticBlockEntity.convertToDirection）
 */
export function fanAirflowDirection(rpm: number, facing: Direction): Direction | null {
  if (rpm === 0) return null
  const positive = facing === 'east' || facing === 'up' || facing === 'south'
  const speed = positive ? rpm : -rpm
  return speed > 0 ? facing : oppositeDirection(facing)
}

/** 風の届く距離（ブロック）。lerp(min(|回転数| / 256, 1), 3, 20)（IAirCurrentSource.getMaxDistance） */
export function fanMaxDistance(rpm: number): number {
  const t = Math.min(Math.abs(rpm) / FAN_ROTATION_ARGMAX, 1)
  return 3 + (FAN_DISTANCE - 3) * t
}

/** マスのブロックの処理の種類（FanProcessingType.getAt）。なければ null */
export function fanCatalyst(state: BlockState | null): FanProcessingKind | null {
  if (!state) return null
  const id = state.id.toString()
  const p = state.properties
  if (id === 'minecraft:water' || p.waterlogged === 'true') return 'splashing'
  if (id === 'minecraft:soul_fire') return 'haunting'
  if (id === 'minecraft:soul_campfire') return p.lit === 'false' ? null : 'haunting'
  if (id === 'create:lit_blaze_burner') {
    if (p.flame_type === 'soul') return 'haunting'
    /* v8 ignore next -- ゲームは flame_type に regular か soul を必ず残すので、ここは regular だけが来る */
    return p.flame_type === 'regular' || p.flame_type === undefined ? 'smoking' : null
  }
  if (id === 'minecraft:fire') return 'smoking'
  if (id === 'minecraft:campfire') return p.lit === 'false' ? null : 'smoking'
  if (id === 'create:blaze_burner') {
    if (p.blaze === 'smouldering') return 'smoking'
    if (p.blaze === 'fading' || p.blaze === 'kindled' || p.blaze === 'seething') return 'blasting'
    return null
  }
  if (id === 'minecraft:lava') return 'blasting'
  return null
}

/**
 * 風がマスをどう通るか（AirCurrent.getFlowLimit。計算の決めごとは書類の表）。
 * 'pass' は通す、'into' はそのマスまで届いて止まる、'stop' はそのマスの手前で止まる
 */
function flowThrough(state: BlockState | null, air: Direction): 'pass' | 'into' | 'stop' {
  if (!state) return 'pass'
  const id = state.id.toString()
  if (NO_COLLISION.has(id) || FAN_TRANSPARENT.has(id)) return 'pass'
  const path = state.id.path
  if (id.startsWith('minecraft:') && (path.endsWith('_fence') || path.endsWith('_leaves'))) return 'pass'
  if (/^minecraft:(waxed_)?(exposed_|weathered_|oxidized_)?copper_grate$/.test(id)) return 'pass'
  if (id === 'create:andesite_funnel' || id === 'create:brass_funnel') {
    const f = state.properties.facing
    return (f === 'up' || f === 'down') && directionAxis(air) !== 'y' ? 'pass' : 'into'
  }
  if (id === 'create:andesite_belt_funnel' || id === 'create:brass_belt_funnel' || id === 'create:belt' || id === 'create:depot') return 'into'
  return 'stop'
}

/** 設計図の扇風機の風を求める。rpmAt は回るブロックの回転数（止まっていれば 0） */
export function findFanCurrents(bp: Blueprint, rpmAt: (pos: Vec3) => number | null): FanCurrents {
  const cells = new Map<string, FanCell[]>()
  const handlers = new Map<string, FanCell[]>()
  const add = (map: Map<string, FanCell[]>, pos: Vec3, cell: FanCell): void => {
    const key = pos.join(',')
    const list = map.get(key)
    if (list) list.push(cell)
    else map.set(key, [cell])
  }
  const fans: { pos: Vec3; facing: Direction }[] = []
  bp.regions.forEach((region) => {
    const [ox, oy, oz] = region.offset
    region.forEachBlock((x, y, z, state) => {
      if (state.id.toString() !== 'create:encased_fan') return
      const facing = state.properties.facing
      /* v8 ignore else -- ゲームは扇風機に必ず facing を残す */
      if (facing && isDirection(facing)) fans.push({ pos: [x + ox, y + oy, z + oz], facing })
    })
  })
  for (const { pos, facing } of fans) {
    const rpm = rpmAt(pos) ?? 0
    const air = fanAirflowDirection(rpm, facing)
    if (!air) continue
    const pushing = air === facing
    // 風の通り道は facing の側。届く距離のマス数（端数は切り上げ。AirCurrent.getLimit）まで、止めるブロックがあればそこまで
    const dir = directionVector(facing)
    const at = (i: number): Vec3 => addVec3(pos, [dir[0] * i, dir[1] * i, dir[2] * i])
    const max = Math.ceil(fanMaxDistance(rpm))
    let limit = 0
    for (let i = 1; i <= max; i++) {
      if (!bp.locate(at(i))) break
      const how = flowThrough(bp.get(at(i)), facing)
      if (how === 'stop') break
      limit = i
      if (how === 'into') break
    }
    if (limit === 0) continue
    // 処理の種類は、見つけたマスから風の進む向きに続く（押すなら遠い方へ、引くなら扇風機の方へ）
    const kinds: (FanProcessingKind | null)[] = new Array(limit + 1).fill(null)
    let kind: FanProcessingKind | null = null
    for (let n = 1; n <= limit; n++) {
      const i = pushing ? n : limit + 1 - n
      kind = fanCatalyst(bp.get(at(i))) ?? kind
      kinds[i] = kind
    }
    const horizontal = directionAxis(facing) !== 'y'
    for (let i = 1; i <= limit; i++) {
      const cell: FanCell = { fan: pos, offset: i, kind: kinds[i] ?? null }
      add(cells, at(i), cell)
      // ベルト・デポは、そのマスと、風が水平ならその1段下。種類はブロック自身の種類か、風の種類
      for (const p of horizontal ? [at(i), addVec3(at(i), [0, -1, 0])] : [at(i)]) {
        const id = bp.get(p)?.id.toString()
        if (id !== 'create:belt' && id !== 'create:depot') continue
        add(handlers, p, { ...cell, kind: fanCatalyst(bp.get(p)) ?? cell.kind })
      }
    }
  }
  return {
    cellsAt: (p) => cells.get(p.join(',')) ?? [],
    handlersAt: (p) => handlers.get(p.join(',')) ?? [],
  }
}
