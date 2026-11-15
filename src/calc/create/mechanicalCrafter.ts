// メカニカルクラフター（docs/create-throughput.md「メカニカルクラフター」。#235）。
// クラフターの組（矢印でつながったもの）、入力をつないだクラフター、材料の並びとレシピの照合、1回にかかる時間。

import type { BlockState } from '../../domain/blockState'
import type { Blueprint } from '../../domain/blueprint'
import { directionVector, isDirection, oppositeDirection, type Direction } from '../../domain/direction'
import type { NbtTag } from '../../domain/nbt'
import { addVec3, type Vec3 } from '../../domain/vec3'
import type { CraftingIngredient, ProcessingRecipe, RecipeBook } from '../../io/modpack/recipes'
import { nbtBoolean, nbtNumber } from '../nbtValues'
import { clockwise } from './kineticBlocks'

export const CRAFTER_ID = 'create:mechanical_crafter'

/** クラフターの組 */
export interface CrafterGroup {
  /** 矢印の先がクラフターでない1台 */
  readonly final: Vec3
  readonly facing: Direction
  /** 組のすべてのクラフター */
  readonly members: readonly Vec3[]
  /** 最後の1台までの一番長い道のクラフターの数（最後の1台を含む） */
  readonly longest: number
}

function crafterFacing(state: BlockState | null): Direction | null {
  if (state?.id.toString() !== CRAFTER_ID) return null
  const f = state.properties.facing
  return f && isDirection(f) && f !== 'up' && f !== 'down' ? f : null
}

/** 反時計回りに 90° 回した向き */
function counterClockwise(d: Direction): Direction {
  return clockwise(clockwise(clockwise(d)))
}

/** 矢印の向き（TP-CRAFTER-GRID。`MechanicalCrafterBlock.getTargetDirection`） */
export function crafterTargetDirection(state: BlockState): Direction | null {
  const facing = crafterFacing(state)
  if (!facing) return null
  switch (state.properties.pointing ?? 'up') {
    case 'up':
      return 'up'
    case 'down':
      return 'down'
    case 'left':
      return clockwise(facing)
    case 'right':
      return counterClockwise(facing)
    default:
      return null
  }
}

const OPPOSITE_POINTING: Readonly<Record<string, string>> = { up: 'down', down: 'up', left: 'right', right: 'left' }

/** pos のクラフターが渡す先のクラフター。なければ null */
export function crafterTarget(bp: Blueprint, pos: Vec3): Vec3 | null {
  const state = bp.get(pos)
  const dir = state ? crafterTargetDirection(state) : null
  if (!state || !dir) return null
  const to = addVec3(pos, directionVector(dir))
  const target = bp.get(to)
  if (crafterFacing(target) !== crafterFacing(state)) return null
  if (OPPOSITE_POINTING[state.properties.pointing ?? 'up'] === (target?.properties.pointing ?? 'up')) return null
  return to
}

function key(p: Vec3): string {
  return `${p[0]},${p[1]},${p[2]}`
}

/** pos のクラフターを含む組。クラフターでなければ null */
export function crafterGroup(bp: Blueprint, pos: Vec3): CrafterGroup | null {
  const facing = crafterFacing(bp.get(pos))
  if (!facing) return null
  // 組は、渡す・渡されるでつながったクラフター。横の4方向（facing の軸を除く）の隣を調べる
  const sides: Direction[] = ['up', 'down', clockwise(facing), counterClockwise(facing)]
  const seen = new Map<string, Vec3>([[key(pos), pos]])
  const queue: Vec3[] = [pos]
  for (let p = queue.shift(); p; p = queue.shift()) {
    const target = crafterTarget(bp, p)
    const near = sides.map((d) => addVec3(p, directionVector(d)))
    for (const q of target ? [target, ...near] : near) {
      if (seen.has(key(q))) continue
      const t = crafterTarget(bp, q)
      const linked = (target && key(q) === key(target)) || (t !== null && key(t) === key(p))
      if (!linked) continue
      seen.set(key(q), q)
      queue.push(q)
    }
  }
  const members = [...seen.values()]
  // 矢印の先がない1台が最後。輪になっていれば最初の1台とする
  const final = members.find((m) => crafterTarget(bp, m) === null) ?? pos
  const depth = new Map<string, number>()
  const steps = (m: Vec3, guard: number): number => {
    const k = key(m)
    const known = depth.get(k)
    if (known !== undefined) return known
    const t = crafterTarget(bp, m)
    const d = t === null || guard > members.length ? 1 : steps(t, guard + 1) + 1
    depth.set(k, d)
    return d
  }
  const longest = Math.max(...members.map((m) => steps(m, 0)))
  return { final, facing, members, longest }
}

