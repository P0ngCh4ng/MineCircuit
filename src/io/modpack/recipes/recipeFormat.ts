// レシピの共通の形と、Mod ごとの読み方（RecipeFormat）の決まり（docs/design.md「レシピ（Mod ごとの読み方）」）。
// jar の data/<namespace>/recipes/（1.21 は recipe/）と、Modpack の kubejs/data/ のレシピ JSON から、
// 読み方の表（index.ts）にある種類だけを読み、材料・処理時間・できる物だけを残す。KubeJS のスクリプトのレシピは、
// スクリプトを作り物の KubeJS で動かして集める（kubejsScripts/。#145）。
// ここには Mod の名前を出さない。Mod ごとの読み方は <mod>Recipes.ts に置く。

import type { ScriptRunSummary } from '../kubejsScripts/scriptTypes'

/** レシピ1つ分。IndexedDB に保存し、Worker にも送るので、ただのデータだけにする */
export interface ProcessingRecipe {
  /** `create:milling/wheat`（namespace と、recipes/ の下のパス） */
  readonly id: string
  /** 種類の ID（`create:milling`、`minecraft:smelting`） */
  readonly type: string
  /** 材料のアイテムの ID（`minecraft:wheat`） */
  readonly items: string[]
  /** 材料のタグ（`forge:ores/iron`） */
  readonly tags: string[]
  /** 処理時間（tick）。書いていなければ 0 */
  readonly duration: number
  /** できる物（#127）。液体は含めない */
  readonly results: RecipeResult[]
  /** 液体の材料の ID（`minecraft:water`）。液体を材料にする種類だけが持つ（#235） */
  readonly fluids?: string[]
  /** 液体の材料のタグ（`c:honey`、`#` なし）。液体を材料にする種類だけが持つ（#235） */
  readonly fluidTags?: string[]
  /** 材料の並び。並びのある種類（作業台など）だけが持つ（#235） */
  readonly grid?: CraftingGrid
}

/** 1マス分の材料。どれか1つが合えばよい */
export interface CraftingIngredient {
  readonly items: string[]
  readonly tags: string[]
}

/** 作業台などのレシピの材料の並び（docs/create-throughput.md `TP-RECIPE-CRAFTING`） */
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

/** 作り物の KubeJS がレシピを作るときに渡す値 */
export interface RecipeScriptContext {
  /** スクリプトで作ったレシピの ID を作る */
  nextId(): string
}

/** スクリプトのレシピの関数1つ。引数はスクリプトが渡したまま。作れなければ null */
export type RecipeScriptBuilder = (ctx: RecipeScriptContext, args: readonly unknown[]) => ProcessingRecipe | null

/** 作り物の KubeJS で、ある Mod のレシピを作る関数（kubejsScripts/fakeKubeJs.ts が使う） */
export interface RecipeScriptApi {
  /** `event.recipes.<namespace>.<name>(…)` の name（`mechanicalCrafting` のような書き方も）→ 関数。知らない名前は null */
  builder(name: string): RecipeScriptBuilder | null
  /** 1.18 の `event.recipes.<namespace><Name>(…)`（`createMilling`）の形も受け付ける */
  readonly prefixedNames?: boolean
  /** `event.<name>(…)`（KubeJS が本体のために持つ `event.smelting`・`event.shaped` など） */
  readonly eventMethods?: Readonly<Record<string, RecipeScriptBuilder>>
  /** スクリプトに見せる大域（Mod の KubeJS の連携が足すもの。`CreateItem` など） */
  readonly globals?: Readonly<Record<string, unknown>>
}

/** ある Mod（namespace）のレシピの読み方 */
export interface RecipeFormat {
  /** 種類の ID の namespace（`create`・`minecraft`） */
  readonly namespace: string
  /** 読む種類（namespace を外した名前） */
  readonly types: readonly string[]
  /** レシピ JSON を読む。type は types のどれか。読めなければ null */
  read(id: string, type: string, data: Record<string, unknown>): ProcessingRecipe | null
  /** 作り物の KubeJS でこの Mod のレシピを作る関数。なければスクリプトからは集めない */
  readonly script?: RecipeScriptApi
}

/** jar・データパックの中のレシピのパス。1: namespace、2: recipes/ の下のパス（.json なし） */
export const RECIPE_PATH = /^data\/([^/]+)\/recipes?\/(.+)\.json$/

/** レシピを ID でまとめる。同じ ID なら後のものを使う */
export function mergeRecipes(...lists: readonly (readonly ProcessingRecipe[])[]): ProcessingRecipe[] {
  const byId = new Map<string, ProcessingRecipe>()
  for (const list of lists) for (const r of list) byId.set(r.id, r)
  return [...byId.values()]
}

// ---- 読み方の部品（Mod ごとの読み方から使う） ----

export function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * 作業台の形のレシピを読む（TP-RECIPE-CRAFTING）。並びが読めなければ null。
 * shapeless は `ingredients`、形のあるものは `pattern` と `key`。できる物は `result`。
 * readMirrorFlag なら `accept_mirrored`（`acceptMirrored`）が false のときだけ左右を入れ替えない。そうでなければ常に入れ替えてよい
 */
export function readCraftingRecipe(
  id: string,
  type: string,
  data: Record<string, unknown>,
  shape: { readonly shapeless: boolean; readonly readMirrorFlag: boolean },
): ProcessingRecipe | null {
  const results = readResults([data.result])
  if (results.length === 0) return null
  let grid: CraftingGrid
  if (shape.shapeless) {
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
    grid = { rows, ingredients: [], mirrored: !shape.readMirrorFlag || mirror !== false }
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
 * - 1.21：`{ type: 'neoforge:single', fluid, amount }`・`{ type: 'neoforge:tag', tag, amount }`
 */
export function collectFluidIngredients(value: unknown, fluids: Set<string>, tags: Set<string>): void {
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
 * できる物を読む。1.18 は `{ item, count?, chance? }`、1.21 は `{ id, count?, chance? }`。
 * 液体（1.18 は `{ fluid, amount }`、1.21 は `{ id, amount }`）と、ID が文字列でないものは見ない
 */
export function readResults(value: unknown): RecipeResult[] {
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
 * - NeoForge のいずれかの材料 `{ type: 'neoforge:compound', ingredients: [...] }`（Mod 連携のレシピ。#139）
 * - 文字列 `"minecraft:wheat"`・`"#c:ores/iron"`（1.21.2 からの形）
 */
export function collectIngredients(value: unknown, items: Set<string>, tags: Set<string>): void {
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
