// スパウトとアイテムドレイン（docs/create-throughput.md「スパウト」「アイテムドレイン」。#235）。
// スパウトの液体を決め（TP-SPOUT-FLUID）、液体を入れた物・抜いた物を決める。

import type { BlockState } from '../../domain/blockState'
import type { Blueprint } from '../../domain/blueprint'
import { DIRECTIONS, directionVector, isDirection, oppositeDirection, type Direction } from '../../domain/direction'
import type { NbtCompound, RawNbt } from '../../domain/nbt'
import { addVec3, type Vec3 } from '../../domain/vec3'
import type { ProcessingRecipe, RecipeBook } from '../../io/modpack/recipes'
import { recipeTypeId, recipesOfKind, type CreateRecipeKind } from './createRecipeTypes'
import { nbtCompound, nbtPos, nbtString } from '../nbtValues'
import { resolved } from '../provenance'
import { recipeAccepts, type RecipeChoice } from './createThroughput'
import { AXES, directionAxis } from './kineticBlocks'

/** スパウトが液体を入れる時間、ドレインが液体を抜く時間（tick。`FILLING_TIME`） */
export const FILLING_TICKS = 20
const EMPTY_FLUIDS = new Set(['minecraft:empty', ''])

/** スパウトの液体 */
export interface SpoutFluid {
  /** 液体の ID（`minecraft:lava`）。分からなければ null */
  readonly fluid: string | null
  /** 'tank' は生データのタンク、'pipe' は管からたどった、'unknown' は分からない */
  readonly from: 'tank' | 'pipe' | 'unknown'
  /** 管からたどって見つけた液体（名前順）。tank なら空 */
  readonly candidates: readonly string[]
}

/** 流れる液体を水源の ID にする（`minecraft:flowing_water` → `minecraft:water`） */
export function stillFluid(id: string): string {
  return id.replace(/:flowing_/, ':')
}

/** 生データのタンクの液体（`Tanks`・`InputTanks`・`OutputTanks` の `TankContent`、または `TankContent`）。空なら null */
export function tankFluid(be: RawNbt | null): string | null {
  if (!be) return null
  const fromContent = (c: NbtCompound | null): string | null => {
    const name = nbtString(c, 'FluidName') ?? nbtString(c, 'id')
    return name !== null && !EMPTY_FLUIDS.has(name) ? stillFluid(name) : null
  }
  const direct = fromContent(nbtCompound(be, 'TankContent'))
  if (direct) return direct
  for (const key of ['Tanks', 'InputTanks', 'OutputTanks']) {
    const list = be.value.get(key)
    if (list?.type !== 'list') continue
    for (const t of list.value) {
      if (t.type !== 'compound') continue
      const f = fromContent(nbtCompound(t, 'TankContent'))
      if (f) return f
    }
  }
  return null
}

/** バルブの回転数（回転の計算の結果）。分からなければ null */
export type ValveSpeed = (pos: Vec3) => number | null

/**
 * 液体のバルブが開いているか（TP-SPOUT-VALVE）。回転数が正なら開く。回転数が分からなければ、保存された `enabled`
 */
function valveOpen(state: BlockState, pos: Vec3, speed: ValveSpeed | undefined): boolean {
  const rpm = speed ? speed(pos) : null
  return rpm === null ? state.properties.enabled === 'true' : rpm > 0
}

/** 管が、その面でつながるか。管でなければ null */
function pipeOpenFaces(state: BlockState, pos: Vec3, speed: ValveSpeed | undefined): Direction[] | null {
  const id = state.id.toString()
  const p = state.properties
  if (id === 'create:fluid_pipe' || id === 'create:encased_fluid_pipe') {
    return DIRECTIONS.filter((d) => p[d] === 'true')
  }
  if (id === 'create:glass_fluid_pipe') {
    const axis = p.axis
    return DIRECTIONS.filter((d) => directionAxis(d) === axis)
  }
  if (id === 'create:mechanical_pump') {
    const facing = p.facing
    if (!facing || !isDirection(facing)) return []
    return [facing, oppositeDirection(facing)]
  }
  if (id === 'create:fluid_valve') {
    // 管の軸は facing の軸を除いた2つのうち、axis_along_first=false なら1つ目、true なら2つ目（FluidValveBlock.getPipeAxis）
    const facing = p.facing
    if (!facing || !isDirection(facing) || !valveOpen(state, pos, speed)) return []
    const pipeAxis = AXES.filter((a) => a !== directionAxis(facing))[p.axis_along_first === 'true' ? 1 : 0]
    return DIRECTIONS.filter((d) => directionAxis(d) === pipeAxis)
  }
  return null
}

