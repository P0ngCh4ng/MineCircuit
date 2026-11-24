// レシピの読み方の表（docs/design.md「レシピ（Mod ごとの読み方）」）。
// Mod のレシピを足すときは、<mod>Recipes.ts を作って RECIPE_FORMATS に足す。ほかの共通の部分には手を入れない。

import { CREATE_RECIPES } from './createRecipes'
import { MINECRAFT_RECIPES } from './minecraftRecipes'
import { isObject, type ProcessingRecipe, type RecipeFormat } from './recipeFormat'

export * from './recipeFormat'

/** 読むレシピの Mod ごとの読み方。namespace が重ならないようにする */
export const RECIPE_FORMATS: readonly RecipeFormat[] = [MINECRAFT_RECIPES, CREATE_RECIPES]

const byNamespace = new Map(RECIPE_FORMATS.map((f) => [f.namespace, f]))

/** namespace の読み方。なければ null */
export function recipeFormat(namespace: string): RecipeFormat | null {
  return byNamespace.get(namespace) ?? null
}

/** 表にある種類の ID（`create:milling`、`minecraft:smelting`） */
export const RECIPE_TYPE_IDS: readonly string[] = RECIPE_FORMATS.flatMap((f) => f.types.map((t) => `${f.namespace}:${t}`))

/** 種類の ID が表にあれば、その読み方と短い名前 */
function lookup(typeId: string): { format: RecipeFormat; type: string } | null {
  const i = typeId.indexOf(':')
  if (i < 0) return null
  const format = recipeFormat(typeId.slice(0, i))
  const type = typeId.slice(i + 1)
  return format && format.types.includes(type) ? { format, type } : null
}

/** 種類の ID が表にあるか */
export function isKnownRecipeType(typeId: string): boolean {
  return lookup(typeId) !== null
}

/**
 * レシピ JSON を読む。表にない種類か、読めなければ null。
 * id は `namespace:path`
 */
export function readRecipe(id: string, data: unknown): ProcessingRecipe | null {
  if (!isObject(data) || typeof data.type !== 'string') return null
  const found = lookup(data.type)
  return found ? found.format.read(id, found.type, data) : null
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 読むかもしれないレシピの JSON（中身を読む前の絞り込み）。表にある種類の ID を `"…"` で含むもの */
const MAYBE_READ_RECIPE = new RegExp(`"(${RECIPE_TYPE_IDS.map(escapeRegExp).join('|')})"`)

/** レシピ JSON の文字列が、表にある種類かもしれないか。false なら読まなくてよい */
export function mayBeKnownRecipe(source: string): boolean {
  return MAYBE_READ_RECIPE.test(source)
}
