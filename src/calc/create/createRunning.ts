// 「動かしたとき」の動力源（#243。docs/create-stress.md「動かしたとき」）。
// 保存された状態では止まっているボイラーの蒸気エンジンと風車を、設計図の中身から動かしたものとして計算する。
// 推測で埋めた値はすべて仮定に載せる。

import type { BlockState } from '../../domain/blockState'
import type { Blueprint } from '../../domain/blueprint'
import { DIRECTIONS, directionVector, isDirection, type Direction } from '../../domain/direction'
import type { NbtTag, RawNbt } from '../../domain/nbt'
import { addVec3, type Vec3 } from '../../domain/vec3'
import type { AssumptionLog } from '../assumptionLog'
import type { CalcIssue } from '../calcPlugin'
import { nbtBoolean, nbtNumber, nbtPos } from '../nbtValues'
import { MAX_BOILER_LEVEL, PASSIVE_ENGINE_EFFICIENCY } from './createDefaults'
import { directionAxis, isPositive } from './kineticBlocks'

/** 動かしたときの蒸気エンジン1台が軸に与えるもの */
export interface RunningEngine {
  /** 0〜1 */
  readonly efficiency: number
  /** +1 か −1 */
  readonly direction: number
  readonly enginePos: Vec3
}

function key(p: Vec3): string {
  return `${p[0]},${p[1]},${p[2]}`
}

function isTank(state: BlockState | null): boolean {
  return state?.id.toString() === 'create:fluid_tank'
}

/** 熱：'passive' は弱い熱。数は強い熱の量。なしは 0 */
type Heat = number | 'passive'

/** ボイラーの真下のブロックの熱（ST-RUN-BOILER-HEAT）。燃料のないブレイズバーナーは、燃料を入れたとみなしたかを返す */
function heatOf(state: BlockState | null): { heat: Heat; fuelAssumed: boolean } {
  if (!state) return { heat: 0, fuelAssumed: false }
  const id = state.id.toString()
  if (id === 'create:blaze_burner') {
    switch (state.properties.blaze) {
      case 'seething':
        return { heat: 2, fuelAssumed: false }
      case 'kindled':
      case 'fading':
        return { heat: 1, fuelAssumed: false }
      case 'smouldering':
        return { heat: 1, fuelAssumed: true }
      default:
        return { heat: 0, fuelAssumed: false }
    }
  }
  if (id === 'minecraft:magma_block' || id === 'minecraft:lava' || id === 'minecraft:fire' || id === 'minecraft:soul_fire') {
    return { heat: 'passive', fuelAssumed: false }
  }
  if (id === 'minecraft:campfire' || id === 'minecraft:soul_campfire') {
    return { heat: state.properties.lit === 'false' ? 0 : 'passive', fuelAssumed: false }
  }
  return { heat: 0, fuelAssumed: false }
}

/** 蒸気エンジンの付いている向き（SteamEngineBlock.getFacing）。床なら上、天井なら下、壁なら facing */
export function engineAttachedDirection(state: BlockState): Direction | null {
  const face = state.properties.face
  if (face === 'floor') return 'up'
  if (face === 'ceiling') return 'down'
  const facing = state.properties.facing
  return facing && isDirection(facing) ? facing : null
}

/** タンクの組1つ分。min は一番小さい角 */
interface TankGroup {
  readonly min: Vec3
  readonly width: number
  readonly height: number
  /** 組の中にあるタンクの位置 */
  readonly members: readonly Vec3[]
}

