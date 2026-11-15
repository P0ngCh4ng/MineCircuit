// Create の処理のレシピ（docs/create-throughput.md「レシピ」）。
// jar の data/<namespace>/recipes/（1.21 は recipe/）と、Modpack の kubejs/data/ のレシピ JSON から、
// 処理時間の計算に使う種類だけを読み、材料・処理時間・できる物だけを残す。KubeJS のスクリプトのレシピは、
// スクリプトを作り物の KubeJS で動かして集める（kubejsScripts/。#145）。

import type { ScriptRunSummary } from './kubejsScripts/scriptTypes'

/** Create の処理のレシピの種類（`create:` を外した名前） */
export type CreateRecipeType =
  | 'milling'
  | 'crushing'
  | 'cutting'
  | 'mixing'
  | 'pressing'
  | 'compacting'
  | 'splashing'
  | 'haunting'
  | 'filling'
  | 'emptying'
  | 'mechanical_crafting'
/** Minecraft の料理のレシピの種類（`minecraft:` を外した名前）。扇風機で燻す・焼くのに使う（#235） */
export type CookingRecipeType = 'smelting' | 'blasting' | 'smoking'
/** Minecraft の作業台のレシピの種類。メカニカルクラフターに使う（#235） */
export type CraftingRecipeType = 'crafting_shaped' | 'crafting_shapeless'
/**
 * 読むレシピの種類。
 * pressing はベルト・デポの上のプレス、compacting はバスンの上のプレス（圧縮）。この2つはふつう処理時間を書かない。
 * splashing・haunting と料理の3つは扇風機の処理（docs/create-throughput.md「扇風機」）。
 * filling・emptying はスパウトとアイテムドレイン、mechanical_crafting と作業台の2つはメカニカルクラフター（#235）
 */
export type ProcessingRecipeType = CreateRecipeType | CookingRecipeType | CraftingRecipeType
export const CREATE_RECIPE_TYPES: readonly CreateRecipeType[] = [
  'milling',
  'crushing',
  'cutting',
  'mixing',
  'pressing',
  'compacting',
  'splashing',
  'haunting',
  'filling',
  'emptying',
  'mechanical_crafting',
]
export const COOKING_RECIPE_TYPES: readonly CookingRecipeType[] = ['smelting', 'blasting', 'smoking']
export const CRAFTING_RECIPE_TYPES: readonly CraftingRecipeType[] = ['crafting_shaped', 'crafting_shapeless']
/** `minecraft:` の種類 */
const MINECRAFT_RECIPE_TYPES: readonly string[] = [...COOKING_RECIPE_TYPES, ...CRAFTING_RECIPE_TYPES]
export const PROCESSING_RECIPE_TYPES: readonly ProcessingRecipeType[] = [
  ...CREATE_RECIPE_TYPES,
  ...COOKING_RECIPE_TYPES,
  ...CRAFTING_RECIPE_TYPES,
]

/** 種類の ID（`create:milling`、`minecraft:smelting`） */
export function recipeTypeId(type: ProcessingRecipeType): string {
  return MINECRAFT_RECIPE_TYPES.includes(type) ? `minecraft:${type}` : `create:${type}`
}

/** 種類の ID（`create:milling`、`minecraft:smelting`）を短い名前にする。読まない種類なら null */
export function parseRecipeType(id: string): ProcessingRecipeType | null {
  const m = /^(create|minecraft):(\w+)$/.exec(id)
  if (!m) return null
  const list: readonly string[] = m[1] === 'create' ? CREATE_RECIPE_TYPES : MINECRAFT_RECIPE_TYPES
  return list.includes(m[2]!) ? (m[2] as ProcessingRecipeType) : null
}

/** レシピ1つ分。IndexedDB に保存し、Worker にも送るので、ただのデータだけにする */
export interface ProcessingRecipe {
  /** `create:milling/wheat`（namespace と、recipes/ の下のパス） */
  readonly id: string
  readonly type: ProcessingRecipeType
  /** 材料のアイテムの ID（`minecraft:wheat`） */
  readonly items: string[]
  /** 材料のタグ（`forge:ores/iron`） */
  readonly tags: string[]
  /** 処理時間（tick）。書いていなければ 0（pressing・compacting はふつう書いていない） */
  readonly duration: number
  /** できる物（#127）。液体は含めない */
  readonly results: RecipeResult[]
  /** 液体の材料の ID（`minecraft:water`）。filling だけが持つ（#235） */
  readonly fluids?: string[]
  /** 液体の材料のタグ（`c:honey`、`#` なし）。filling だけが持つ（#235） */
  readonly fluidTags?: string[]
  /** 材料の並び。作業台とメカニカルクラフターのレシピだけが持つ（#235） */
  readonly grid?: CraftingGrid
}

