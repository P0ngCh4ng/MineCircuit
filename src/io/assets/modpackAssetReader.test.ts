import { describe, expect, it } from 'vitest'
import { strToU8 } from 'fflate'
import { fakeJar } from '../../../tests/fixtures/fakeJar'
import { fakeResourcePackFolder, fakeResourcePackZip } from '../../../tests/fixtures/fakeResourcePack'
import type { FileSource } from '../fileSource'
import { MemoryFileSource } from '../memoryFileSource'
import { olderFormatPrefixes } from '../modpack/indexedDbJarCache'
import { scanJar } from '../modpack/jarScanner'
import { MemoryJarCache, ModpackLoader } from '../modpack/modpackLoader'
import { ModpackAssetReader } from './modpackAssetReader'

const MODEL = 'assets/gears/models/block/gear.json'
const TEXTURE = 'assets/gears/textures/block/gear.png'
const MCMETA = 'assets/gears/textures/block/gear.png.mcmeta'

/** 偽の PNG（中身は何でもよい。バイトがそのまま返ることだけを確かめる） */
function png(...tail: number[]): Uint8Array {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...tail])
}

function model(label: string): string {
  return JSON.stringify({ parent: 'block/cube_all', textures: { all: 'gears:block/gear' }, label })
}

function gearJar(label: string, texture: Uint8Array, extra: Record<string, string | Uint8Array> = {}): Uint8Array {
  return fakeJar({
    forgeMods: [{ modId: 'gears', displayName: 'Gears' }],
    blockStates: { 'gears:gear': { variants: { '': { model: 'gears:block/gear' } } } },
    files: { [MODEL]: model(label), [TEXTURE]: texture, ...extra },
  })
}

/** 読んだ回数を数える FileSource */
function counting(source: MemoryFileSource): { source: FileSource; reads: string[]; ranges: string[] } {
  const reads: string[] = []
  const ranges: string[] = []
  return {
    reads,
    ranges,
    source: {
      list: (dir) => source.list(dir),
      read: (path) => {
        reads.push(path)
        return source.read(path)
      },
      stat: (path) => source.stat(path),
      readRange: (path, start, end) => {
        ranges.push(path)
        return source.readRange(path, start, end)
      },
    },
  }
}

const stat = (size: number) => ({ size, lastModified: 1000 })

/** stat を付けて足す（部分読みを使う） */
function addWithStat(source: MemoryFileSource, path: string, bytes: Uint8Array): void {
  source.add(path, bytes, stat(bytes.length))
}

