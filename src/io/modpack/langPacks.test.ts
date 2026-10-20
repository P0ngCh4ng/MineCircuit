import { describe, expect, it } from 'vitest'
import { strToU8 } from 'fflate'
import { fakeResourcePackFolder, fakeResourcePackZip } from '../../../tests/fixtures/fakeResourcePack'
import { MemoryFileSource } from '../memoryFileSource'
import { findLangPacks, readFolderLangPack, resourcePackOrder } from './langPacks'

describe('resourcePackOrder', () => {
  it('options.txt の resourcePacks から resourcepacks/ のパックだけを順に取り出す', () => {
    const text = '\ufeffversion:3465\nresourcePacks:["vanilla","mod_resources","file/B.zip","file/A"]\nlang:ja_jp\n'
    expect(resourcePackOrder(text)).toEqual(['B.zip', 'A'])
  })

  it('書いていない、または読めなければ null', () => {
    expect(resourcePackOrder('lang:ja_jp\n')).toBeNull()
    expect(resourcePackOrder('resourcePacks:[broken\n')).toBeNull()
    expect(resourcePackOrder('resourcePacks:[]\n')).toEqual([])
  })
})

describe('findLangPacks', () => {
  it('ModTranslations → options.txt にないパック（名前順）→ options.txt の順に並べる', async () => {
    const source = new MemoryFileSource([
      ['mods/a.jar', new Uint8Array()],
      ['ModTranslations/assets/x/lang/ja_jp.json', strToU8('{}')],
      ['resourcepacks/c.zip', fakeResourcePackZip()],
      ['resourcepacks/b.zip', fakeResourcePackZip()],
      ['resourcepacks/CREDITS.txt', strToU8('読まない')],
      ...fakeResourcePackFolder('resourcepacks/A Folder'),
      ...fakeResourcePackFolder('resourcepacks/d'),
      ['options.txt', strToU8('resourcePacks:["vanilla","file/d","file/b.zip","file/missing.zip"]\n')],
    ])
    expect(await findLangPacks(source)).toEqual([
      { kind: 'folder', path: 'ModTranslations' },
      { kind: 'folder', path: 'resourcepacks/A Folder' },
      { kind: 'zip', path: 'resourcepacks/c.zip' },
      { kind: 'folder', path: 'resourcepacks/d' },
      { kind: 'zip', path: 'resourcepacks/b.zip' },
    ])
  })

  it('どちらもなければ空', async () => {
    expect(await findLangPacks(new MemoryFileSource([['mods/a.jar', new Uint8Array()]]))).toEqual([])
  })
})

describe('readFolderLangPack', () => {
  it('assets/<ns>/lang/ の ja_jp と en_us の名前だけを読む', async () => {
    const source = new MemoryFileSource([
      ...fakeResourcePackFolder('ModTranslations', {
        mcmeta: false,
        lang: {
          gears: {
            ja_jp: { 'block.gears.gear': '歯車', 'tooltip.gears.gear': '説明は捨てる' },
            en_us: { 'block.gears.gear': 'Gear' },
          },
          pipes: { ja_jp: { 'item.pipes.pipe': '管' } },
        },
        files: {
          'assets/gears/lang/zh_cn.json': '{"block.gears.gear":"齿轮"}',
          'assets/broken/lang/ja_jp.json': '{ not json',
          'assets/odd/lang/ja_JP.json': '{"block.odd.thing":"大文字の名前"}',
        },
      }),
    ])
    const pack = await readFolderLangPack(source, 'ModTranslations')
    expect(pack.path).toBe('ModTranslations')
    expect(pack.lang.ja_jp).toEqual({ 'block.gears.gear': '歯車', 'item.pipes.pipe': '管', 'block.odd.thing': '大文字の名前' })
    expect(pack.lang.en_us).toEqual({ 'block.gears.gear': 'Gear' })
    expect(pack.problems).toEqual(['assets/broken/lang/ja_jp.json: JSON として読めません'])
  })

  it('assets/ がなければ空', async () => {
    const source = new MemoryFileSource([['ModTranslations/x.timestamp', strToU8('')]])
    const pack = await readFolderLangPack(source, 'ModTranslations')
    expect(pack.lang).toEqual({ ja_jp: {}, en_us: {} })
    expect(pack.problems).toEqual([])
  })
})
