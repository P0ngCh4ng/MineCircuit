import { describe, expect, it } from 'vitest'
import { mergeRecipes, readProcessingRecipe, RECIPE_PATH, type ProcessingRecipe } from './recipes'

describe('readProcessingRecipe', () => {
  it('石臼・粉砕・ソー・ミキサーのレシピを読む。種類は create: を外した名前', () => {
    for (const type of ['milling', 'crushing', 'cutting', 'mixing'] as const) {
      const r = readProcessingRecipe(`create:${type}/x`, { type: `create:${type}`, ingredients: [{ item: 'minecraft:wheat' }] })
      expect(r).toEqual({ id: `create:${type}/x`, type, items: ['minecraft:wheat'], tags: [], duration: 0 })
    }
  })

  it('ほかの種類・type がない・オブジェクトでないものは null', () => {
    expect(readProcessingRecipe('create:p', { type: 'create:pressing', ingredients: [] })).toBeNull()
    expect(readProcessingRecipe('minecraft:s', { type: 'minecraft:smelting', ingredient: { item: 'a:b' } })).toBeNull()
    expect(readProcessingRecipe('x:milling', { type: 'other:milling' })).toBeNull()
    expect(readProcessingRecipe('x:y', { ingredients: [] })).toBeNull()
    expect(readProcessingRecipe('x:y', { type: 1 })).toBeNull()
    expect(readProcessingRecipe('x:y', null)).toBeNull()
    expect(readProcessingRecipe('x:y', [{ type: 'create:milling' }])).toBeNull()
    expect(readProcessingRecipe('x:y', 'create:milling')).toBeNull()
  })

  it('材料は1つのオブジェクトでも、配列でも、入れ子の配列でも読む。同じものは1つにまとめる', () => {
    expect(readProcessingRecipe('a:1', { type: 'create:milling', ingredients: { item: 'minecraft:wheat' } })?.items).toEqual([
      'minecraft:wheat',
    ])
    const r = readProcessingRecipe('a:2', {
      type: 'create:mixing',
      ingredients: [
        [{ item: 'minecraft:iron_ingot' }, { tag: 'forge:ingots/iron' }],
        { item: 'minecraft:iron_ingot' },
        [[{ item: 'minecraft:copper_ingot' }]],
      ],
    })
    expect(r?.items).toEqual(['minecraft:iron_ingot', 'minecraft:copper_ingot'])
    expect(r?.tags).toEqual(['forge:ingots/iron'])
  })

  it('item と tag を両方持つ材料は両方を集める。液体と、文字列でない値は見ない', () => {
    const r = readProcessingRecipe('a:3', {
      type: 'create:mixing',
      ingredients: [
        { item: 'a:item', tag: 'a:tag' },
        { fluid: 'minecraft:water', amount: 250 },
        { fluidTag: 'forge:milk', amount: 250 },
        { item: 5, tag: null },
        'minecraft:stone',
        null,
      ],
    })
    expect(r).toMatchObject({ items: ['a:item'], tags: ['a:tag'] })
  })

  it('材料がなければ空', () => {
    expect(readProcessingRecipe('a:4', { type: 'create:cutting' })).toMatchObject({ items: [], tags: [] })
  })

  it('処理時間：書いていなければ 0、0 や負の数は 0、小数は切り捨て、数でなければ 0', () => {
    const duration = (processingTime: unknown): number | undefined =>
      readProcessingRecipe('a:t', { type: 'create:milling', processingTime })?.duration
    expect(readProcessingRecipe('a:t', { type: 'create:milling' })?.duration).toBe(0)
    expect(duration(0)).toBe(0)
    expect(duration(-5)).toBe(0)
    expect(duration(150)).toBe(150)
    expect(duration(99.7)).toBe(99)
    expect(duration('100')).toBe(0)
    expect(duration(Number.POSITIVE_INFINITY)).toBe(0)
    expect(duration(Number.NaN)).toBe(0)
  })
})

describe('RECIPE_PATH', () => {
  it('data/<namespace>/recipes/ と 1.21 の recipe/ の下の .json に合い、namespace と下のパスを取り出す', () => {
    const id = (path: string): string | null => {
      const m = RECIPE_PATH.exec(path)
      return m ? `${m[1]}:${m[2]}` : null
    }
    expect(id('data/create/recipes/milling/wheat.json')).toBe('create:milling/wheat')
    expect(id('data/create/recipe/crushing/ores/iron.json')).toBe('create:crushing/ores/iron')
    expect(id('data/create/recipes/x.txt')).toBeNull()
    expect(id('data/create/tags/items/x.json')).toBeNull()
    expect(id('data/create/recipes_extra/x.json')).toBeNull()
    expect(id('assets/create/recipes/x.json')).toBeNull()
    expect(id('kubejs/data/create/recipes/x.json')).toBeNull()
  })
})

describe('mergeRecipes', () => {
  const recipe = (id: string, duration: number): ProcessingRecipe => ({ id, type: 'milling', items: [], tags: [], duration })

  it('同じ ID なら後のものを使う。違う ID はすべて残す', () => {
    const merged = mergeRecipes([recipe('a:1', 10), recipe('a:2', 20)], [recipe('a:1', 99)], [recipe('a:3', 30)])
    expect(merged).toHaveLength(3)
    expect(merged.find((r) => r.id === 'a:1')?.duration).toBe(99)
    expect(merged.map((r) => r.id).sort()).toEqual(['a:1', 'a:2', 'a:3'])
  })

  it('何もなければ空', () => {
    expect(mergeRecipes()).toEqual([])
    expect(mergeRecipes([], [])).toEqual([])
  })
})

describe('readProcessingRecipe（1.21 の形）', () => {
  it('processing_time を処理時間として読み、量のある液体の材料は見ない', () => {
    const r = readProcessingRecipe('create:mixing/chocolate', {
      type: 'create:mixing',
      ingredients: [{ item: 'minecraft:sugar' }, { type: 'neoforge:tag', amount: 250, tag: 'c:milk' }],
      processing_time: 120,
    })
    expect(r).toMatchObject({ items: ['minecraft:sugar'], tags: [], duration: 120 })
  })
})
