import { describe, expect, it } from 'vitest'
import type { ProcessingRecipe } from '../recipes'
import { runKubeJsScripts } from './runScripts'
import type { ScriptRunInput } from './scriptTypes'

const wheat: ProcessingRecipe = {
  id: 'create:milling/wheat',
  type: 'milling',
  items: ['minecraft:wheat'],
  tags: [],
  duration: 150,
  results: [{ item: 'create:wheat_flour', count: 1, chance: 1 }],
}
const ironOre: ProcessingRecipe = {
  id: 'create:crushing/iron_ore',
  type: 'crushing',
  items: [],
  tags: ['c:ores/iron'],
  duration: 250,
  results: [{ item: 'create:crushed_raw_iron', count: 1, chance: 1 }],
}

function run(scripts: Record<string, string>, over: Partial<ScriptRunInput> = {}) {
  return runKubeJsScripts({
    files: Object.entries(scripts).map(([path, text]) => ({ path, text })),
    recipes: [wheat, ironOre],
    itemTags: { 'c:ores/iron': { replace: false, values: ['minecraft:iron_ore'] } },
    modIds: ['create', 'minecraft'],
    ...over,
  })
}

const byId = (out: ReturnType<typeof run>, id: string) => out.recipes.find((r) => r.id === id)

describe('runKubeJsScripts（1.18 の書き方）', () => {
  it('onEvent の recipes で createMilling を足し、配列と forEach で並べたものも集める', () => {
    const out = run({
      'recipes/milling.js': `
        (function () {
          onEvent('recipes', (event) => {
            const list = [
              { input: 'minecraft:rooted_dirt', output: 'minecraft:dirt', chance: 1 },
              { input: 'farmersdelight:straw', output: 'minecraft:string', chance: 0.5 },
            ]
            list.forEach((r) => {
              event.recipes.createMilling([Item.of(r.output).withChance(r.chance)], r.input).processingTime(70)
            })
          })
        })()
      `,
    })
    expect(out.summary).toMatchObject({ files: 1, added: 2, removed: 0, replaced: 0, errors: [], failed: null })
    expect(byId(out, 'kubejs:script/recipes/milling/1')).toEqual({
      id: 'kubejs:script/recipes/milling/1',
      type: 'milling',
      items: ['minecraft:rooted_dirt'],
      tags: [],
      duration: 70,
      results: [{ item: 'minecraft:dirt', count: 1, chance: 1 }],
    })
    expect(byId(out, 'kubejs:script/recipes/milling/2')?.results).toEqual([{ item: 'minecraft:string', count: 1, chance: 0.5 }])
  })

  it('remove・replaceInput（2つの引数の古い書き方も）を当てはめる', () => {
    const out = run({
      'a.js': `
        onEvent('recipes', event => {
          event.remove({ type: 'create:milling', output: 'create:wheat_flour' })
          event.replaceInput('#c:ores/iron', 'minecraft:deepslate_iron_ore')
        })
      `,
    })
    expect(byId(out, 'create:milling/wheat')).toBeUndefined()
    expect(byId(out, 'create:crushing/iron_ore')).toMatchObject({ items: ['minecraft:deepslate_iron_ore'], tags: [] })
    expect(out.summary).toMatchObject({ removed: 1, replaced: 1 })
  })

  it('item.tags のイベントでタグを変え、レシピの条件でもそのタグを使う', () => {
    const out = run({
      'tags.js': `onEvent('item.tags', e => { e.add('c:ores/iron', ['minecraft:raw_iron_block', '#c:ores/deep']); e.remove('c:ores/iron', 'minecraft:iron_ore') })`,
      'z.js': `onEvent('recipes', e => { e.remove({ input: 'minecraft:raw_iron_block' }) })`,
    })
    expect(out.itemTags['c:ores/iron'].values).toEqual(['minecraft:raw_iron_block', '#c:ores/deep'])
    expect(byId(out, 'create:crushing/iron_ore')).toBeUndefined()
  })
})

