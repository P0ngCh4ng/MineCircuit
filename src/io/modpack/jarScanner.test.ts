import { describe, expect, it } from 'vitest'
import { strToU8 } from 'fflate'
import { fakeJar } from '../../../tests/fixtures/fakeJar'
import { isWantedJarEntry, parseLenientJson, pickNames, scanJar } from './jarScanner'

describe('scanJar', () => {
  it('Forge の Mod の情報・表示名・ブロック状態の定義を読む', () => {
    const bytes = fakeJar({
      forgeMods: [{ modId: 'testmod', displayName: 'Test Mod', version: '${file.jarVersion}' }],
      manifestVersion: '1.2.3',
      lang: {
        testmod: {
          ja_jp: { 'block.testmod.gear': 'テスト歯車', 'item.testmod.wrench': 'テストレンチ' },
          en_us: { 'block.testmod.gear': 'Test Gear' },
        },
      },
      blockStates: { 'testmod:gear': { variants: { 'axis=x': { model: 'testmod:block/gear' } } } },
    })
    const s = scanJar('testmod-1.2.3.jar', bytes)
    expect(s.mods).toEqual([{ modId: 'testmod', name: 'Test Mod', version: '1.2.3', jar: 'testmod-1.2.3.jar' }])
    expect(s.namespaces).toEqual(['testmod'])
    expect(s.lang.ja_jp).toEqual({ 'block.testmod.gear': 'テスト歯車', 'item.testmod.wrench': 'テストレンチ' })
    expect(s.lang.en_us).toEqual({ 'block.testmod.gear': 'Test Gear' })
    expect(s.blockStates['testmod:gear']).toEqual({ variants: { 'axis=x': { model: 'testmod:block/gear' } } })
    expect(s.problems).toEqual([])
  })

  it('NeoForge と Fabric の Mod の情報を読む', () => {
    const neo = scanJar('neo.jar', fakeJar({ neoforgeMods: [{ modId: 'neomod', version: '2.0' }] }))
    expect(neo.mods).toEqual([{ modId: 'neomod', name: 'neomod', version: '2.0', jar: 'neo.jar' }])
    const fabric = scanJar('fab.jar', fakeJar({ fabricMod: { modId: 'fabmod', displayName: 'Fab', version: '0.1' } }))
    expect(fabric.mods).toEqual([{ modId: 'fabmod', name: 'Fab', version: '0.1', jar: 'fab.jar' }])
  })

  it('namespace は assets/ の下のフォルダ名で決まり、modId と違ってよい', () => {
    const s = scanJar('a.jar', fakeJar({
      forgeMods: [{ modId: 'mod_id' }],
      files: { 'assets/other_ns/textures/block/x.png': new Uint8Array([1]), 'data/data_only/x.json': '{}' },
    }))
    expect(s.namespaces).toEqual(['other_ns'])
  })

  it('名前以外の翻訳（説明文など）は捨てる', () => {
    expect(
      pickNames({
        'block.testmod.gear': '歯車',
        'block.testmod.gear.tooltip': '説明',
        'testmod.ponder.text': '文',
        'item.testmod.x': 1,
      }),
    ).toEqual({ 'block.testmod.gear': '歯車' })
  })

  it('壊れた JSON は problems に書いて、ほかは読む', () => {
    const s = scanJar('b.jar', fakeJar({
      files: { 'assets/t/lang/ja_jp.json': '{ broken', 'assets/t/lang/en_us.json': '﻿{"block.t.a":"A"}' },
    }))
    expect(s.lang.en_us).toEqual({ 'block.t.a': 'A' })
    expect(s.problems).toEqual(['assets/t/lang/ja_jp.json: JSON として読めません'])
  })

  it('文字列の中の改行や、閉じかっこの前の余分な , がある JSON も読む', () => {
    expect(parseLenientJson('{"a": "1行目\r\n2行目",\n "b": ["x",],\n}')).toEqual({ a: '1行目\r\n2行目', b: ['x'] })
    expect(parseLenientJson('{"a": "x, }"}')).toEqual({ a: 'x, }' })
    expect(() => parseLenientJson('{ broken')).toThrow()
  })

  it('jar の中の jar も読み、外の jar の表示名を優先する', () => {
    const inner = fakeJar({
      forgeMods: [{ modId: 'inner', version: '1' }],
      lang: { inner: { en_us: { 'block.inner.x': 'Inner X' } }, outer: { en_us: { 'block.outer.y': 'from inner' } } },
    })
    const outer = fakeJar({
      forgeMods: [{ modId: 'outer', version: '1' }],
      lang: { outer: { en_us: { 'block.outer.y': 'Outer Y' } } },
      nestedJars: { 'inner-1.jar': inner },
    })
    const s = scanJar('outer.jar', outer)
    expect(s.mods.map((m) => m.modId)).toEqual(['outer', 'inner'])
    expect(s.mods[1].jar).toBe('outer.jar!/META-INF/jarjar/inner-1.jar')
    expect(s.namespaces).toEqual(['inner', 'outer'])
    expect(s.lang.en_us).toEqual({ 'block.inner.x': 'Inner X', 'block.outer.y': 'Outer Y' })
  })

  it('zip でなければエラーを投げる', () => {
    expect(() => scanJar('bad.jar', strToU8('not a zip'))).toThrow()
  })
})