/** 設計図のタンクを組に分ける（ST-RUN-BOILER-TANK） */
function tankGroups(bp: Blueprint, log: AssumptionLog): TankGroup[] {
  const tanks: Vec3[] = []
  for (const region of bp.regions) {
    region.forEachBlock((x, y, z, state) => {
      if (isTank(state)) tanks.push(addVec3([x, y, z], region.offset))
    })
  }
  const assigned = new Set<string>()
  const groups: TankGroup[] = []
  // 主（Size と Height を持つタンク）から組を作る
  for (const pos of tanks) {
    const be = bp.blockEntityAt(pos)
    const width = nbtNumber(be, 'Size')
    const height = nbtNumber(be, 'Height')
    if (width === null || height === null || width < 1 || height < 1 || assigned.has(key(pos))) continue
    const members: Vec3[] = []
    let outside = false
    for (let dy = 0; dy < height; dy++) {
      for (let dx = 0; dx < width; dx++) {
        for (let dz = 0; dz < width; dz++) {
          const p: Vec3 = [pos[0] + dx, pos[1] + dy, pos[2] + dz]
          if (bp.locate(p) === null) outside = true
          if (!isTank(bp.get(p)) || assigned.has(key(p))) continue
          assigned.add(key(p))
          members.push(p)
        }
      }
    }
    if (outside) log.add('タンクの組の一部が設計図の外にあるので、中にある分だけをボイラーの大きさに数えた', pos)
    groups.push({ min: pos, width, height, members })
  }
  // 主の生データがないタンクは、bottom から top まで縦に続く1列を幅 1 の組とみなす
  for (const pos of tanks) {
    if (assigned.has(key(pos)) || bp.get(pos)?.properties.bottom !== 'true') continue
    const members: Vec3[] = []
    for (let p = pos; isTank(bp.get(p)) && !assigned.has(key(p)); p = addVec3(p, [0, 1, 0])) {
      assigned.add(key(p))
      members.push(p)
      if (bp.get(p)?.properties.top === 'true') break
    }
    log.add('タンクの組の生データ（Size・Height）がないので、縦の1列を幅 1 のボイラーとみなした', pos)
    groups.push({ min: pos, width: 1, height: members.length, members })
  }
  return groups
}

/** 位置の小さい順（x・y・z） */
function comparePos(a: Vec3, b: Vec3): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
}

/**
 * 動かしたときの蒸気エンジン（ST-RUN-BOILER-*・ST-RUN-STEAM-*）。
 * 軸の位置（'x,y,z'）ごとに、その軸を回すエンジン1台の効率と向きを返す
 */
