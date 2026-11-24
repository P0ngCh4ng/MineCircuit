import { describe, expect, it } from 'vitest'
import { CREATE_RECIPE_TYPES } from './createRecipes'
import { mayBeKnownRecipe, mergeRecipes, RECIPE_PATH, RECIPE_TYPE_IDS, readRecipe, type ProcessingRecipe } from './index'

describe('readRecipe', () => {
  it('[TP-RECIPE-TYPES] 石臼・粉砕・ソー・ミキサー・プレス・圧縮・洗う・憑依のレシピを読む。種類は種類の ID', () => {
    for (const type of CREATE_RECIPE_TYPES) {
      if (type === 'mechanical_crafting') continue
      const r = readRecipe(`create:${type}/x`, { type: `create:${type}`, ingredients: [{ item: 'minecraft:wheat' }] })
      const fluids = type === 'filling' ? { fluids: [], fluidTags: [] } : {}
      expect(r).toEqual({ id: `create:${type}/x`, type: `create:${type}`, items: ['minecraft:wheat'], tags: [], duration: 0, results: [], ...fluids })
    }
    expect(RECIPE_TYPE_IDS).toEqual([
      'minecraft:smelting',
      'minecraft:blasting',
      'minecraft:smoking',
      'minecraft:crafting_shaped',
      'minecraft:crafting_shapeless',
      'create:milling',
      'create:crushing',
      'create:cutting',
      'create:mixing',
      'create:pressing',
      'create:compacting',
      'create:splashing',
      'create:haunting',
      'create:filling',
      'create:emptying',
      'create:mechanical_crafting',
    ])
  })

  it('中身を読む前の絞り込みは、表にある種類の ID だけを通す', () => {
    expect(mayBeKnownRecipe('{"type":"create:milling"}')).toBe(true)
    expect(mayBeKnownRecipe('{ "type" : "minecraft:smelting" }')).toBe(true)
    expect(mayBeKnownRecipe('{"type":"create:deploying"}')).toBe(false)
    expect(mayBeKnownRecipe('{"type":"minecraft:campfire_cooking"}')).toBe(false)
    expect(mayBeKnownRecipe('{"type":"other:milling"}')).toBe(false)
  })

  it('[TP-RECIPE-CRAFTING] 作業台・メカニカルクラフターのレシピ（#235）：パターンとキー、形のない材料、左右の入れ替え', () => {
    // 1.18 の形のあるレシピ（材料の配列はそのどれか）
    expect(
      readRecipe('minecraft:torch', {
        type: 'minecraft:crafting_shaped',
        pattern: ['X', '#'],
        key: { '#': { item: 'minecraft:stick' }, X: [{ item: 'minecraft:coal' }, { item: 'minecraft:charcoal' }] },
        result: { item: 'minecraft:torch', count: 4 },
      }),
    ).toEqual({
      id: 'minecraft:torch',
      type: 'minecraft:crafting_shaped',
      items: ['minecraft:coal', 'minecraft:charcoal', 'minecraft:stick'],
      tags: [],
      duration: 0,
      results: [{ item: 'minecraft:torch', count: 4, chance: 1 }],
      grid: {
        rows: [[{ items: ['minecraft:coal', 'minecraft:charcoal'], tags: [] }], [{ items: ['minecraft:stick'], tags: [] }]],
        ingredients: [],
        mirrored: true,
      },
    })
    // 1.21 の形のないレシピ（文字列の材料、{ id, count } のできる物）
    expect(
      readRecipe('minecraft:bone_meal', {
        type: 'minecraft:crafting_shapeless',
        ingredients: ['minecraft:bone', '#c:dyes/white'],
        result: { id: 'minecraft:bone_meal', count: 3 },
      }),
    ).toMatchObject({
      tags: ['c:dyes/white'],
      results: [{ item: 'minecraft:bone_meal', count: 3 }],
      grid: { rows: null, ingredients: [{ items: ['minecraft:bone'], tags: [] }, { items: [], tags: ['c:dyes/white'] }], mirrored: true },
    })
    // メカニカルクラフター：空きのマス、左右の入れ替え（6.0 は accept_mirrored、1.18 は acceptMirrored）
    const mech = (mirror: Record<string, unknown>) =>
      readRecipe('create:mechanical_crafting/x', {
        type: 'create:mechanical_crafting',
        pattern: ['A ', 'AA'],
        key: { A: { tag: 'c:plates/iron' } },
        result: { item: 'create:x' },
        ...mirror,
      })?.grid
    expect(mech({ accept_mirrored: false })).toEqual({
      rows: [
        [{ items: [], tags: ['c:plates/iron'] }, null],
        [{ items: [], tags: ['c:plates/iron'] }, { items: [], tags: ['c:plates/iron'] }],
      ],
      ingredients: [],
      mirrored: false,
    })
    expect(mech({ acceptMirrored: false })?.mirrored).toBe(false)
    expect(mech({})?.mirrored).toBe(true)
    // 並びの読めないレシピは読まない
    for (const bad of [
      { type: 'minecraft:crafting_shaped', pattern: ['A'], key: { A: { item: 'x:a' } } },
      { type: 'minecraft:crafting_shaped', pattern: ['B'], key: { A: { item: 'x:a' } }, result: { item: 'x:b' } },
      { type: 'minecraft:crafting_shaped', pattern: 'A', key: {}, result: { item: 'x:b' } },
      { type: 'minecraft:crafting_shaped', pattern: [], key: {}, result: { item: 'x:b' } },
      { type: 'minecraft:crafting_shapeless', ingredients: [{ fluid: 'x' }], result: { item: 'x:b' } },
      { type: 'minecraft:crafting_shapeless', ingredients: 'x:a', result: { item: 'x:b' } },
      { type: 'minecraft:crafting_shapeless', ingredients: [], result: { item: 'x:b' } },
    ]) {
      expect(readRecipe('x:bad', bad)).toBeNull()
    }
  })

  it('[TP-RECIPE-INGREDIENTS] スパウトのレシピ（#235）は液体の材料を別に持つ。1.18 の fluid・fluidTag と 1.21 の neoforge:single・neoforge:tag', () => {
    expect(
      readRecipe('create:filling/honey_bottle', {
        type: 'create:filling',
        ingredients: [{ item: 'minecraft:glass_bottle' }, { fluidTag: 'forge:honey', amount: 250 }],
        results: [{ item: 'minecraft:honey_bottle' }],
      }),
    ).toMatchObject({ items: ['minecraft:glass_bottle'], tags: [], fluids: [], fluidTags: ['forge:honey'], results: [{ item: 'minecraft:honey_bottle' }] })
    expect(
      readRecipe('create:filling/grass_block', {
        type: 'create:filling',
        ingredients: [
          { item: 'minecraft:dirt' },
          { type: 'neoforge:single', amount: 500, fluid: 'minecraft:water' },
          { type: 'neoforge:tag', amount: 250, tag: 'c:tea' },
        ],
        results: [{ id: 'minecraft:grass_block' }],
      }),
    ).toMatchObject({ items: ['minecraft:dirt'], tags: [], fluids: ['minecraft:water'], fluidTags: ['c:tea'] })
    // 液体を抜くレシピは、できる物のうち液体を見ない
    expect(
      readRecipe('create:emptying/honey_bottle', {
        type: 'create:emptying',
        ingredients: [{ item: 'minecraft:honey_bottle' }],
        results: [{ item: 'minecraft:glass_bottle' }, { fluid: 'create:honey', amount: 250 }],
      }),
    ).toEqual({
      id: 'create:emptying/honey_bottle',
      type: 'create:emptying',
      items: ['minecraft:honey_bottle'],
      tags: [],
      duration: 0,
      results: [{ item: 'minecraft:glass_bottle', count: 1, chance: 1 }],
    })
  })

  it('[TP-RECIPE-TYPES] 料理のレシピ（#235）：材料は ingredient、できる物は result（1.18 は文字列、1.21 は { id, count }）。cookingtime は読まない', () => {
    expect(
      readRecipe('minecraft:copper_ingot_from_smelting_raw_copper', {
        type: 'minecraft:smelting',
        ingredient: { item: 'minecraft:raw_copper' },
        result: 'minecraft:copper_ingot',
        experience: 0.7,
        cookingtime: 200,
      }),
    ).toEqual({
      id: 'minecraft:copper_ingot_from_smelting_raw_copper',
      type: 'minecraft:smelting',
      items: ['minecraft:raw_copper'],
      tags: [],
      duration: 0,
      results: [{ item: 'minecraft:copper_ingot', count: 1, chance: 1 }],
    })
    const blasting = readRecipe('minecraft:b', {
      type: 'minecraft:blasting',
      ingredient: [{ tag: 'c:raw_materials/iron' }, { item: 'minecraft:iron_ore' }],
      result: { id: 'minecraft:iron_ingot', count: 2 },
    })
    expect(blasting).toMatchObject({ type: 'minecraft:blasting', items: ['minecraft:iron_ore'], tags: ['c:raw_materials/iron'] })
    expect(blasting?.results).toEqual([{ item: 'minecraft:iron_ingot', count: 2, chance: 1 }])
    // 1.21.2 からの文字列の材料と、{ item } の形のできる物
    const smoking = readRecipe('minecraft:s', { type: 'minecraft:smoking', ingredient: 'minecraft:beef', result: { item: 'minecraft:cooked_beef' } })
    expect(smoking).toMatchObject({ type: 'minecraft:smoking', items: ['minecraft:beef'], results: [{ item: 'minecraft:cooked_beef', count: 1, chance: 1 }] })
    // 焚き火の料理は扇風機で使わないので読まない
    expect(readRecipe('minecraft:c', { type: 'minecraft:campfire_cooking', ingredient: 'a:b', result: 'a:c' })).toBeNull()
  })

  it('[TP-RECIPE-TYPES] ほかの種類・type がない・オブジェクトでないものは null', () => {
    expect(readRecipe('create:d', { type: 'create:deploying', ingredients: [] })).toBeNull()
    expect(readRecipe('create:p', { type: 'create:pressing_extra', ingredients: [] })).toBeNull()
    expect(readRecipe('minecraft:s', { type: 'minecraft:crafting_shaped', key: {} })).toBeNull()
    expect(readRecipe('minecraft:s', { type: 'create:smelting', ingredients: [] })).toBeNull()
    expect(readRecipe('minecraft:s', { type: 'minecraft:milling', ingredients: [] })).toBeNull()
    expect(readRecipe('x:milling', { type: 'other:milling' })).toBeNull()
    expect(readRecipe('x:y', { ingredients: [] })).toBeNull()
    expect(readRecipe('x:y', { type: 1 })).toBeNull()
    expect(readRecipe('x:y', null)).toBeNull()
    expect(readRecipe('x:y', [{ type: 'create:milling' }])).toBeNull()
    expect(readRecipe('x:y', 'create:milling')).toBeNull()
  })

  it('[TP-RECIPE-INGREDIENTS] 材料は1つのオブジェクトでも、配列でも、入れ子の配列でも読む。同じものは1つにまとめる', () => {
    expect(readRecipe('a:1', { type: 'create:milling', ingredients: { item: 'minecraft:wheat' } })?.items).toEqual([
      'minecraft:wheat',
    ])
    const r = readRecipe('a:2', {
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

  it('[TP-RECIPE-INGREDIENTS] item と tag を両方持つ材料は両方を集める。液体と、文字列でない値は見ない', () => {
    const r = readRecipe('a:3', {
      type: 'create:mixing',
      ingredients: [
        { item: 'a:item', tag: 'a:tag' },
        { fluid: 'minecraft:water', amount: 250 },
        { fluidTag: 'forge:milk', amount: 250 },
        { item: 5, tag: null },
        null,
      ],
    })
    expect(r).toMatchObject({ items: ['a:item'], tags: ['a:tag'] })
  })

  it('[TP-RECIPE-INGREDIENTS] NeoForge のいずれかの材料（neoforge:compound）の中を読む。Create 6.0 の Mod 連携のレシピの形（#139）', () => {
    const r = readRecipe('create:milling/compat/ae2/fluix_crystal', {
      'neoforge:conditions': [{ type: 'neoforge:mod_loaded', modid: 'ae2' }],
      type: 'create:milling',
      ingredients: [{ type: 'neoforge:compound', ingredients: [{ item: 'ae2:fluix_crystal' }, { tag: 'c:gems/fluix' }] }],
      processing_time: 200,
      results: [{ id: 'ae2:fluix_dust' }],
    })
    expect(r).toMatchObject({ items: ['ae2:fluix_crystal'], tags: ['c:gems/fluix'], duration: 200 })
  })

  it('[TP-RECIPE-INGREDIENTS] 文字列の材料（1.21.2 からの形）は、# で始まればタグ、そうでなければアイテム', () => {
    const r = readRecipe('a:5', { type: 'create:milling', ingredients: ['minecraft:wheat', '#c:crops/wheat', 'oops'] })
    expect(r).toMatchObject({ items: ['minecraft:wheat'], tags: ['c:crops/wheat'] })
  })

  it('材料がなければ空', () => {
    expect(readRecipe('a:4', { type: 'create:cutting' })).toMatchObject({ items: [], tags: [] })
  })

  it('[TP-RECIPE-TIME-FIELD] 処理時間：書いていなければ 0、0 や負の数は 0、小数は切り捨て、数でなければ 0', () => {
    const duration = (processingTime: unknown): number | undefined =>
      readRecipe('a:t', { type: 'create:milling', processingTime })?.duration
    expect(readRecipe('a:t', { type: 'create:milling' })?.duration).toBe(0)
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
  it('[TP-RECIPE-SOURCES] data/<namespace>/recipes/ と 1.21 の recipe/ の下の .json に合い、namespace と下のパスを取り出す', () => {
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
  const recipe = (id: string, duration: number): ProcessingRecipe => ({
    id,
    type: 'create:milling',
    items: [],
    tags: [],
    duration,
    results: [],
  })

  it('[TP-RECIPE-SOURCES] 同じ ID なら後のものを使う。違う ID はすべて残す', () => {
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

describe('readRecipe（1.21 の形）', () => {
  it('[TP-RECIPE-TIME-FIELD] processing_time を処理時間として読み、量のある液体の材料は見ない', () => {
    const r = readRecipe('create:mixing/chocolate', {
      type: 'create:mixing',
      ingredients: [{ item: 'minecraft:sugar' }, { type: 'neoforge:tag', amount: 250, tag: 'c:milk' }],
      processing_time: 120,
    })
    expect(r).toMatchObject({ items: ['minecraft:sugar'], tags: [], duration: 120 })
  })
})

describe('readRecipe（できる物）', () => {
  it('1.18 の形（item・count・chance）を読む。count は書いていなければ 1、chance は 1', () => {
    // Create（Fabric 版、1.18）の milling/wheat.json と同じ形
    const r = readRecipe('create:milling/wheat', {
      type: 'create:milling',
      ingredients: [{ item: 'minecraft:wheat' }],
      results: [
        { item: 'create:wheat_flour' },
        { item: 'create:wheat_flour', count: 2, chance: 0.25 },
        { item: 'minecraft:wheat_seeds', chance: 0.25 },
      ],
      processingTime: 150,
    })
    expect(r?.results).toEqual([
      { item: 'create:wheat_flour', count: 1, chance: 1 },
      { item: 'create:wheat_flour', count: 2, chance: 0.25 },
      { item: 'minecraft:wheat_seeds', count: 1, chance: 0.25 },
    ])
  })

  it('1.21（Create 6.0）の形（id・count・chance）を読む。確率つきの結果がいくつあってもすべて残す', () => {
    // Create 6.0 の crushing/iron_ore.json と同じ形
    const r = readRecipe('create:crushing/iron_ore', {
      type: 'create:crushing',
      ingredients: [{ item: 'minecraft:iron_ore' }],
      processing_time: 250,
      results: [
        { id: 'create:crushed_raw_iron' },
        { chance: 0.75, id: 'create:crushed_raw_iron' },
        { chance: 0.75, id: 'create:experience_nugget' },
        { chance: 0.125, id: 'minecraft:cobblestone' },
      ],
    })
    expect(r).toMatchObject({ duration: 250 })
    expect(r?.results).toEqual([
      { item: 'create:crushed_raw_iron', count: 1, chance: 1 },
      { item: 'create:crushed_raw_iron', count: 1, chance: 0.75 },
      { item: 'create:experience_nugget', count: 1, chance: 0.75 },
      { item: 'minecraft:cobblestone', count: 1, chance: 0.125 },
    ])
  })

  it('プレス・圧縮のレシピは処理時間がなければ 0 で、できる物を読む', () => {
    const pressing = readRecipe('create:pressing/iron_ingot', {
      type: 'create:pressing',
      ingredients: [{ tag: 'c:ingots/iron' }],
      results: [{ id: 'create:iron_sheet' }],
    })
    expect(pressing).toEqual({
      id: 'create:pressing/iron_ingot',
      type: 'create:pressing',
      items: [],
      tags: ['c:ingots/iron'],
      duration: 0,
      results: [{ item: 'create:iron_sheet', count: 1, chance: 1 }],
    })
    const compacting = readRecipe('create:compacting/blaze_cake', {
      type: 'create:compacting',
      ingredients: [{ tag: 'c:eggs' }, { item: 'minecraft:sugar' }, { item: 'create:cinder_flour' }],
      results: [{ id: 'create:blaze_cake_base' }],
    })
    expect(compacting).toMatchObject({
      type: 'create:compacting',
      duration: 0,
      results: [{ item: 'create:blaze_cake_base', count: 1, chance: 1 }],
    })
  })

  it('液体の結果（1.18 の fluid・amount、1.21 の id・amount）は入れない', () => {
    const r118 = readRecipe('create:mixing/a', {
      type: 'create:mixing',
      results: [{ fluid: 'create:chocolate', amount: 81000 }, { item: 'minecraft:bowl' }],
    })
    expect(r118?.results).toEqual([{ item: 'minecraft:bowl', count: 1, chance: 1 }])
    const r121 = readRecipe('create:mixing/chocolate', {
      type: 'create:mixing',
      results: [{ amount: 250, id: 'create:chocolate' }],
    })
    expect(r121?.results).toEqual([])
  })

  it('results がない・配列でない・ID が文字列でない結果は空か読み飛ばす。おかしな count と chance は既定の値にする', () => {
    expect(readRecipe('a:1', { type: 'create:milling' })?.results).toEqual([])
    expect(readRecipe('a:2', { type: 'create:milling', results: { item: 'a:b' } })?.results).toEqual([])
    const r = readRecipe('a:3', {
      type: 'create:milling',
      results: [
        null,
        'a:b',
        { item: 5 },
        { count: 2 },
        { item: 'a:count0', count: 0 },
        { item: 'a:frac', count: 2.7 },
        { item: 'a:strcount', count: '3', chance: '0.5' },
        { item: 'a:neg', chance: -0.5 },
        { item: 'a:over', chance: 1.5 },
        { item: 'a:zero', chance: 0 },
      ],
    })
    expect(r?.results).toEqual([
      { item: 'a:count0', count: 1, chance: 1 },
      { item: 'a:frac', count: 2, chance: 1 },
      { item: 'a:strcount', count: 1, chance: 1 },
      { item: 'a:neg', count: 1, chance: 1 },
      { item: 'a:over', count: 1, chance: 1 },
      { item: 'a:zero', count: 1, chance: 0 },
    ])
  })
})
