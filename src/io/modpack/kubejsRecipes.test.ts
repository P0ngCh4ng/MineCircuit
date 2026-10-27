import { describe, expect, it } from 'vitest'
import { strToU8 } from 'fflate'
import { MemoryFileSource } from '../memoryFileSource'
import { readKubeJsRecipes } from './kubejsRecipes'

const json = (v: unknown): Uint8Array => strToU8(JSON.stringify(v))

describe('readKubeJsRecipes', () => {
  it('kubejs/data/<namespace>/recipes/ の下（下のフォルダも）と recipe/ のレシピを読む。Create の処理以外は捨てる', async () => {
    const source = new MemoryFileSource([
      [
        'kubejs/data/createastral/recipes/milling/grain.json',
        json({ type: 'create:milling', ingredients: [{ item: 'minecraft:wheat' }], processingTime: 120 }),
      ],
      ['kubejs/data/pack/recipe/deep/a/b/cut.json', json({ type: 'create:cutting', ingredients: [{ tag: 'minecraft:logs' }] })],
      ['kubejs/data/createastral/recipes/smelt.json', json({ type: 'minecraft:smelting', ingredient: { item: 'a:b' } })],
      ['kubejs/data/createastral/tags/items/x.json', json({ type: 'create:milling' })],
      ['kubejs/data/createastral/recipes/notes.txt', strToU8('not json')],
      ['data/elsewhere/recipes/x.json', json({ type: 'create:milling' })],
    ])
    const result = await readKubeJsRecipes(source)
    expect(result.recipes).toMatchObject([
      { id: 'createastral:milling/grain', type: 'milling', items: ['minecraft:wheat'], tags: [], duration: 120 },
      { id: 'pack:deep/a/b/cut', type: 'cutting', items: [], tags: ['minecraft:logs'], duration: 0 },
    ])
    expect(result.problems).toEqual([])
    expect(result.scriptsChangeRecipes).toBe(false)
  })

  it('kubejs/data/<namespace>/tags/items/ と 1.21 の tags/item/ のアイテムのタグを読む。入れ子のタグはそのまま', async () => {
    const source = new MemoryFileSource([
      ['kubejs/data/forge/tags/items/ores/iron.json', json({ values: ['kubejs:iron_ore', { id: 'other:ore', required: false }] })],
      ['kubejs/data/c/tags/item/ores.json', json({ replace: true, values: ['#c:ores/iron'] })],
      ['kubejs/data/forge/tags/blocks/ores.json', json({ values: ['a:b'] })],
      ['kubejs/data/forge/tags/items/broken.json', strToU8('{ broken')],
    ])
    const result = await readKubeJsRecipes(source)
    expect(result.itemTags).toEqual({
      'forge:ores/iron': { replace: false, values: ['kubejs:iron_ore', 'other:ore'] },
      'c:ores': { replace: true, values: ['#c:ores/iron'] },
    })
    expect(result.problems).toHaveLength(1)
    expect(result.problems[0]).toMatch(/^kubejs\/data\/forge\/tags\/items\/broken\.json: 読めません/)
  })

  it('server_scripts の ServerEvents.recipes（KubeJS 6）を見つける', async () => {
    const source = new MemoryFileSource([
      ['kubejs/server_scripts/a/recipes.js', strToU8("ServerEvents . recipes(event => {\n  event.remove({ id: 'create:milling/wheat' })\n})")],
    ])
    expect((await readKubeJsRecipes(source)).scriptsChangeRecipes).toBe(true)
  })

  it("server_scripts の onEvent('recipes'（KubeJS 5 以前）を見つける。引用符は \" でもよい", async () => {
    for (const script of ["onEvent('recipes', event => {})", 'onEvent( "recipes" , e => {})']) {
      const source = new MemoryFileSource([['kubejs/server_scripts/r.js', strToU8(script)]])
      expect((await readKubeJsRecipes(source)).scriptsChangeRecipes).toBe(true)
    }
  })

  it('.js 以外のファイル、ほかのイベント、startup_scripts は数えない', async () => {
    const source = new MemoryFileSource([
      ['kubejs/server_scripts/notes.txt', strToU8('ServerEvents.recipes(e => {})')],
      ['kubejs/server_scripts/tags.js', strToU8("ServerEvents.tags('item', e => {}); onEvent('recipes.serializer', e => {})")],
      ['kubejs/startup_scripts/r.js', strToU8('ServerEvents.recipes(e => {})')],
    ])
    expect((await readKubeJsRecipes(source)).scriptsChangeRecipes).toBe(false)
  })

  it('拡張子 .JS（大文字）も読む', async () => {
    const source = new MemoryFileSource([['kubejs/server_scripts/R.JS', strToU8('ServerEvents.recipes(e => {})')]])
    expect((await readKubeJsRecipes(source)).scriptsChangeRecipes).toBe(true)
  })

  it('kubejs/ がなければ空', async () => {
    expect(await readKubeJsRecipes(new MemoryFileSource([['mods/a.jar', new Uint8Array()]]))).toEqual({
      recipes: [],
      scriptsChangeRecipes: false,
      itemTags: {},
      problems: [],
    })
  })

  it('JSON として読めないレシピと、読めないファイルは problems に入れて、ほかは読む', async () => {
    const source = new MemoryFileSource([
      ['kubejs/data/p/recipes/broken.json', strToU8('{ broken')],
      ['kubejs/data/p/recipes/gone.json', () => Promise.reject(new Error('壊れています'))],
      ['kubejs/data/p/recipes/ok.json', json({ type: 'create:crushing', ingredients: { item: 'minecraft:cobblestone' } })],
      ['kubejs/server_scripts/bad.js', () => Promise.reject(new Error('開けません'))],
      ['kubejs/server_scripts/good.js', strToU8('ServerEvents.recipes(e => {})')],
    ])
    const result = await readKubeJsRecipes(source)
    expect(result.recipes.map((r) => r.id)).toEqual(['p:ok'])
    expect(result.scriptsChangeRecipes).toBe(true)
    expect(result.problems).toHaveLength(3)
    expect(result.problems[0]).toMatch(/^kubejs\/data\/p\/recipes\/broken\.json: 読めません（/)
    expect(result.problems[1]).toBe('kubejs/data/p/recipes/gone.json: 読めません（壊れています）')
    expect(result.problems[2]).toBe('kubejs/server_scripts/bad.js: 読めません（開けません）')
  })

  it('末尾の余分な , がある JSON も読む', async () => {
    const source = new MemoryFileSource([
      ['kubejs/data/p/recipes/x.json', strToU8('{"type": "create:milling", "ingredients": [{"item": "a:b"},],}')],
    ])
    expect((await readKubeJsRecipes(source)).recipes).toMatchObject([{ id: 'p:x', items: ['a:b'] }])
  })
})