/** 管の口の先のブロックにある液体（TP-SPOUT-FLUID の出どころ）。なければ null */
function fluidAt(bp: Blueprint, pos: Vec3): string | null {
  const s = bp.get(pos)
  if (!s) return null
  const id = s.id.toString()
  const p = s.properties
  if (id === 'minecraft:water' || id === 'minecraft:lava') {
    /* v8 ignore next -- ゲームは水・溶岩に必ず level を残す */
    const level = p.level ?? '0'
    if (level === '0') return id
  }
  if (p.waterlogged === 'true') return 'minecraft:water'
  if (id === 'minecraft:water_cauldron') return 'minecraft:water'
  if (id === 'minecraft:lava_cauldron') return 'minecraft:lava'
  if (id === 'minecraft:cauldron') return dripstoneFluid(bp, pos)
  if (s.id.namespace === 'create') {
    const be = bp.blockEntityAt(pos)
    const own = tankFluid(be)
    if (own) return own
    // 液体タンクは、まとめ役（Controller）のブロックが中身を持つ
    const controller = nbtPos(be, 'Controller')
    if (controller) return tankFluid(bp.blockEntityAt(controller))
  }
  return null
}

/** 空の大釜の上の、下向きの鍾乳石の根もとの1つ上のブロックの、さらに上の液体の水源 */
function dripstoneFluid(bp: Blueprint, cauldron: Vec3): string | null {
  let y = cauldron[1] + 1
  let found = false
  for (let i = 0; i < 16; i++) {
    const s = bp.get([cauldron[0], y, cauldron[2]])
    if (s?.id.toString() !== 'minecraft:pointed_dripstone' || s.properties.vertical_direction !== 'down') break
    found = true
    y++
  }
  if (!found) return null
  // y は根もとの1つ上（支えるブロック）。その上が液体の水源
  const source = bp.get([cauldron[0], y + 1, cauldron[2]])
  const id = source?.id.toString()
  if (id === 'minecraft:water' || id === 'minecraft:lava') {
    /* v8 ignore next -- ゲームは水・溶岩に必ず level を残す */
    const level = source?.properties.level ?? '0'
    if (level === '0') return id
  }
  return null
}

/**
 * スパウトの液体を決める（TP-SPOUT-FLUID）。生データのタンクの液体、なければ上と横につながった管をたどった先の液体。
 * speed はバルブの回転数（閉じたバルブはたどらない。TP-SPOUT-VALVE）
 */
export function spoutFluid(bp: Blueprint, pos: Vec3, speed?: ValveSpeed): SpoutFluid {
  const own = tankFluid(bp.blockEntityAt(pos))
  if (own) return { fluid: own, from: 'tank', candidates: [] }
  const found = new Set<string>()
  // 同じ管は2回たどらないので、設計図の大きさで終わる
  const seen = new Set<string>([key(pos)])
  const queue: { readonly pos: Vec3; readonly faces: Direction[] }[] = []
  const visit = (from: Vec3, dir: Direction): void => {
    const next = addVec3(from, directionVector(dir))
    const k = key(next)
    if (seen.has(k)) return
    const s = bp.get(next)
    const faces = s ? pipeOpenFaces(s, next, speed) : null
    if (faces) {
      if (!faces.includes(oppositeDirection(dir))) return
      seen.add(k)
      queue.push({ pos: next, faces })
      return
    }
    const f = fluidAt(bp, next)
    if (f) found.add(f)
  }
  for (const d of DIRECTIONS) if (d !== 'down') visit(pos, d)
  for (let node = queue.shift(); node; node = queue.shift()) {
    for (const d of node.faces) visit(node.pos, d)
  }
  const candidates = [...found].sort()
  return candidates.length > 0
    ? { fluid: candidates[0]!, from: 'pipe', candidates }
    : { fluid: null, from: 'unknown', candidates: [] }
}

function key(p: Vec3): string {
  return `${p[0]},${p[1]},${p[2]}`
}

