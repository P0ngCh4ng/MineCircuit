// Create の処理のレシピの読み方（docs/create-throughput.md「レシピ」）。
// pressing はベルト・デポの上のプレス、compacting はバスンの上のプレス（圧縮）。この2つはふつう処理時間を書かない。
// splashing・haunting は扇風機の処理（docs/create-throughput.md「扇風機」）。
// filling・emptying はスパウトとアイテムドレイン、mechanical_crafting はメカニカルクラフター（#235）。

import { craftingJsonFromScript, snakeCase } from '../kubejsScripts/scriptRecipes'
import { itemOf, toFluidIngredients, toIngredients, toResults } from '../kubejsScripts/scriptValues'
import {
  collectFluidIngredients,
  collectIngredients,
  readCraftingRecipe,
  readResults,
  type ProcessingRecipe,
  type RecipeFormat,
  type RecipeScriptBuilder,
} from './recipeFormat'

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

/** `.processingTime(n)` を呼ばないときの処理時間。kubejs-create の初期値（1802 の ProcessingRecipeJS、2001 の ProcessingRecipeSchema） */
const SCRIPT_PROCESSING_TIME = 100

function read(id: string, type: string, data: Record<string, unknown>): ProcessingRecipe | null {
  if (type === 'mechanical_crafting') {
    return readCraftingRecipe(id, 'create:mechanical_crafting', data, { shapeless: false, readMirrorFlag: true })
  }
  const items = new Set<string>()
  const tags = new Set<string>()
  collectIngredients(data.ingredients, items, tags)
  // 1.18 は processingTime、1.21（Create 6.0）は processing_time
  const time = data.processingTime ?? data.processing_time
  const recipe: ProcessingRecipe = {
    id,
    type: `create:${type}`,
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

/** `event.recipes.create.milling(出る物, 材料)`。処理時間は初期値で、`.processingTime(n)` で変わる */
function processingBuilder(type: CreateRecipeType): RecipeScriptBuilder {
  return (ctx, [outputs, inputs]) => {
    const { items, tags } = toIngredients(inputs)
    const recipe: ProcessingRecipe = {
      id: ctx.nextId(),
      type: `create:${type}`,
      items,
      tags,
      duration: SCRIPT_PROCESSING_TIME,
      results: toResults(outputs),
    }
    // スパウトのレシピは液体の材料も持つ（`Fluid.of('minecraft:water', 250)`。#235）
    return type === 'filling' ? { ...recipe, ...toFluidIngredients(inputs) } : recipe
  }
}

/** `event.recipes.create.mechanical_crafting(出る物, パターン, キー)`。レシピ JSON にして読む（#235） */
const mechanicalCraftingBuilder: RecipeScriptBuilder = (ctx, [output, pattern, key]) =>
  read(ctx.nextId(), 'mechanical_crafting', craftingJsonFromScript('create:mechanical_crafting', false, output, pattern, key))

/** `milling`・`mechanicalCrafting` → 関数。Create の種類でなければ null */
function builder(name: string): RecipeScriptBuilder | null {
  const type = snakeCase(name)
  if (!(CREATE_RECIPE_TYPES as readonly string[]).includes(type)) return null
  return type === 'mechanical_crafting' ? mechanicalCraftingBuilder : processingBuilder(type as CreateRecipeType)
}

export const CREATE_RECIPES: RecipeFormat = {
  namespace: 'create',
  types: CREATE_RECIPE_TYPES,
  read,
  script: {
    builder,
    prefixedNames: true,
    // 1.21 の kubejs-create の確率付きの物
    globals: { CreateItem: { of: (id: unknown, chance?: unknown) => itemOf(id).withChance(chance ?? 1) } },
  },
}