/** スロットカバーが付いている（生データの `Cover`） */
export function crafterCovered(bp: Blueprint, pos: Vec3): boolean {
  return nbtBoolean(bp.blockEntityAt(pos), 'Cover') === true
}

/** 入力のまとめ役（TP-CRAFTER-GRID の入力をつないだクラフター）。つないでいなければ自分 */
export function crafterInputController(bp: Blueprint, pos: Vec3): Vec3 {
  const input = bp.blockEntityAt(pos)?.value.get('ConnectedInput')
  if (input?.type !== 'compound' || nbtBoolean(input, 'Controller') !== false) return pos
  const first = connectedOffsets(input.value.get('Data'))[0]
  return first ? addVec3(pos, first) : pos
}

function connectedOffsets(tag: NbtTag | undefined): Vec3[] {
  if (tag?.type !== 'list') return []
  return tag.value.flatMap((t): Vec3[] => (t.type === 'compound' ? [[nbtNumber(t, 'X') ?? 0, nbtNumber(t, 'Y') ?? 0, nbtNumber(t, 'Z') ?? 0]] : []))
}

/** 速さ s（TP-CRAFTER）。止まっていれば 0 */
export function crafterSpeed(rpm: number): number {
  return rpm === 0 ? 0 : Math.min(Math.max(Math.trunc(Math.abs(rpm)), 4), 250)
}

/** 数値 n の段階の tick 数 */
function phaseTicks(n: number, s: number): number {
  return Math.floor(n / s) + 1
}

/** 1回にかかる時間（tick）。最後の1台までの一番長い道の段階の合計（Create 6.0） */
export function crafterCycleTicks(longest: number, s: number): number {
  const pass = 1 + phaseTicks(1000, s)
  const craft = 1 + phaseTicks(2000, s)
  return (longest - 1) * pass + craft
}

/** 並びの位置（最後の1台から見た [右, 上]） */
export function gridCoord(pos: Vec3, final: Vec3, facing: Direction): [number, number] {
  const right = directionVector(counterClockwise(facing))
  const d: Vec3 = [pos[0] - final[0], pos[1] - final[1], pos[2] - final[2]]
  return [d[0] * right[0] + d[2] * right[2], d[1]]
}

/** 1つのクラフターに入る物（どれか1つ） */
export interface CrafterSlot {
  readonly pos: Vec3
  readonly coord: readonly [number, number]
  /** 入るかもしれない物。1つなら決まっている */
  readonly items: readonly string[]
}

/** レシピの照合の結果 */
export interface CraftMatch {
  readonly recipe: ProcessingRecipe
  /** 合うレシピの数（2つ以上なら仮定に載せる） */
  readonly count: number
  /** クラフターごとに使う物（slots と同じ順） */
  readonly items: readonly string[]
  /** 並びを使わず、材料の数と種類だけで決めた */
  readonly unordered: boolean
}

function accepts(ing: CraftingIngredient, item: string, book: RecipeBook): boolean {
  return ing.items.includes(item) || ing.tags.some((t) => book.itemTags[t]?.includes(item) ?? false)
}

/** パターンの空いた行・列を除く（Minecraft の ShapedRecipePattern と同じ） */
function trimRows(rows: readonly (readonly (CraftingIngredient | null)[])[]): (CraftingIngredient | null)[][] {
  const width = Math.max(0, ...rows.map((r) => r.length))
  const full = rows.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? null))
  const used = (cells: (CraftingIngredient | null)[]) => cells.some((c) => c !== null)
  const ys = full.map((_, y) => y).filter((y) => used(full[y]!))
  const xs = Array.from({ length: width }, (_, x) => x).filter((x) => used(full.map((r) => r[x]!)))
  if (ys.length === 0 || xs.length === 0) return []
  const [y0, y1, x0, x1] = [ys[0]!, ys[ys.length - 1]!, xs[0]!, xs[xs.length - 1]!]
  return full.slice(y0, y1 + 1).map((r) => r.slice(x0, x1 + 1))
}