/** 液体がレシピの液体の材料に合うか（TP-SPOUT の液体のタグ） */
export function fluidAccepts(recipe: ProcessingRecipe, fluid: string): boolean {
  const f = stillFluid(fluid)
  if ((recipe.fluids ?? []).some((x) => stillFluid(x) === f)) return true
  const path = f.slice(f.indexOf(':') + 1)
  return (recipe.fluidTags ?? []).some((tag) => {
    if (tag === 'minecraft:water' || tag === 'minecraft:lava') return tag === f
    const name = tag.slice(tag.indexOf(':') + 1)
    return name.slice(name.lastIndexOf('/') + 1) === path
  })
}

/** 液体を入れる・抜く処理1回分 */
export interface FluidProcess {
  readonly type: CreateRecipeKind
  readonly choice: RecipeChoice
  /** できる物（レシピのもの、または Create の決まりで作ったもの） */
  readonly recipe: ProcessingRecipe
  /** 仮定に載せる文（なければ null） */
  readonly assumption: string | null
}

/** レシピの ID の名前順（まとめたレシピの ID は重ならない） */
function byId(a: ProcessingRecipe, b: ProcessingRecipe): number {
  return a.id < b.id ? -1 : 1
}

function fromRecipes(
  type: 'filling' | 'emptying',
  matches: ProcessingRecipe[],
  item: string,
  machine: string,
): FluidProcess | null {
  const match = matches.sort(byId)[0]
  if (!match) return null
  return {
    type,
    recipe: match,
    choice: {
      duration: resolved(FILLING_TICKS, 'modpack', match.id),
      text: `${match.id}（${item}、${FILLING_TICKS} tick）`,
      assumption: null,
      recipe: match,
      item,
    },
    assumption:
      matches.length > 1 ? `${machine}の材料 ${item} に合うレシピが ${matches.length} つあるので、ID の名前順で最初の ${match.id} を使った` : null,
  }
}

/** Create の決まり（GenericItemFilling・GenericItemEmptying）で作る処理 */
function generic(type: 'filling' | 'emptying', item: string, result: string, rule: string, assumption: string | null): FluidProcess {
  const recipe: ProcessingRecipe = {
    id: `Create の決まり（${rule}）`,
    type: recipeTypeId(type),
    items: [item],
    tags: [],
    duration: FILLING_TICKS,
    results: [{ item: result, count: 1, chance: 1 }],
  }
  return {
    type,
    recipe,
    choice: {
      duration: resolved(FILLING_TICKS, 'builtin', rule),
      text: `${recipe.id}（${item}、${FILLING_TICKS} tick）`,
      assumption: null,
      recipe,
      item,
    },
    assumption,
  }
}

/** スパウトで液体を入れた物（TP-SPOUT）。入れられなければ null */
export function fillItem(item: string, fluid: string, book: RecipeBook | null): FluidProcess | null {
  const f = stillFluid(fluid)
  const recipes = recipesOfKind(book, 'filling').filter((r) => recipeAccepts(r, item, book) && fluidAccepts(r, f))
  const fromRecipe = fromRecipes('filling', recipes, item, 'スパウト')
  if (fromRecipe) return fromRecipe
  if (item === 'minecraft:bucket') {
    if (f === 'minecraft:water' || f === 'minecraft:lava') return generic('filling', item, `${f}_bucket`, 'バケツに液体を入れる', null)
    return generic('filling', item, `${f}_bucket`, 'バケツに液体を入れる', `${f} のバケツを ${f}_bucket とした`)
  }
  if (item === 'minecraft:glass_bottle' && f === 'minecraft:water') {
    return generic('filling', item, 'minecraft:potion', '瓶に水を入れる', null)
  }
  return null
}

const POTIONS = new Set(['minecraft:potion', 'minecraft:splash_potion', 'minecraft:lingering_potion'])

/** アイテムドレインで液体を抜いた物（TP-ITEM-DRAIN）。抜けなければ null */
export function emptyItem(item: string, book: RecipeBook | null): FluidProcess | null {
  if (POTIONS.has(item)) return generic('emptying', item, 'minecraft:glass_bottle', 'ポーションを抜く', null)
  const recipes = recipesOfKind(book, 'emptying').filter((r) => recipeAccepts(r, item, book))
  const fromRecipe = fromRecipes('emptying', recipes, item, 'アイテムドレイン')
  if (fromRecipe) return fromRecipe
  if (item.endsWith('_bucket') && item !== 'minecraft:bucket' && item !== 'minecraft:powder_snow_bucket') {
    return generic('emptying', item, 'minecraft:bucket', 'バケツの液体を抜く', null)
  }
  return null
}