describe('scanJar のレシピ', () => {
  const milling = (item: string, processingTime?: number): string =>
    JSON.stringify({ type: 'create:milling', ingredients: [{ item }], results: [{ item: 'x:y' }], processingTime })

  it('data/<namespace>/recipes/ と 1.21 の recipe/ の Create の処理のレシピを読む。ほかのレシピは捨てる', () => {
    const s = scanJar('create.jar', fakeJar({
      files: {
        'data/create/recipes/milling/wheat.json': milling('minecraft:wheat', 150),
        'data/create/recipe/crushing/ore.json': JSON.stringify({
          type: 'create:crushing',
          ingredients: [{ tag: 'c:ores/iron' }],
          processingTime: 250,
        }),
        'data/create/recipes/mechanical_crafting/iron.json': JSON.stringify({ type: 'create:mechanical_crafting', key: {} }),
        'data/minecraft/recipes/bread.json': JSON.stringify({ type: 'minecraft:crafting_shaped', key: {} }),
        'data/create/tags/items/x.json': JSON.stringify({ type: 'create:milling' }),
      },
    }))
    expect(s.recipes).toMatchObject([
      { id: 'create:crushing/ore', type: 'crushing', items: [], tags: ['c:ores/iron'], duration: 250 },
      { id: 'create:milling/wheat', type: 'milling', items: ['minecraft:wheat'], tags: [], duration: 150 },
    ])
    expect(s.problems).toEqual([])
  })

  it('壊れたレシピの JSON は使わず、problems にも書かない', () => {
    const s = scanJar('a.jar', fakeJar({
      files: {
        'data/create/recipes/milling/broken.json': '{ "type": "create:milling", broken',
        'data/other/recipes/broken.json': '{ broken',
        'data/create/recipes/milling/ok.json': milling('a:b'),
      },
    }))
    expect(s.recipes.map((r) => r.id)).toEqual(['create:milling/ok'])
    expect(s.problems).toEqual([])
  })

  it('jar の中の jar のレシピも読み、同じ ID なら外の jar のものを使う', () => {
    const inner = fakeJar({
      files: {
        'data/create/recipes/milling/wheat.json': milling('inner:wheat', 10),
        'data/inner/recipes/milling/only_inner.json': milling('inner:x', 20),
      },
    })
    const s = scanJar('outer.jar', fakeJar({
      files: { 'data/create/recipes/milling/wheat.json': milling('outer:wheat', 99) },
      nestedJars: { 'inner-1.jar': inner },
    }))
    expect([...s.recipes].sort((a, b) => a.id.localeCompare(b.id))).toMatchObject([
      { id: 'create:milling/wheat', type: 'milling', items: ['outer:wheat'], tags: [], duration: 99 },
      { id: 'inner:milling/only_inner', type: 'milling', items: ['inner:x'], tags: [], duration: 20 },
    ])
  })

  it('data/<namespace>/tags/items/ と 1.21 の tags/item/ のアイテムのタグを読む。ブロックのタグと壊れたタグは捨てる', () => {
    const s = scanJar('tags.jar', fakeJar({
      files: {
        'data/forge/tags/items/ores/iron.json': JSON.stringify({ values: ['create:raw_zinc', { id: 'create:zinc_ore', required: false }] }),
        'data/c/tags/item/ingots.json': JSON.stringify({ replace: true, values: ['#c:ingots/zinc', 'stick'] }),
        'data/forge/tags/blocks/ores.json': JSON.stringify({ values: ['a:b'] }),
        'data/forge/tags/items/broken.json': '{ broken',
      },
    }))
    expect(s.itemTags).toEqual({
      'forge:ores/iron': { replace: false, values: ['create:raw_zinc', 'create:zinc_ore'] },
      'c:ingots': { replace: true, values: ['#c:ingots/zinc', 'minecraft:stick'] },
    })
    expect(s.problems).toEqual([])
  })

  it('jar の中の jar のアイテムのタグは、外の jar のタグのあとに足す', () => {
    const inner = fakeJar({
      files: {
        'data/forge/tags/items/ores.json': JSON.stringify({ values: ['inner:ore'] }),
        'data/inner/tags/items/only.json': JSON.stringify({ values: ['inner:x'] }),
      },
    })
    const s = scanJar('outer.jar', fakeJar({
      files: { 'data/forge/tags/items/ores.json': JSON.stringify({ values: ['outer:ore'] }) },
      nestedJars: { 'inner-1.jar': inner },
    }))
    expect(s.itemTags).toEqual({
      'forge:ores': { replace: false, values: ['outer:ore', 'inner:ore'] },
      'inner:only': { replace: false, values: ['inner:x'] },
    })
  })

  it('isWantedJarEntry はレシピの JSON を取り出し、ほかの data/ は取り出さない', () => {
    expect(isWantedJarEntry('data/create/recipes/milling/wheat.json')).toBe(true)
    expect(isWantedJarEntry('data/create/recipe/milling/wheat.json')).toBe(true)
    expect(isWantedJarEntry('data/create/tags/items/x.json')).toBe(true)
    expect(isWantedJarEntry('data/create/tags/item/x.json')).toBe(true)
    expect(isWantedJarEntry('data/create/tags/blocks/x.json')).toBe(false)
    expect(isWantedJarEntry('data/create/loot_tables/x.json')).toBe(false)
    expect(isWantedJarEntry('data/create/recipes/x.nbt')).toBe(false)
  })
})
