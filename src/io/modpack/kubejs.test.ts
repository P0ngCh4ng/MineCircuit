import { describe, expect, it } from 'vitest'
import { strToU8 } from 'fflate'
import { MemoryFileSource } from '../memoryFileSource'
import { kubeJsBlockAssets, readKubeJsStartup, registeredBlocks, registeredNamespaces } from './kubejs'

describe('registeredNamespaces', () => {
  it('.create("<ns>:<path>") の namespace を取り出す。namespace のない ID と、別の呼び出しは数えない', () => {
    const script = `
      StartupEvents.registry('block', event => {
        event.create("createastral:shimmer_block").hardness(1)
        event.create( 'astralsignals:lamp' , 'basic')
        e.create(\`createastral:dummy\`)
        event.create('no_namespace')
        Item.of('create:shaft')
        event.create("Bad:Upper")
      })
    `
    expect(registeredNamespaces(script)).toEqual(['astralsignals', 'createastral'])
  })
})

describe('readKubeJsStartup', () => {
  it('startup_scripts/ の .js を下のフォルダまで読む。ほかのフォルダと .js 以外は読まない', async () => {
    const source = new MemoryFileSource([
      ['kubejs/startup_scripts/registry/blocks.js', strToU8('event.create("createastral:a")')],
      ['kubejs/startup_scripts/items.js', strToU8("event.create('astralfoods:b')")],
      ['kubejs/startup_scripts/notes.txt', strToU8('event.create("ignored:c")')],
      ['kubejs/server_scripts/recipes.js', strToU8('event.create("server:d")')],
    ])
    expect(await readKubeJsStartup(source)).toMatchObject({ namespaces: ['astralfoods', 'createastral'], problems: [] })
  })

  it('kubejs/ がなければ空', async () => {
    expect(await readKubeJsStartup(new MemoryFileSource([['mods/a.jar', new Uint8Array()]]))).toEqual({
      namespaces: [],
      blocks: [],
      problems: [],
    })
  })

  it('読めないスクリプトは problems に入れて、ほかは読む', async () => {
    const source = new MemoryFileSource([
      ['kubejs/startup_scripts/a.js', () => Promise.reject(new Error('壊れています'))],
      ['kubejs/startup_scripts/b.js', strToU8('event.create("createastral:a")')],
    ])
    expect(await readKubeJsStartup(source)).toMatchObject({
      namespaces: ['createastral'],
      problems: ['kubejs/startup_scripts/a.js: 読めません（壊れています）'],
    })
  })
})

const BLOCK_SCRIPT = `
onEvent("item.registry", (event) => {
  event.create("createastral:not_a_block").texture("layer0", "x:item/y")
})
onEvent("block.registry", (event) => {
  event
    .create("createastral:copper_heating_coil")
    .material("lantern")
    .displayName("Copper Coil Block");
  event
    .create("createastral:distillery_dummy", "basic")
    .textureAll("techreborn:block/machine")
    .texture("north", "createastral:block/distillation_tower_off")
    .texture("up", "block/stone")
  event.create('plain_one').model('createastral:block/custom')
  event.create("createastral:some_slab", "slab").textureAll("x:block/y")
})
`

describe('registeredBlocks', () => {
  it('ブロックの登録の中の立方体のブロックと、テクスチャ・モデルを読む。アイテムと slab は読まない', () => {
    const blocks = registeredBlocks(BLOCK_SCRIPT)
    expect(blocks.map((b) => b.id)).toEqual(['createastral:copper_heating_coil', 'createastral:distillery_dummy', 'kubejs:plain_one'])
    // 書いていなければ ID から決まるテクスチャ
    expect(blocks[0]!.textures.east).toBe('createastral:block/copper_heating_coil')
    expect(blocks[0]!.model).toBeNull()
    // textureAll のあとの texture が勝つ。namespace のないものは minecraft
    expect(blocks[1]!.textures).toEqual({
      down: 'techreborn:block/machine',
      up: 'minecraft:block/stone',
      north: 'createastral:block/distillation_tower_off',
      south: 'techreborn:block/machine',
      west: 'techreborn:block/machine',
      east: 'techreborn:block/machine',
    })
    expect(blocks[2]!.model).toBe('createastral:block/custom')
  })

  it('StartupEvents.registry("block", …) も読む', () => {
    expect(registeredBlocks("StartupEvents.registry('block', e => { e.create('a:b').textureAll('a:block/c') })")[0]!.textures.up).toBe('a:block/c')
  })
})

describe('kubeJsBlockAssets', () => {
  it('KubeJS と同じ形の blockstates とモデルを組み立てる', () => {
    const files = kubeJsBlockAssets(registeredBlocks(BLOCK_SCRIPT))
    expect(JSON.parse(files['assets/createastral/blockstates/copper_heating_coil.json']!)).toEqual({
      variants: { '': { model: 'createastral:block/copper_heating_coil' } },
    })
    expect(JSON.parse(files['assets/createastral/models/block/copper_heating_coil.json']!)).toEqual({
      parent: 'minecraft:block/cube_all',
      textures: { all: 'createastral:block/copper_heating_coil' },
    })
    const dummy = JSON.parse(files['assets/createastral/models/block/distillery_dummy.json']!)
    expect(dummy.parent).toBe('minecraft:block/cube')
    expect(dummy.textures.particle).toBe('createastral:block/distillation_tower_off')
    // .model があれば、モデルは組み立てず blockstates だけ
    expect(JSON.parse(files['assets/kubejs/blockstates/plain_one.json']!).variants[''].model).toBe('createastral:block/custom')
    expect(files['assets/kubejs/models/block/plain_one.json']).toBeUndefined()
  })
})
