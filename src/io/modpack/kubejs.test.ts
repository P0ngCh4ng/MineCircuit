import { describe, expect, it } from 'vitest'
import { strToU8 } from 'fflate'
import { MemoryFileSource } from '../memoryFileSource'
import { findKubeJsNamespaces, registeredNamespaces } from './kubejs'

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

describe('findKubeJsNamespaces', () => {
  it('startup_scripts/ の .js を下のフォルダまで読む。ほかのフォルダと .js 以外は読まない', async () => {
    const source = new MemoryFileSource([
      ['kubejs/startup_scripts/registry/blocks.js', strToU8('event.create("createastral:a")')],
      ['kubejs/startup_scripts/items.js', strToU8("event.create('astralfoods:b')")],
      ['kubejs/startup_scripts/notes.txt', strToU8('event.create("ignored:c")')],
      ['kubejs/server_scripts/recipes.js', strToU8('event.create("server:d")')],
    ])
    expect(await findKubeJsNamespaces(source)).toEqual({ namespaces: ['astralfoods', 'createastral'], problems: [] })
  })

  it('kubejs/ がなければ空', async () => {
    expect(await findKubeJsNamespaces(new MemoryFileSource([['mods/a.jar', new Uint8Array()]]))).toEqual({
      namespaces: [],
      problems: [],
    })
  })

  it('読めないスクリプトは problems に入れて、ほかは読む', async () => {
    const source = new MemoryFileSource([
      ['kubejs/startup_scripts/a.js', () => Promise.reject(new Error('壊れています'))],
      ['kubejs/startup_scripts/b.js', strToU8('event.create("createastral:a")')],
    ])
    expect(await findKubeJsNamespaces(source)).toEqual({
      namespaces: ['createastral'],
      problems: ['kubejs/startup_scripts/a.js: 読めません（壊れています）'],
    })
  })
})