describe('runKubeJsScripts（1.19 からの書き方）', () => {
  it('ServerEvents.recipes で create.milling・custom を足し、id で ID を決める', () => {
    const out = run({
      'kubejs.js': `
        ServerEvents.recipes(event => {
          event.recipes.create.crushing(['2x minecraft:gravel', CreateItem.of('minecraft:flint', 0.25)], '#c:cobblestones').id('pack:gravel')
          event.custom({ type: 'create:mixing', ingredients: [{ item: 'minecraft:sand' }], results: [{ id: 'minecraft:clay' }], processing_time: 40 })
          event.custom({ type: 'minecraft:crafting_shaped', pattern: ['A'] })
          event.shaped('minecraft:stick', ['A'], { A: 'minecraft:oak_planks' })
        })
        ServerEvents.tags('item', e => e.add('c:cobblestones', 'minecraft:cobblestone'))
        ServerEvents.tags('block', e => e.add('c:x', 'minecraft:stone'))
      `,
    })
    expect(byId(out, 'pack:gravel')).toEqual({
      id: 'pack:gravel',
      type: 'crushing',
      items: [],
      tags: ['c:cobblestones'],
      // processingTime を呼ばなければ、kubejs-create と同じく 100
      duration: 100,
      results: [
        { item: 'minecraft:gravel', count: 2, chance: 1 },
        { item: 'minecraft:flint', count: 1, chance: 0.25 },
      ],
    })
    expect(out.recipes.find((r) => r.type === 'mixing')).toMatchObject({ items: ['minecraft:sand'], duration: 40 })
    expect(out.itemTags['c:cobblestones'].values).toEqual(['minecraft:cobblestone'])
    expect(out.itemTags['c:x']).toBeUndefined()
    expect(out.summary).toMatchObject({ added: 2, unsupported: [], errors: [] })
  })

  it('priority の大きいファイルの定数を、後のファイルから使える（大域は1つ）', () => {
    const out = run({
      'constants.js': `const mB = 81`,
      'mix.js': `ServerEvents.recipes(e => { e.recipes.create.mixing('minecraft:clay', 'minecraft:sand').processingTime(mB) })`,
    })
    expect(out.recipes.find((r) => r.type === 'mixing')?.duration).toBe(81)
  })

  it('Platform.isLoaded は Modpack の Mod の一覧で答える', () => {
    const out = run({
      'a.js': `ServerEvents.recipes(e => { if (Platform.isLoaded('mekanism')) e.remove('*'); if (Platform.isLoaded('create')) e.remove({ id: 'create:milling/wheat' }) })`,
    })
    expect(out.recipes.map((r) => r.id)).toEqual(['create:crushing/iron_ore'])
  })
})