export function runningSteamEngines(bp: Blueprint, log: AssumptionLog): Map<string, RunningEngine> {
  const byShaft = new Map<string, { shaft: Vec3; engines: RunningEngine[] }>()
  for (const group of tankGroups(bp, log)) {
    // 熱
    let active = 0
    let passive = false
    let fuelAssumed = false
    for (let dx = 0; dx < group.width; dx++) {
      for (let dz = 0; dz < group.width; dz++) {
        const h = heatOf(bp.get([group.min[0] + dx, group.min[1] - 1, group.min[2] + dz]))
        if (h.heat === 'passive') passive = true
        else active += h.heat
        if (h.fuelAssumed) fuelAssumed = true
      }
    }
    passive = passive && active === 0
    if (fuelAssumed) log.add('燃料のないブレイズバーナーは、燃料を入れたとみなした', group.min)

    // 付いたエンジン
    const engines: { pos: Vec3; state: BlockState; dir: Direction }[] = []
    const seen = new Set<string>()
    for (const tank of group.members) {
      for (const d of DIRECTIONS) {
        const p = addVec3(tank, directionVector(d))
        const state = bp.get(p)
        if (state?.id.toString() !== 'create:steam_engine' || engineAttachedDirection(state) !== d || seen.has(key(p))) continue
        seen.add(key(p))
        engines.push({ pos: p, state, dir: d })
      }
    }
    if (engines.length === 0) continue
    log.add('ボイラーの水は足りているとみなした', group.min)

    // 段階と効率
    const size = group.members.length
    const forSize = Math.min(MAX_BOILER_LEVEL, Math.floor(size / 4))
    const forWater = MAX_BOILER_LEVEL
    const level = Math.min(active, forWater, forSize)
    const n = engines.length
    let efficiency: number
    if (passive && forSize > 0 && forWater > 0) efficiency = PASSIVE_ENGINE_EFFICIENCY / n
    else if (active === 0) efficiency = 0
    else efficiency = n <= level ? 1 : level / n
    efficiency = Math.max(0, Math.min(1, efficiency))

    // エンジンが回す軸と向き
    for (const engine of engines) {
      const shaftPos = addVec3(engine.pos, [
        directionVector(engine.dir)[0] * 2,
        directionVector(engine.dir)[1] * 2,
        directionVector(engine.dir)[2] * 2,
      ])
      const shaft = bp.get(shaftPos)
      const shaftId = shaft?.id.toString()
      if (!shaft || (shaftId !== 'create:powered_shaft' && shaftId !== 'create:shaft')) continue
      const axis = shaft.properties.axis
      let facing: Direction = engine.dir
      if (directionAxis(facing) === 'y') {
        const f = engine.state.properties.facing
        if (f && isDirection(f)) facing = f
      }
      const a = efficiency === 0 || axis === 'y' ? 1 : isPositive(facing) ? 1 : -1
      const b = axis === 'z' ? -1 : 1
      const c = nbtNumber(bp.blockEntityAt(engine.pos), 'ScrollValue') === 1 ? -1 : 1
      const entry = byShaft.get(key(shaftPos)) ?? { shaft: shaftPos, engines: [] }
      entry.engines.push({ efficiency, direction: a * b * c, enginePos: engine.pos })
      byShaft.set(key(shaftPos), entry)
    }
  }

  // 1本の軸に1台（ST-RUN-STEAM-ONE-PER-SHAFT）
  const result = new Map<string, RunningEngine>()
  for (const [k, { shaft, engines }] of byShaft) {
    if (engines.length === 1) {
      result.set(k, engines[0]!)
      continue
    }
    const rel = nbtPos(bp.blockEntityAt(shaft), 'EnginePos')
    const saved = rel ? engines.find((e) => key([shaft[0] - rel[0], shaft[1] - rel[1], shaft[2] - rel[2]]) === key(e.enginePos)) : undefined
    const chosen = saved ?? [...engines].sort((p, q) => comparePos(p.enginePos, q.enginePos))[0]!
    log.add('1本の軸に蒸気エンジンが2台以上向いているので、1台だけを使った', shaft)
    result.set(k, chosen)
  }
  return result
}

/** 帆（windmill_sails のタグ）か */
function isSail(state: BlockState): boolean {
  const ns = state.id.namespace
  const path = state.id.path
  if (ns === 'create') return path === 'sail_frame' || path.endsWith('_sail')
  return ns === 'minecraft' && path.endsWith('_wool')
}

/** 帆のブロック（SailBlock。羊毛は含まない） */
function isSailBlock(state: BlockState): boolean {
  return state.id.namespace === 'create' && (state.id.path === 'sail_frame' || state.id.path.endsWith('_sail'))
}

function isSticky(state: BlockState): 'slime' | 'honey' | null {
  const id = state.id.toString()
  if (id === 'minecraft:slime_block') return 'slime'
  if (id === 'minecraft:honey_block') return 'honey'
  return null
}

function isAir(state: BlockState | null): boolean {
  if (!state) return true
  const id = state.id.toString()
  return id === 'minecraft:air' || id === 'minecraft:cave_air' || id === 'minecraft:void_air'
}

/** 接着剤の箱（設計図の座標。min は含み、max は含まない） */
export interface GlueBox {
  readonly min: Vec3
  readonly max: Vec3
}

function doubles(tag: NbtTag | undefined): number[] | null {
  if (tag?.type !== 'list') return null
  const out: number[] = []
  for (const v of tag.value) {
    if (v.type !== 'double' && v.type !== 'float') return null
    out.push(v.value)
  }
  return out.length === 3 ? out : null
}

