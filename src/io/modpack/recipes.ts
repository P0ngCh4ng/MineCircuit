// Create の処理のレシピ（docs/create-throughput.md「レシピ」）。
// jar の data/<namespace>/recipes/（1.21 は recipe/）と、Modpack の kubejs/data/ のレシピ JSON から、
// 処理時間の計算に使う種類だけを読み、材料・処理時間・できる物だけを残す。KubeJS のスクリプトのレシピは読めないので、
// スクリプトがレシピを変えているかどうかだけを調べる（kubejsRecipes.ts）。

/**
 * 読むレシピの種類（`create:` を外した名前）。
 * pressing はベルト・デポの上のプレス、compacting はバスンの上のプレス（圧縮）。この2つはふつう処理時間を書かない
 */
export type ProcessingRecipeType = 'milling' | 'crushing' | 'cutting' | 'mixing' | 'pressing' | 'compacting'
export const PROCESSING_RECIPE_TYPES: readonly ProcessingRecipeType[] = [
  'milling',
  'crushing',
  'cutting',
  'mixing',
  'pressing',
  'compacting',
]

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
  /** kubejs/server_scripts/ にレシピを変えるスクリプトがある（中身は読めない） */
  readonly scriptsChangeRecipes: boolean
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
  const type = typeof data.type === 'string' ? data.type : ''
  const m = /^create:(milling|crushing|cutting|mixing|pressing|compacting)$/.exec(type)
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
    results: readResults(data.results),
  }
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
