import { describe, expect, it } from 'vitest'
import type { ProcessingRecipe, RecipeBook } from '../../io/modpack/recipes'
import { CREATE_RECIPE_KINDS, recipeKind, recipesOfKind, recipeTypeId } from './createRecipeTypes'

const r = (id: string, type: string): ProcessingRecipe => ({ id, type, items: [], tags: [], duration: 0, results: [] })

describe('Create の計算が使うレシピの種類', () => {
  it('[TP-RECIPE-TYPES] 短い名前と種類の ID を行き来する。料理と作業台は minecraft:、ほかは create:', () => {
    expect(recipeTypeId('milling')).toBe('create:milling')
    expect(recipeTypeId('mechanical_crafting')).toBe('create:mechanical_crafting')
    expect(recipeTypeId('smoking')).toBe('minecraft:smoking')
    expect(recipeTypeId('crafting_shaped')).toBe('minecraft:crafting_shaped')
    for (const kind of CREATE_RECIPE_KINDS) expect(recipeKind(recipeTypeId(kind))).toBe(kind)
    expect(CREATE_RECIPE_KINDS).toHaveLength(16)
    // Create の計算が使わない種類
    expect(recipeKind('create:deploying')).toBeNull()
    expect(recipeKind('minecraft:campfire_cooking')).toBeNull()
    expect(recipeKind('other:milling')).toBeNull()
  })

  it('種類の ID でレシピを選ぶ。Modpack がなければ空', () => {
    const book: RecipeBook = {
      recipes: [r('a:1', 'create:milling'), r('a:2', 'other:milling'), r('a:3', 'minecraft:smelting'), r('a:4', 'create:milling')],
      scriptsChangeRecipes: false,
      itemTags: {},
    }
    expect(recipesOfKind(book, 'milling').map((x) => x.id)).toEqual(['a:1', 'a:4'])
    expect(recipesOfKind(book, 'smelting').map((x) => x.id)).toEqual(['a:3'])
    expect(recipesOfKind(null, 'milling')).toEqual([])
  })
})