/** 決まった並びが、形のあるレシピに合うか */
function matchesShaped(recipe: ProcessingRecipe, grid: Map<string, string>, book: RecipeBook): boolean {
  const rows = trimRows(recipe.grid?.rows ?? [])
  const coords = [...grid.keys()].map((k) => k.split(',').map(Number) as [number, number])
  if (rows.length === 0 || coords.length === 0) return false
  const minX = Math.min(...coords.map((c) => c[0]))
  const maxX = Math.max(...coords.map((c) => c[0]))
  const maxY = Math.max(...coords.map((c) => c[1]))
  const minY = Math.min(...coords.map((c) => c[1]))
  const w = maxX - minX + 1
  const h = maxY - minY + 1
  if (rows.length !== h || rows[0]!.length !== w) return false
  const test = (mirror: boolean) =>
    rows.every((row, r) =>
      row.every((ing, c) => {
        const x = mirror ? maxX - c : minX + c
        const item = grid.get(`${x},${maxY - r}`)
        return ing === null ? item === undefined : item !== undefined && accepts(ing, item, book)
      }),
    )
  return test(false) || (recipe.grid?.mirrored === true && test(true))
}

/**
 * 材料のマスと物を組み合わせる（二部グラフの最大マッチング）。どれも組めれば、マスごとの物を返す
 */
function assign(ingredients: readonly CraftingIngredient[], slots: readonly CrafterSlot[], book: RecipeBook): string[] | null {
  if (ingredients.length !== slots.length) return null
  const ofIngredient: number[] = Array.from({ length: ingredients.length }, () => -1)
  const tryAssign = (s: number, seen: boolean[]): boolean => {
    for (let i = 0; i < ingredients.length; i++) {
      if (seen[i] || !slots[s]!.items.some((item) => accepts(ingredients[i]!, item, book))) continue
      seen[i] = true
      if (ofIngredient[i] === -1 || tryAssign(ofIngredient[i]!, seen)) {
        ofIngredient[i] = s
        return true
      }
    }
    return false
  }
  for (let s = 0; s < slots.length; s++) if (!tryAssign(s, [])) return null
  const items: string[] = Array.from({ length: slots.length }, () => '')
  ofIngredient.forEach((s, i) => {
    items[s] = slots[s]!.items.find((item) => accepts(ingredients[i]!, item, book))!
  })
  return items
}

function byId(a: ProcessingRecipe, b: ProcessingRecipe): number {
  return a.id < b.id ? -1 : 1
}

/**
 * クラフターの組に入る物で、できる物を決める（TP-CRAFTER-RECIPE）。作業台のレシピ、なければメカニカルクラフターのレシピ。
 * どのクラフターの物も1つに決まっていれば並びで照らし、決まらなければ材料の数と種類だけで照らす
 */
export function matchCrafting(slots: readonly CrafterSlot[], book: RecipeBook): CraftMatch | null {
  const ordered = slots.every((s) => s.items.length === 1)
  const grid = new Map<string, string>()
  if (ordered) for (const s of slots) grid.set(`${s.coord[0]},${s.coord[1]}`, s.items[0]!)
  const tiers = [
    book.recipes.filter((r) => r.grid && (r.type === 'crafting_shaped' || r.type === 'crafting_shapeless')),
    book.recipes.filter((r) => r.grid && r.type === 'mechanical_crafting'),
  ]
  for (const tier of tiers) {
    const found: { recipe: ProcessingRecipe; items: string[] }[] = []
    for (const recipe of [...tier].sort(byId)) {
      const cells = recipe.grid!.rows ? recipe.grid!.rows.flat().filter((c): c is CraftingIngredient => c !== null) : recipe.grid!.ingredients
      if (ordered && recipe.grid!.rows) {
        if (matchesShaped(recipe, grid, book)) found.push({ recipe, items: slots.map((s) => s.items[0]!) })
        continue
      }
      const items = assign(cells, slots, book)
      if (items) found.push({ recipe, items })
    }
    const first = found[0]
    if (first) return { recipe: first.recipe, count: found.length, items: first.items, unordered: !ordered }
  }
  return null
}

/** 容器の残る材料（作るときに残る物。`getCraftingRemainingItem`） */
export function craftingRemainder(item: string): string | null {
  if (item === 'minecraft:water_bucket' || item === 'minecraft:lava_bucket' || item === 'minecraft:milk_bucket') return 'minecraft:bucket'
  if (item === 'minecraft:honey_bottle' || item === 'minecraft:dragon_breath') return 'minecraft:glass_bottle'
  return null
}

/** 最後の1台のできた物の行き先：矢印の先のブロック（受け取る面つき）か、前に放り出す位置 */
export function crafterOutput(bp: Blueprint, final: Vec3): { readonly to: Vec3; readonly face: Direction | null; readonly ejected: boolean } {
  const state = bp.get(final)!
  const dir = crafterTargetDirection(state)!
  const target = addVec3(final, directionVector(dir))
  if (bp.get(target)) return { to: target, face: oppositeDirection(dir), ejected: false }
  return { to: addVec3(final, directionVector(crafterFacing(state)!)), face: null, ejected: true }
}