describe('runKubeJsScripts（うまく動かないとき）', () => {
  it('知らない呼び出しは数えて何もしない。エラーのファイルは残りを飛ばし、次のファイルは動く', () => {
    const out = run({
      'a.js': `ServerEvents.recipes(e => { const C = Java.loadClass('net.minecraft.Foo'); C.bar(); e.server.runCommandSilent('x'); e.remove({ output: 'create:wheat_flour', weird: 1 }) })`,
      'b.js': `fetch('x'); onEvent('recipes', e => e.remove('create:milling/wheat'))`,
      'c.js': `onEvent('recipes', e => { throw new Error('壊れた') })`,
      'd.js': `onEvent('recipes', e => e.remove({ id: 'create:crushing/iron_ore' }))`,
    })
    expect(out.summary.unsupported.map((u) => u.name)).toEqual(
      expect.arrayContaining(['Java.loadClass', 'レシピのイベントの server', 'レシピの条件 weird']),
    )
    expect(out.summary.errors).toEqual([
      { path: 'b.js', message: 'fetch is not defined' },
      { path: 'c.js', message: '壊れた' },
    ])
    // b.js は登録の前に止まったので、小麦のレシピは残る。d.js は動く
    expect(out.recipes.map((r) => r.id)).toEqual(['create:milling/wheat'])
  })

  it('知らない大域・Java のクラス・物の知らない項目は、何もしない値にして続ける', () => {
    const out = run({
      'a.js': `
        const $TreeMap = Java.loadClass('java.util.TreeMap')
        const m = new $TreeMap()
        NativeEvents.onEvent('x', () => {})
        settings.logAddedRecipes = true
        onEvent('recipes', e => {
          e.recipes.createMilling(Item.of('minecraft:dirt').ignoreNBT(), Ingredient.of('#c:ores/iron').or('minecraft:stone')).processingTime(5)
          if (!Ingredient.of(/abc.*/).test('minecraft:stone')) e.remove({ id: 'create:milling/wheat' })
        })
      `,
    })
    expect(out.summary.errors).toEqual([])
    expect(out.recipes.map((r) => r.id)).toEqual(['create:crushing/iron_ore', 'kubejs:script/a/1'])
    expect(out.recipes[1]).toMatchObject({ tags: ['c:ores/iron'], duration: 5, results: [{ item: 'minecraft:dirt', count: 1, chance: 1 }] })
    expect(out.summary.unsupported.map((u) => u.name)).toEqual(
      expect.arrayContaining(['Java.loadClass', '大域の NativeEvents', 'Ingredient.of(/正規表現/)']),
    )
  })

  it('構文の誤りのファイルもエラーにして続ける', () => {
    const out = run({ 'a.js': 'onEvent(', 'b.js': `onEvent('recipes', e => e.remove('*'))` })
    expect(out.summary.errors.map((e) => e.path)).toEqual(['a.js'])
    expect(out.recipes).toEqual([])
  })
})

describe('runKubeJsScripts（安全）', () => {
  // スクリプトから見えたものを、作り物の KubeJS の global に書いてもらい、外から読む
  function probe(code: string): Record<string, unknown> {
    const seen: Record<string, unknown> = {}
    const out = run({
      'probe.js': `
        const seen = {}
        const t = (name, f) => { try { seen[name] = f() } catch (e) { seen[name] = 'throws' } }
        ${code}
        onEvent('recipes', e => { Object.keys(seen).forEach(k => e.recipes.createMilling(k + '=' + String(seen[k]), 'minecraft:stone')) })
      `,
    })
    for (const r of out.recipes) {
      const m = /^minecraft:(.+?)=(.*)$/.exec(r.results[0]?.item ?? '')
      if (m) seen[m[1]] = m[2]
    }
    expect(out.summary.errors).toEqual([])
    return seen
  }

  it('ホストの大域（fetch・process・eval・Function など）は見えない', () => {
    const seen = probe(`
      t('fetch', () => typeof fetch)
      t('xhr', () => typeof XMLHttpRequest)
      t('process', () => typeof process)
      t('eval', () => typeof eval)
      t('function', () => typeof Function)
      t('selffetch', () => typeof self.fetch)
      t('globalfetch', () => typeof globalThis.fetch)
      t('proto', () => Object.getOwnPropertyNames(Object.getPrototypeOf(globalThis)).length + ',' + String(Object.getPrototypeOf(Object.getPrototypeOf(globalThis))))
      t('settimeout', () => typeof setTimeout)
      t('importscripts', () => typeof importScripts)
      t('indexeddb', () => typeof indexedDB)
    `)
    expect(seen).toEqual({
      fetch: 'undefined',
      xhr: 'undefined',
      process: 'undefined',
      eval: 'undefined',
      function: 'undefined',
      selffetch: 'undefined',
      globalfetch: 'undefined',
      proto: '0,null',
      settimeout: 'undefined',
      importscripts: 'undefined',
      indexeddb: 'undefined',
    })
  })
})
