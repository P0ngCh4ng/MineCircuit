// Create の処理のレシピ（docs/create-throughput.md「レシピ」）。
// jar の data/<namespace>/recipes/（1.21 は recipe/）と、Modpack の kubejs/data/ のレシピ JSON から、
// 処理時間の計算に使う種類だけを読み、材料と処理時間だけを残す。KubeJS のスクリプトのレシピは読めないので、
// スクリプトがレシピを変えているかどうかだけを調べる（kubejsRecipes.ts）。

/** 読むレシピの種類（`create:` を外した名前） */
export type ProcessingRecipeType = 'milling' | 'crushing' | 'cutting' | 'mixing'
export const PROCESSING_RECIPE_TYPES: readonly ProcessingRecipeType[] = ['milling', 'crushing', 'cutting', 'mixing']

/** レシピ1つ分。IndexedDB に保存し、Worker にも送るので、ただのデータだけにする */
export interface ProcessingRecipe {
  /** `create:milling/wheat`（namespace と、recipes/ の下のパス） */
  readonly id: string
  readonly type: ProcessingRecipeType
  /** 材料のアイテムの ID（`minecraft:wheat`） */
  readonly items: string[]
  /** 材料のタグ（`forge:ores/iron`） */
  readonly tags: string[]
  /** 処理時間（tick）。書いていなければ 0 */
  readonly duration: number
}

/** Modpack のレシピ全体 */
export interface RecipeBook {
  readonly recipes: readonly ProcessingRecipe[]
  /** kubejs/server_scripts/ にレシピを変えるスクリプトがある（中身は読めない） */
  readonly scriptsChangeRecipes: boolean
}

/** jar・データパックの中のレシピのパス。1: namespace、2: recipes/ の下のパス（.json なし） */
export const RECIPE_PATH = /^data\/([^/]+)\/recipes?\/(.+)\.json$/

/**
 * レシピ JSON を読む。処理時間の計算に使う種類でなければ null。
 * id は `namespace:path`
 */
export function readProcessingRecipe(id: string, data: unknown): ProcessingRecipe | null {
  if (!isObject(data)) return null
  const type = typeof data.type === 'string' ? data.type : ''
  const m = /^create:(milling|crushing|cutting|mixing)$/.exec(type)
  if (!m) return null
  const items = new Set<string>()
  const tags = new Set<string>()
  collectIngredients(data.ingredients, items, tags)
  // 1.18 は processingTime、1.21（Create 6.0）は processing_time
  const time = data.processingTime ?? data.processing_time
  return {
    id,
    type: m[1] as ProcessingRecipeType,
    items: [...items],
    tags: [...tags],
    duration: typeof time === 'number' && Number.isFinite(time) && time > 0 ? Math.floor(time) : 0,
  }
}

/** 材料（`{item}`・`{tag}`・その配列。入れ子の配列も）から、アイテムの ID とタグを集める。液体は見ない */
function collectIngredients(value: unknown, items: Set<string>, tags: Set<string>): void {
  if (Array.isArray(value)) {
    for (const v of value) collectIngredients(v, items, tags)
    return
  }
  // 液体の材料（1.21 は `{ type, tag, amount }`、1.18 は `{ fluid / fluidTag, amount }`）は見ない
  if (!isObject(value) || 'amount' in value || 'fluid' in value || 'fluidTag' in value) return
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
