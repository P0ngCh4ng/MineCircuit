// Minecraft 本体のレシピの読み方。料理（smelting・blasting・smoking）と作業台（crafting_shaped・crafting_shapeless）。
// 料理は Create の扇風機、作業台はメカニカルクラフターの計算が使う（#235）。

import { craftingJsonFromScript } from '../kubejsScripts/scriptRecipes'
import { toIngredients, toResults } from '../kubejsScripts/scriptValues'
import { collectIngredients, readCraftingRecipe, readResults, type RecipeFormat, type RecipeScriptBuilder } from './recipeFormat'

/** 料理のレシピの種類（`minecraft:` を外した名前） */
export type CookingRecipeType = 'smelting' | 'blasting' | 'smoking'
/** 作業台のレシピの種類 */
export type CraftingRecipeType = 'crafting_shaped' | 'crafting_shapeless'
export const COOKING_RECIPE_TYPES: readonly CookingRecipeType[] = ['smelting', 'blasting', 'smoking']
export const CRAFTING_RECIPE_TYPES: readonly CraftingRecipeType[] = ['crafting_shaped', 'crafting_shapeless']

/** 料理のレシピ（`event.smelting(出る物, 材料)`）。出る物は1つ。処理時間は読まない */
function cookingBuilder(type: CookingRecipeType): RecipeScriptBuilder {
  return (ctx, [output, input]) => {
    const { items, tags } = toIngredients(input)
    return { id: ctx.nextId(), type: `minecraft:${type}`, items, tags, duration: 0, results: toResults(output).slice(0, 1) }
  }
}

/** 作業台のレシピ（`event.shaped(出る物, パターン, キー)`・`event.shapeless(出る物, 材料)`） */
function craftingBuilder(type: CraftingRecipeType): RecipeScriptBuilder {
  return (ctx, [output, inputs, key]) => {
    const json = craftingJsonFromScript(`minecraft:${type}`, type === 'crafting_shapeless', output, inputs, key)
    return MINECRAFT_RECIPES.read(ctx.nextId(), type, json)
  }
}

function builder(name: string): RecipeScriptBuilder | null {
  if ((COOKING_RECIPE_TYPES as readonly string[]).includes(name)) return cookingBuilder(name as CookingRecipeType)
  if ((CRAFTING_RECIPE_TYPES as readonly string[]).includes(name)) return craftingBuilder(name as CraftingRecipeType)
  return null
}

export const MINECRAFT_RECIPES: RecipeFormat = {
  namespace: 'minecraft',
  types: [...COOKING_RECIPE_TYPES, ...CRAFTING_RECIPE_TYPES],
  read(id, type, data) {
    if (type === 'crafting_shaped' || type === 'crafting_shapeless') {
      return readCraftingRecipe(id, `minecraft:${type}`, data, { shapeless: type === 'crafting_shapeless', readMirrorFlag: false })
    }
    // 料理のレシピ：材料は ingredient、できる物は result（1.18 は文字列、1.21 は { id, count }）。cookingtime は使わない
    const items = new Set<string>()
    const tags = new Set<string>()
    collectIngredients(data.ingredient, items, tags)
    const result = typeof data.result === 'string' ? [{ item: data.result }] : [data.result]
    return { id, type: `minecraft:${type}`, items: [...items], tags: [...tags], duration: 0, results: readResults(result) }
  },
  script: {
    builder,
    eventMethods: {
      smelting: cookingBuilder('smelting'),
      blasting: cookingBuilder('blasting'),
      smoking: cookingBuilder('smoking'),
      shaped: craftingBuilder('crafting_shaped'),
      shapeless: craftingBuilder('crafting_shapeless'),
    },
  },
}
