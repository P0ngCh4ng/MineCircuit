// Create の計算が使うレシピの種類（docs/create-throughput.md「レシピ」、docs/design.md「レシピ（Mod ごとの読み方）」）。
// RecipeBook のレシピは種類の ID（`create:milling`、`minecraft:smelting`）を持つ。Create の計算の中では短い名前（`milling`）で扱う。

import type { ProcessingRecipe, RecipeBook } from '../../io/modpack/recipes'
import { CREATE_RECIPE_TYPES, type CreateRecipeType } from '../../io/modpack/recipes/createRecipes'
import { COOKING_RECIPE_TYPES, CRAFTING_RECIPE_TYPES, type CookingRecipeType, type CraftingRecipeType } from '../../io/modpack/recipes/minecraftRecipes'

/**
 * Create の計算が使うレシピの種類。Create の処理の11種と、扇風機で燻す・焼くのに使う料理の3種、
 * メカニカルクラフターに使う作業台の2種（#235）
 */
export type CreateRecipeKind = CreateRecipeType | CookingRecipeType | CraftingRecipeType

export const CREATE_RECIPE_KINDS: readonly CreateRecipeKind[] = [...CREATE_RECIPE_TYPES, ...COOKING_RECIPE_TYPES, ...CRAFTING_RECIPE_TYPES]

const MINECRAFT_KINDS: readonly string[] = [...COOKING_RECIPE_TYPES, ...CRAFTING_RECIPE_TYPES]

/** 種類の ID（`create:milling`、`minecraft:smelting`） */
export function recipeTypeId(kind: CreateRecipeKind): string {
  return MINECRAFT_KINDS.includes(kind) ? `minecraft:${kind}` : `create:${kind}`
}

const KIND_BY_ID: ReadonlyMap<string, CreateRecipeKind> = new Map(CREATE_RECIPE_KINDS.map((k) => [recipeTypeId(k), k]))

/** 種類の ID → 短い名前。Create の計算が使わない種類なら null */
export function recipeKind(typeId: string): CreateRecipeKind | null {
  return KIND_BY_ID.get(typeId) ?? null
}

/** その種類のレシピ */
export function recipesOfKind(book: RecipeBook | null, kind: CreateRecipeKind): ProcessingRecipe[] {
  const id = recipeTypeId(kind)
  return book?.recipes.filter((r) => r.type === id) ?? []
}