/** 設計図の接着剤（create:super_glue のエンティティ）の箱 */
export function glueBoxes(bp: Blueprint): GlueBox[] {
  const boxes: GlueBox[] = []
  for (const region of bp.regions) {
    for (const entity of region.entities) {
      const data = entity.value.get('nbt')
      if (data?.type !== 'compound') continue
      const id = data.value.get('id')
      if (id?.type !== 'string' || id.value !== 'create:super_glue') continue
      const at = doubles(entity.value.get('pos'))
      const from = doubles(data.value.get('From'))
      const to = doubles(data.value.get('To'))
      if (!at || !from || !to) continue
      const o = region.offset
      boxes.push({
        min: [o[0] + at[0] + Math.min(from[0], to[0]), o[1] + at[1] + Math.min(from[1], to[1]), o[2] + at[2] + Math.min(from[2], to[2])],
        max: [o[0] + at[0] + Math.max(from[0], to[0]), o[1] + at[1] + Math.max(from[1], to[1]), o[2] + at[2] + Math.max(from[2], to[2])],
      })
    }
  }
  return boxes
}

function boxContains(box: GlueBox, p: Vec3): boolean {
  return [0, 1, 2].every((i) => box.min[i]! <= p[i]! + 0.5 && p[i]! + 0.5 < box.max[i]!)
}

/** 隣のブロックが一緒に動くか（Contraption.moveBlock の一部） */
function moves(from: BlockState, fromPos: Vec3, to: BlockState, toPos: Vec3, d: Direction, glue: readonly GlueBox[]): boolean {
  // 帆は、自分の facing の軸と違う向きの隣とつながる（BlockMovementChecks.isBlockAttachedTowards）
  const facing = to.properties.facing
  if (isSailBlock(to) && facing && isDirection(facing) && directionAxis(facing) !== directionAxis(d)) return true
  const a = isSticky(from)
  const b = isSticky(to)
  if ((a || b) && !(a && b && a !== b)) return true
  return glue.some((box) => boxContains(box, fromPos) && boxContains(box, toPos))
}

/** 風車の帆の数（ST-RUN-WINDMILL-SAILS）。軸受の facing の先から、一緒に動くブロックをたどる */
export function countSails(bp: Blueprint, bearing: Vec3, facing: Direction, glue: readonly GlueBox[]): number {
  const start = addVec3(bearing, directionVector(facing))
  if (isAir(bp.get(start))) return 0
  const visited = new Set<string>([key(bearing), key(start)])
  const queue: Vec3[] = [start]
  let sails = 0
  for (let i = 0; i < queue.length; i++) {
    const pos = queue[i]!
    const state = bp.get(pos)!
    if (isSail(state)) sails++
    for (const d of DIRECTIONS) {
      const next = addVec3(pos, directionVector(d))
      if (visited.has(key(next))) continue
      const nextState = bp.get(next)
      if (isAir(nextState) || !moves(state, pos, nextState!, next, d, glue)) continue
      visited.add(key(next))
      queue.push(next)
    }
  }
  return sails
}

/** 風車の設定（create-server.toml の [kinetics]） */
export interface WindmillSettings {
  readonly minimumSails: number
  readonly sailsPerRPM: number
}

/**
 * 動かしたときの風車の回転数（ST-RUN-WINDMILL-*）。
 * 生データで回っているなら null（保存された状態の値を使う）
 */
export function runningWindmillSpeed(
  bp: Blueprint,
  pos: Vec3,
  state: BlockState,
  be: RawNbt | null,
  settings: WindmillSettings,
  glue: readonly GlueBox[],
  log: AssumptionLog,
  issues: CalcIssue[],
): number | null {
  if (nbtBoolean(be, 'Running') === true && nbtNumber(be, 'LastGenerated') !== null) return null
  const facing = state.properties.facing
  if (!facing || !isDirection(facing)) return 0
  const sails = countSails(bp, pos, facing, glue)
  log.add(`風車は組み立てて回しているとみなした（帆 ${sails} 枚）`, pos)
  if (sails < settings.minimumSails) {
    issues.push({
      pos: [pos[0], pos[1], pos[2]],
      message: `帆が足りません（${sails} 枚。${settings.minimumSails} 枚以上が必要）。風車を組み立てられません。`,
    })
    return 0
  }
  const sign = nbtNumber(be, 'ScrollValue') === 1 ? -1 : 1
  return Math.max(1, Math.min(16, Math.floor(sails / settings.sailsPerRPM))) * sign
}