/** 1マス分の材料。どれか1つが合えばよい */
export interface CraftingIngredient {
  readonly items: string[]
  readonly tags: string[]
}

/** 作業台・メカニカルクラフターのレシピの材料の並び（docs/create-throughput.md `TP-RECIPE-CRAFTING`） */
export interface CraftingGrid {
  /** 形のあるレシピの並び（上の行から、左から）。null は空き。形のないレシピなら null */
  readonly rows: (CraftingIngredient | null)[][] | null
  /** 形のないレシピの材料（1つが1マス）。形のあるレシピなら空 */
  readonly ingredients: CraftingIngredient[]
  /** 左右を入れ替えた並びも受け付ける */
  readonly mirrored: boolean
}

/** レシピの結果1つ分 */
export interface RecipeResult {
  /** アイテムの ID */
  readonly item: string
  /** 個数。書いていなければ 1 */
  readonly count: number
  /** できる確率（0〜1）。書いていなければ 1 */
  readonly chance: number
}

/** Modpack のレシピ全体 */
export interface RecipeBook {
  readonly recipes: readonly ProcessingRecipe[]
  /** kubejs/server_scripts/ にレシピを変えるスクリプトがあり、動かしていない・動かせなかった（スクリプトのレシピは入っていない） */
  readonly scriptsChangeRecipes: boolean
  /** スクリプトを動かした結果のまとめ。動かしていなければない（#145） */
  readonly scripts?: ScriptRunSummary
  /**
   * アイテムのタグ（`forge:ores/iron`、`#` なし）→ そのタグに入るアイテムの ID。入れ子のタグはたどって平らにしてある（#127）。
   * jar と kubejs/data のタグをまとめたもの。KubeJS のスクリプトで変えたタグは入らない
   */
  readonly itemTags: Readonly<Record<string, readonly string[]>>
}

/** jar・データパックの中のレシピのパス。1: namespace、2: recipes/ の下のパス（.json なし） */
export const RECIPE_PATH = /^data\/([^/]+)\/recipes?\/(.+)\.json$/

/**
 * レシピ JSON を読む。処理時間の計算に使う種類でなければ null。
 * id は `namespace:path`
 */
export function readProcessingRecipe(id: string, data: unknown): ProcessingRecipe | null {
  if (!isObject(data)) return null
  const type = parseRecipeType(typeof data.type === 'string' ? data.type : '')
  if (!type) return null
  const items = new Set<string>()
  const tags = new Set<string>()
  if (type === 'crafting_shaped' || type === 'crafting_shapeless' || type === 'mechanical_crafting') {
    return readCraftingRecipe(id, type, data)
  }
  if ((COOKING_RECIPE_TYPES as readonly string[]).includes(type)) {
    // 料理のレシピ：材料は ingredient、できる物は result（1.18 は文字列、1.21 は { id, count }）。cookingtime は使わない
    collectIngredients(data.ingredient, items, tags)
    const result = typeof data.result === 'string' ? [{ item: data.result }] : [data.result]
    return { id, type, items: [...items], tags: [...tags], duration: 0, results: readResults(result) }
  }
  collectIngredients(data.ingredients, items, tags)
  // 1.18 は processingTime、1.21（Create 6.0）は processing_time
  const time = data.processingTime ?? data.processing_time
  const recipe: ProcessingRecipe = {
    id,
    type,
    items: [...items],
    tags: [...tags],
    duration: typeof time === 'number' && Number.isFinite(time) && time > 0 ? Math.floor(time) : 0,
    results: readResults(data.results),
  }
  if (type !== 'filling') return recipe
  const fluids = new Set<string>()
  const fluidTags = new Set<string>()
  collectFluidIngredients(data.ingredients, fluids, fluidTags)
  return { ...recipe, fluids: [...fluids], fluidTags: [...fluidTags] }
}

/** 作業台・メカニカルクラフターのレシピを読む（TP-RECIPE-CRAFTING）。並びが読めなければ null */
function readCraftingRecipe(
  id: string,
  type: 'crafting_shaped' | 'crafting_shapeless' | 'mechanical_crafting',
  data: Record<string, unknown>,
): ProcessingRecipe | null {
  const results = readResults([data.result])
  if (results.length === 0) return null
  let grid: CraftingGrid
  if (type === 'crafting_shapeless') {
    if (!Array.isArray(data.ingredients)) return null
    const ingredients = data.ingredients.map(readIngredient)
    if (ingredients.length === 0 || ingredients.some((i) => i === null)) return null
    grid = { rows: null, ingredients: ingredients as CraftingIngredient[], mirrored: true }
  } else {
    const pattern = data.pattern
    const key = data.key
    if (!Array.isArray(pattern) || !pattern.every((r) => typeof r === 'string') || !isObject(key)) return null
    const rows: (CraftingIngredient | null)[][] = []
    for (const row of pattern as string[]) {
      const cells: (CraftingIngredient | null)[] = []
      for (const c of row) {
        if (c === ' ') {
          cells.push(null)
          continue
        }
        const ing = readIngredient(key[c])
        if (!ing) return null
        cells.push(ing)
      }
      rows.push(cells)
    }
    if (rows.length === 0) return null
    const mirror = data.accept_mirrored ?? data.acceptMirrored
    grid = { rows, ingredients: [], mirrored: type !== 'mechanical_crafting' || mirror !== false }
  }
  const items = new Set<string>()
  const tags = new Set<string>()
  for (const ing of [...grid.ingredients, ...(grid.rows ?? []).flat()]) {
    for (const i of ing?.items ?? []) items.add(i)
    for (const t of ing?.tags ?? []) tags.add(t)
  }
  return { id, type, items: [...items], tags: [...tags], duration: 0, results, grid }
}