describe('ModpackAssetReader（Modpack.assets()）', () => {
  it('jar のモデルの JSON と PNG のバイトを読む。ないものは null', async () => {
    const memory = new MemoryFileSource()
    addWithStat(memory, 'mods/gears.jar', gearJar('jar', png(1, 2, 3), { [MCMETA]: '{"animation":{}}' }))
    const pack = await new ModpackLoader(memory).load()
    const assets = pack.assets()
    expect(JSON.parse((await assets.readText(MODEL))!)).toMatchObject({ label: 'jar' })
    expect(await assets.readBytes(TEXTURE)).toEqual(png(1, 2, 3))
    expect(await assets.readText(MCMETA)).toBe('{"animation":{}}')
    expect(await assets.readText('assets/gears/blockstates/gear.json')).toContain('gears:block/gear')
    expect(await assets.readBytes('assets/gears/textures/block/none.png')).toBeNull()
    expect(await assets.readBytes('assets/other/models/block/gear.json')).toBeNull()
    expect(await assets.readBytes('com/example/Mod.class')).toBeNull()
    expect(pack.assets()).toBe(assets)
  })

  it('同じパスは リソースパック（options.txt の順）> 書いていないパック > ModTranslations > jar（名前の後ろ）の順で選ぶ', async () => {
    const memory = new MemoryFileSource()
    addWithStat(memory, 'mods/a-gears.jar', gearJar('a.jar', png(1)))
    addWithStat(memory, 'mods/b-gears.jar', gearJar('b.jar', png(2)))
    const files = (label: string, n: number) => ({ files: { [MODEL]: model(label), [TEXTURE]: png(n) } })
    for (const [path, bytes] of fakeResourcePackFolder('ModTranslations', { mcmeta: false, ...files('mt', 3) })) {
      memory.add(path, bytes)
    }
    addWithStat(memory, 'resourcepacks/unlisted.zip', fakeResourcePackZip(files('unlisted', 4)))
    addWithStat(memory, 'resourcepacks/listed1.zip', fakeResourcePackZip(files('listed1', 5)))
    for (const [path, bytes] of fakeResourcePackFolder('resourcepacks/listed2', { files: { [TEXTURE]: png(6) } })) {
      memory.add(path, bytes)
    }
    memory.add('options.txt', strToU8('resourcePacks:["vanilla","file/listed1.zip","file/listed2"]\n'))

    const assets = (await new ModpackLoader(memory).load()).assets()
    // テクスチャは一番優先の listed2（フォルダ）、モデルは listed2 にないので listed1
    expect(await assets.readBytes(TEXTURE)).toEqual(png(6))
    expect(JSON.parse((await assets.readText(MODEL))!)).toMatchObject({ label: 'listed1' })
  })

  it('jar どうしでは名前の後ろの jar、jar の外があればそちらを優先する', async () => {
    const memory = new MemoryFileSource()
    addWithStat(memory, 'mods/a-gears.jar', gearJar('a.jar', png(1)))
    addWithStat(memory, 'mods/b-gears.jar', gearJar('b.jar', png(2)))
    const jarsOnly = (await new ModpackLoader(memory).load()).assets()
    expect(JSON.parse((await jarsOnly.readText(MODEL))!)).toMatchObject({ label: 'b.jar' })

    for (const [path, bytes] of fakeResourcePackFolder('ModTranslations', { mcmeta: false, files: { [TEXTURE]: png(3) } })) {
      memory.add(path, bytes)
    }
    const withTranslations = (await new ModpackLoader(memory).load()).assets()
    expect(await withTranslations.readBytes(TEXTURE)).toEqual(png(3))
    expect(JSON.parse((await withTranslations.readText(MODEL))!)).toMatchObject({ label: 'b.jar' })
  })

  it('翻訳を持たないリソースパックの資産も読む', async () => {
    const memory = new MemoryFileSource()
    addWithStat(memory, 'mods/gears.jar', gearJar('jar', png(1)))
    addWithStat(memory, 'resourcepacks/textures.zip', fakeResourcePackZip({ files: { [TEXTURE]: png(9) } }))
    const pack = await new ModpackLoader(memory).load()
    expect(pack.langPacks).toEqual([])
    expect(await pack.assets().readBytes(TEXTURE)).toEqual(png(9))
    expect(await pack.assets().readBytes('assets/example/textures/block/a.png')).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))
  })

  it('jar の一覧は1回だけ読み、同じ時に頼まれた項目はまとめて読む。索引にない jar は開かない', async () => {
    const memory = new MemoryFileSource()
    addWithStat(memory, 'mods/gears.jar', gearJar('jar', png(1)))
    addWithStat(memory, 'mods/other.jar', fakeJar({ files: { 'assets/other/models/block/x.json': '{}' } }))
    const pack = await new ModpackLoader(memory).load()
    const counted = counting(memory)
    const reader = new ModpackAssetReader(counted.source, [
      { kind: 'zip', path: 'mods/gears.jar', assets: [MODEL, TEXTURE] },
      { kind: 'zip', path: 'mods/other.jar', assets: ['assets/other/models/block/x.json'] },
    ])
    expect(pack.jarCount).toBe(2)

    await Promise.all([reader.readBytes(MODEL), reader.readBytes(TEXTURE)])
    const first = counted.ranges.length
    // 末尾の目印（と一覧）＋ 2つの項目をまとめて1回
    expect(first).toBeLessThanOrEqual(3)
    expect(counted.ranges.every((p) => p === 'mods/gears.jar')).toBe(true)

    expect(await reader.readBytes(MODEL)).not.toBeNull()
    expect(await reader.readBytes(TEXTURE)).toEqual(png(1))
    // 2回目からは項目だけを読む
    expect(counted.ranges.length - first).toBe(2)
    expect(counted.reads).toEqual([])
  })

  it('一部を読めない FileSource では、ファイル全体を読んで取り出す', async () => {
    const memory = new MemoryFileSource([['mods/gears.jar', gearJar('jar', png(7))]]) // stat なし
    const pack = await new ModpackLoader(memory).load()
    expect(await pack.assets().readBytes(TEXTURE)).toEqual(png(7))
    expect(JSON.parse((await pack.assets().readText(MODEL))!)).toMatchObject({ label: 'jar' })
  })

  it('保存した結果（索引）から作った Modpack でも読める', async () => {
    const memory = new MemoryFileSource()
    addWithStat(memory, 'mods/gears.jar', gearJar('jar', png(1)))
    addWithStat(memory, 'resourcepacks/p.zip', fakeResourcePackZip({ files: { [TEXTURE]: png(8) } }))
    const cache = new MemoryJarCache()
    await new ModpackLoader(memory, { cache }).load()
    const scanned: string[] = []
    const pack = await new ModpackLoader(memory, {
      cache,
      scan: async (jar) => {
        scanned.push(jar)
        throw new Error('読まないはず')
      },
    }).load()
    expect(scanned).toEqual([])
    expect(await pack.assets().readBytes(TEXTURE)).toEqual(png(8))
    expect(JSON.parse((await pack.assets().readText(MODEL))!)).toMatchObject({ label: 'jar' })
  })

  it('読み込みのあとで開けなくなった jar は飛ばし、problems に1回だけ書く', async () => {
    const memory = new MemoryFileSource()
    addWithStat(memory, 'mods/a-gears.jar', gearJar('a.jar', png(1)))
    addWithStat(memory, 'mods/b-gears.jar', gearJar('b.jar', png(2)))
    const pack = await new ModpackLoader(memory).load()
    const broken = strToU8('もう jar ではない')
    memory.add('mods/b-gears.jar', broken, stat(broken.length))
    const assets = pack.assets() as ModpackAssetReader
    expect(await assets.readBytes(TEXTURE)).toEqual(png(1))
    expect(await assets.readBytes(TEXTURE)).toEqual(png(1))
    expect(assets.problems).toHaveLength(1)
    expect(assets.problems[0]).toMatch(/^mods\/b-gears\.jar: 開けませんでした/)
  })

  it('Modpack のフォルダがなければ常に null', async () => {
    const reader = new ModpackAssetReader(null, [{ kind: 'zip', path: 'mods/gears.jar', assets: [MODEL] }])
    expect(await reader.readText(MODEL)).toBeNull()
  })

  it('BOM 付きの JSON は BOM を除いて返す。assets/ の外やフォルダの外は読まない', async () => {
    const memory = new MemoryFileSource([
      ['pack/assets/gears/models/block/gear.json', strToU8('﻿{"a":1}')],
      ['secret.txt', strToU8('x')],
    ])
    const reader = new ModpackAssetReader(memory, [{ kind: 'folder', path: 'pack' }])
    expect(await reader.readText(MODEL)).toBe('{"a":1}')
    expect(await reader.readText('../secret.txt')).toBeNull()
    expect(await reader.readText('secret.txt')).toBeNull()
  })
})

describe('資産の索引（JarSummary.assets）', () => {
  it('models/・blockstates/・textures/（.png.mcmeta を含む）だけを入れ、翻訳と jar の中の jar は入れない', () => {
    const nested = fakeJar({ files: { 'assets/inner/models/block/x.json': '{}' } })
    const jar = fakeJar({
      lang: { gears: { en_us: { 'block.gears.gear': 'Gear' } } },
      blockStates: { 'gears:gear': {} },
      files: { [MODEL]: '{}', [TEXTURE]: png(), [MCMETA]: '{}', 'assets/gears/sounds/x.ogg': 'x' },
      nestedJars: { 'inner.jar': nested },
    })
    expect(scanJar('gears.jar', jar).assets.sort()).toEqual(
      ['assets/gears/blockstates/gear.json', MODEL, TEXTURE, MCMETA].sort(),
    )
  })

  it('形式を上げたら、前の形式の鍵の前半も消す対象にする', () => {
    expect(olderFormatPrefixes('v3|a.jar|')).toEqual(['v1|a.jar|', 'v2|a.jar|'])
    expect(olderFormatPrefixes('v1|a.jar|')).toEqual([])
  })
})