/** 1マス分の材料を読む。読めなければ null */
function readIngredient(value: unknown): CraftingIngredient | null {
  const items = new Set<string>()
  const tags = new Set<string>()
  collectIngredients(value, items, tags)
  return items.size + tags.size > 0 ? { items: [...items], tags: [...tags] } : null
}

/**
 * 液体の材料を集める（#235）。読める形：
 * - 1.18：`{ fluid, amount }`・`{ fluidTag, amount }`
 * - 1.21（Create 6.0）：`{ type: 'neoforge:single', fluid, amount }`・`{ type: 'neoforge:tag', tag, amount }`
 */
function collectFluidIngredients(value: unknown, fluids: Set<string>, tags: Set<string>): void {
  if (Array.isArray(value)) {
    for (const v of value) collectFluidIngredients(v, fluids, tags)
    return
  }
  if (!isObject(value)) return
  const isFluid = 'amount' in value || 'fluid' in value || 'fluidTag' in value
  if (!isFluid) return
  if (typeof value.fluid === 'string') fluids.add(value.fluid)
  if (typeof value.fluidTag === 'string') tags.add(value.fluidTag)
  if (typeof value.tag === 'string') tags.add(value.tag)
}

/**
 * できる物を読む。1.18 は `{ item, count?, chance? }`、1.21（Create 6.0）は `{ id, count?, chance? }`。
 * 液体（1.18 は `{ fluid, amount }`、1.21 は `{ id, amount }`）と、ID が文字列でないものは見ない
 */
function readResults(value: unknown): RecipeResult[] {
  if (!Array.isArray(value)) return []
  const results: RecipeResult[] = []
  for (const v of value) {
    if (!isObject(v) || 'amount' in v || 'fluid' in v) continue
    const item = typeof v.item === 'string' ? v.item : typeof v.id === 'string' ? v.id : null
    if (item === null) continue
    const count = typeof v.count === 'number' && Number.isFinite(v.count) && v.count >= 1 ? Math.floor(v.count) : 1
    const chance = typeof v.chance === 'number' && Number.isFinite(v.chance) && v.chance >= 0 ? Math.min(v.chance, 1) : 1
    results.push({ item, count, chance })
  }
  return results
}

/**
 * 材料から、アイテムの ID とタグを集める。液体は見ない。読める形：
 * - `{item}`・`{tag}`・その配列（入れ子の配列も）
 * - NeoForge のいずれかの材料 `{ type: 'neoforge:compound', ingredients: [...] }`（Create 6.0 の Mod 連携のレシピ。#139）
 * - 文字列 `"minecraft:wheat"`・`"#c:ores/iron"`（1.21.2 からの形）
 */
function collectIngredients(value: unknown, items: Set<string>, tags: Set<string>): void {
  if (Array.isArray(value)) {
    for (const v of value) collectIngredients(v, items, tags)
    return
  }
  if (typeof value === 'string') {
    if (value.startsWith('#')) tags.add(value.slice(1))
    else if (value.includes(':')) items.add(value)
    return
  }
  // 液体の材料（1.21 は `{ type, tag, amount }`、1.18 は `{ fluid / fluidTag, amount }`）は見ない
  if (!isObject(value) || 'amount' in value || 'fluid' in value || 'fluidTag' in value) return
  if (value.type === 'neoforge:compound') {
    collectIngredients(value.ingredients ?? value.children, items, tags)
    return
  }
  if (typeof value.item === 'string') items.add(value.item)
  if (typeof value.tag === 'string') tags.add(value.tag)
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** レシピを ID でまとめる。同じ ID なら後のものを使う */
export function mergeRecipes(...lists: readonly (readonly ProcessingRecipe[])[]): ProcessingRecipe[] {
  const byId = new Map<string, ProcessingRecipe>()
  for (const list of lists) for (const r of list) byId.set(r.id, r)
  return [...byId.values()]
}
