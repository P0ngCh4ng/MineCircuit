import { describe, expect, it } from 'vitest'
import { strToU8 } from 'fflate'
import { fakeJar } from '../../../tests/fixtures/fakeJar'
import { fakeResourcePackFolder, fakeResourcePackZip } from '../../../tests/fixtures/fakeResourcePack'
import { ResourceLocation } from '../../domain/resourceLocation'
import { FileNotFoundError } from '../fileSource'
import { MemoryFileSource } from '../memoryFileSource'
import { scanJarContent } from './jarScanner'
import {
  JAR_SUMMARY_FORMAT,
  jarCacheKey,
  MemoryJarCache,
  ModpackLoadAbortedError,
  ModpackLoader,
  type JarScanner,
  type ModpackLoadProgress,
} from './modpackLoader'

const rl = (s: string) => ResourceLocation.parse(s)

function gearJar(name = 'テスト歯車'): Uint8Array {
  return fakeJar({
    forgeMods: [{ modId: 'gears', displayName: 'Gears', version: '1.0' }],
    lang: { gears: { ja_jp: { 'block.gears.gear': name }, en_us: { 'block.gears.gear': 'Gear', 'block.gears.big': 'Big' } } },
    blockStates: { 'gears:gear': { variants: { 'facing=north': { model: 'gears:block/gear' } } } },
  })
}

function pipesJar(): Uint8Array {
  return fakeJar({
    fabricMod: { modId: 'pipes', displayName: 'Pipes', version: '2.0' },
    lang: { pipes: { en_us: { 'block.pipes.pipe': 'Pipe' } } },
  })
}

/** 何回 jar を開いたかを数える */
function countingScanner(): { scan: JarScanner; scanned: string[] } {
  const scanned: string[] = []
  return {
    scanned,
    scan: async (jar, content) => {
      scanned.push(jar)
      return scanJarContent(jar, content)
    },
  }
}

describe('ModpackLoader', () => {
  it('mods/*.jar を読み、Mod の一覧・namespace・表示名をまとめる', async () => {
    const source = new MemoryFileSource([
      ['mods/b-pipes.jar', pipesJar()],
      ['mods/a-gears.jar', gearJar()],
      ['mods/readme.txt', strToU8('jar ではない')],
      ['config/gears-common.toml', strToU8('﻿speed = 16\n')],
    ])
    const pack = await new ModpackLoader(source).load()
    expect(pack.mods.map((m) => [m.modId, m.name, m.version, m.jar])).toEqual([
      ['gears', 'Gears', '1.0', 'a-gears.jar'],
      ['pipes', 'Pipes', '2.0', 'b-pipes.jar'],
    ])
    expect(pack.jarCount).toBe(2)
    expect(pack.namespaces).toEqual(['gears', 'pipes'])
    expect(pack.hasNamespace('gears')).toBe(true)
    expect(pack.hasNamespace('minecraft')).toBe(true)
    expect(pack.hasNamespace('missing')).toBe(false)
    expect(pack.displayName(rl('gears:gear'), 'ja_jp')).toBe('テスト歯車')
    expect(pack.displayName(rl('gears:big'), 'ja_jp')).toBeNull()
    expect(pack.displayName(rl('gears:big'), 'en_us')).toBe('Big')
    expect(pack.displayName(rl('minecraft:stone'), 'en_us')).toBeNull()
    expect(pack.displayNameCount('en_us')).toBe(3)
    expect(pack.blockStateDefinition(rl('gears:gear'))).toEqual({
      variants: { 'facing=north': { model: 'gears:block/gear' } },
    })
    expect(pack.blockStateDefinition(rl('pipes:pipe'))).toBeNull()
    expect(await pack.config('config/gears-common.toml')).toBe('speed = 16\n')
    expect(await pack.config('config/none.toml')).toBeNull()
    expect(pack.problems).toEqual([])
  })

  it('読めない jar は problems に入れて、ほかの jar は読む', async () => {
    const source = new MemoryFileSource([
      ['mods/a.jar', gearJar()],
      ['mods/broken.jar', strToU8('not a zip')],
    ])
    const pack = await new ModpackLoader(source).load()
    expect(pack.mods.map((m) => m.modId)).toEqual(['gears'])
    expect(pack.problems).toHaveLength(1)
    expect(pack.problems[0].jar).toBe('broken.jar')
  })

  it('mods/ がなければ FileNotFoundError', async () => {
    await expect(new ModpackLoader(new MemoryFileSource([['config/x.toml', strToU8('')]])).load()).rejects.toThrow(
      FileNotFoundError,
    )
  })

  it('進み具合を知らせる', async () => {
    const source = new MemoryFileSource([
      ['mods/a.jar', gearJar()],
      ['mods/b.jar', pipesJar()],
    ])
    const seen: ModpackLoadProgress[] = []
    await new ModpackLoader(source, { onProgress: (p) => seen.push(p) }).load()
    expect(seen).toEqual([
      { done: 0, total: 3, fromCache: 0, current: 'a.jar' },
      { done: 1, total: 3, fromCache: 0, current: 'b.jar' },
      { done: 2, total: 3, fromCache: 0, current: 'Minecraft 本体' },
      { done: 3, total: 3, fromCache: 0, current: null },
    ])
  })

  it('大きさと更新時刻が同じ jar は、中身を読まずに保存した結果を使う', async () => {
    const cache = new MemoryJarCache()
    const reads: string[] = []
    const make = (gearStat: { size: number; lastModified: number }, gearName: string) => {
      const source = new MemoryFileSource()
      const gearBytes = gearJar(gearName)
      source.add('mods/a.jar', async () => {
        reads.push('a.jar')
        return gearBytes.slice().buffer
      }, gearStat)
      const pipeBytes = pipesJar()
      source.add('mods/b.jar', async () => {
        reads.push('b.jar')
        return pipeBytes.slice().buffer
      }, { size: 50, lastModified: 1 })
      return source
    }

    const first = countingScanner()
    await new ModpackLoader(make({ size: 100, lastModified: 1 }, '歯車1'), { cache, scan: first.scan }).load()
    expect(first.scanned).toEqual(['a.jar', 'b.jar'])

    // 何も変わっていない
    reads.length = 0
    const second = countingScanner()
    const progress: ModpackLoadProgress[] = []
    const pack2 = await new ModpackLoader(make({ size: 100, lastModified: 1 }, '歯車1'), {
      cache,
      scan: second.scan,
      onProgress: (p) => progress.push(p),
    }).load()
    expect(second.scanned).toEqual([])
    expect(reads).toEqual([])
    expect(progress.at(-1)).toEqual({ done: 3, total: 3, fromCache: 2, current: null })
    expect(pack2.displayName(rl('gears:gear'), 'ja_jp')).toBe('歯車1')

    // a.jar だけ更新した
    const third = countingScanner()
    const pack3 = await new ModpackLoader(make({ size: 120, lastModified: 2 }, '歯車2'), { cache, scan: third.scan }).load()
    expect(third.scanned).toEqual(['a.jar'])
    expect(pack3.displayName(rl('gears:gear'), 'ja_jp')).toBe('歯車2')
  })

  it('大きさと更新時刻が分からなければ、中身から鍵を作って保存した結果を使う', async () => {
    const cache = new MemoryJarCache()
    const bytes = gearJar()
    const first = countingScanner()
    await new ModpackLoader(new MemoryFileSource([['mods/a.jar', bytes]]), { cache, scan: first.scan }).load()
    const second = countingScanner()
    await new ModpackLoader(new MemoryFileSource([['mods/a.jar', bytes]]), { cache, scan: second.scan }).load()
    expect(first.scanned).toEqual(['a.jar'])
    expect(second.scanned).toEqual([])

    const third = countingScanner()
    await new ModpackLoader(new MemoryFileSource([['mods/a.jar', gearJar('別の名前')]]), { cache, scan: third.scan }).load()
    expect(third.scanned).toEqual(['a.jar'])
  })

  it('やめる合図で ModpackLoadAbortedError を投げる', async () => {
    const controller = new AbortController()
    const source = new MemoryFileSource([
      ['mods/a.jar', gearJar()],
      ['mods/b.jar', pipesJar()],
    ])
    const loader = new ModpackLoader(source, {
      signal: controller.signal,
      scan: async (jar, content) => {
        controller.abort()
        return scanJarContent(jar, content)
      },
    })
    await expect(loader.load()).rejects.toThrow(ModpackLoadAbortedError)
  })
})

describe('ModpackLoader（jar の外の翻訳）', () => {
  it('ModTranslations とリソースパックの翻訳を、jar < ModTranslations < リソースパックの順で重ねる', async () => {
    const source = new MemoryFileSource([
      ['mods/a.jar', gearJar('jar の歯車')],
      ['mods/b.jar', pipesJar()],
      ...fakeResourcePackFolder('ModTranslations', {
        mcmeta: false,
        lang: {
          gears: { ja_jp: { 'block.gears.gear': '翻訳の歯車', 'block.gears.big': '翻訳の大歯車' } },
          pipes: { ja_jp: { 'block.pipes.pipe': '翻訳の管' } },
        },
      }),
      ['resourcepacks/ja.zip', fakeResourcePackZip({ lang: { gears: { ja_jp: { 'block.gears.gear': 'パックの歯車' } } } })],
      ...fakeResourcePackFolder('resourcepacks/textures-only'),
    ])
    const pack = await new ModpackLoader(source).load()
    expect(pack.displayName(rl('gears:gear'), 'ja_jp')).toBe('パックの歯車')
    expect(pack.displayName(rl('gears:big'), 'ja_jp')).toBe('翻訳の大歯車')
    expect(pack.displayName(rl('pipes:pipe'), 'ja_jp')).toBe('翻訳の管')
    expect(pack.displayName(rl('gears:gear'), 'en_us')).toBe('Gear')
    expect(pack.langPacks).toEqual(['ModTranslations', 'resourcepacks/ja.zip'])
    // リソースパックは Mod ではないので、namespace やブロック状態の定義は増やさない
    expect(pack.namespaces).toEqual(['gears', 'pipes'])
    expect(pack.jarCount).toBe(2)
    expect(pack.problems).toEqual([])
  })

  it('KubeJS で登録した namespace を足し、kubejs/assets/ の翻訳を jar < kubejs < ModTranslations の順で重ねる', async () => {
    const source = new MemoryFileSource([
      ['mods/a.jar', gearJar('jar の歯車')],
      ['kubejs/startup_scripts/blocks.js', strToU8('event.create("astral:dust")')],
      ...fakeResourcePackFolder('kubejs', {
        mcmeta: false,
        lang: {
          astral: { ja_jp: { 'block.astral.dust': '星の粉' } },
          gears: { ja_jp: { 'block.gears.gear': 'KubeJS の歯車', 'block.gears.big': 'KubeJS の大歯車' } },
        },
      }),
      ...fakeResourcePackFolder('ModTranslations', {
        mcmeta: false,
        lang: { gears: { ja_jp: { 'block.gears.gear': '翻訳の歯車' } } },
      }),
    ])
    const pack = await new ModpackLoader(source).load()
    expect(pack.hasNamespace('astral')).toBe(true)
    expect(pack.namespaces).toEqual(['astral', 'gears'])
    expect(pack.displayName(rl('astral:dust'), 'ja_jp')).toBe('星の粉')
    expect(pack.displayName(rl('gears:big'), 'ja_jp')).toBe('KubeJS の大歯車')
    expect(pack.displayName(rl('gears:gear'), 'ja_jp')).toBe('翻訳の歯車')
    expect(pack.langPacks).toEqual(['kubejs', 'ModTranslations'])
    expect(pack.jarCount).toBe(1)
    expect(pack.problems).toEqual([])
  })

  it('KubeJS のスクリプトのブロックの blockstates とモデルを組み立てる。kubejs/assets/ の本物のファイルが優先', async () => {
    const source = new MemoryFileSource([
      ['mods/a.jar', gearJar()],
      ['kubejs/startup_scripts/blocks.js', strToU8('onEvent("block.registry", e => { e.create("astral:coil"); e.create("astral:dummy").textureAll("astral:block/m") })')],
      ['kubejs/assets/astral/models/block/coil.json', strToU8('{"parent":"block/cube_all","textures":{"all":"astral:block/real"}}')],
    ])
    const pack = await new ModpackLoader(source).load()
    expect(pack.blockStateDefinition(rl('astral:dummy'))).toEqual({ variants: { '': { model: 'astral:block/dummy' } } })
    expect(pack.blockIds()).toEqual(expect.arrayContaining(['astral:coil', 'astral:dummy']))
    const assets = pack.assets()
    expect(JSON.parse((await assets.readText('assets/astral/models/block/dummy.json'))!).textures).toEqual({ all: 'astral:block/m' })
    expect(JSON.parse((await assets.readText('assets/astral/models/block/coil.json'))!).textures).toEqual({ all: 'astral:block/real' })
  })

  it('リソースパックどうしは options.txt の後ろのものを優先し、書いていないものはその下に置く', async () => {
    const zip = (name: string) => fakeResourcePackZip({ lang: { gears: { ja_jp: { 'block.gears.gear': name } } } })
    const make = (options: string | null) =>
      new MemoryFileSource([
        ['mods/a.jar', gearJar()],
        ['resourcepacks/a.zip', zip('a')],
        ['resourcepacks/b.zip', zip('b')],
        ...fakeResourcePackFolder('resourcepacks/c', { lang: { gears: { ja_jp: { 'block.gears.gear': 'c' } } } }),
        ...(options === null ? [] : ([['options.txt', strToU8(options)]] as const)),
      ])
    const name = async (options: string | null) =>
      (await new ModpackLoader(make(options)).load()).displayName(rl('gears:gear'), 'ja_jp')
    // options.txt がなければ名前順（後ろの c が優先）
    expect(await name(null)).toBe('c')
    expect(await name('resourcePacks:["vanilla","file/b.zip","file/a.zip"]\n')).toBe('a')
    expect(await name('resourcePacks:["vanilla","file/a.zip","file/b.zip"]\n')).toBe('b')
  })

  it('zip のリソースパックは jar と同じく保存し、変わっていなければ読み直さない', async () => {
    const cache = new MemoryJarCache()
    const make = () =>
      new MemoryFileSource([
        ['mods/a.jar', gearJar()],
        ['resourcepacks/ja.zip', fakeResourcePackZip({ lang: { gears: { ja_jp: { 'block.gears.gear': 'パック' } } } })],
      ])
    const first = countingScanner()
    await new ModpackLoader(make(), { cache, scan: first.scan }).load()
    expect(first.scanned).toEqual(['a.jar', 'resourcepacks/ja.zip'])

    const second = countingScanner()
    const progress: ModpackLoadProgress[] = []
    const pack = await new ModpackLoader(make(), { cache, scan: second.scan, onProgress: (p) => progress.push(p) }).load()
    expect(second.scanned).toEqual([])
    expect(progress).toEqual([
      { done: 0, total: 3, fromCache: 0, current: 'a.jar' },
      { done: 1, total: 3, fromCache: 1, current: 'resourcepacks/ja.zip' },
      { done: 2, total: 3, fromCache: 2, current: 'Minecraft 本体' },
      { done: 3, total: 3, fromCache: 2, current: null },
    ])
    expect(pack.displayName(rl('gears:gear'), 'ja_jp')).toBe('パック')
  })

  it('読めないリソースパックは problems に入れて、ほかは読む', async () => {
    const source = new MemoryFileSource([
      ['mods/a.jar', gearJar('jar の歯車')],
      ['resourcepacks/broken.zip', strToU8('not a zip')],
      ['resourcepacks/bad-json.zip', fakeResourcePackZip({ files: { 'assets/gears/lang/ja_jp.json': '{ broken' } })],
    ])
    const pack = await new ModpackLoader(source).load()
    expect(pack.displayName(rl('gears:gear'), 'ja_jp')).toBe('jar の歯車')
    expect(pack.problems.map((p) => p.jar).sort()).toEqual(['resourcepacks/bad-json.zip', 'resourcepacks/broken.zip'])
    expect(pack.problems.find((p) => p.jar === 'resourcepacks/bad-json.zip')?.message).toBe(
      'assets/gears/lang/ja_jp.json: JSON として読めません',
    )
  })
})

describe('jarCacheKey', () => {
  it('大きさと更新時刻、または中身から作る', () => {
    expect(jarCacheKey('a.jar', { size: 10, lastModified: 5 }, null)).toBe(`v${JAR_SUMMARY_FORMAT}|a.jar|10|5`)
    const k1 = jarCacheKey('a.jar', null, new Uint8Array([1, 2, 3]))
    const k2 = jarCacheKey('a.jar', null, new Uint8Array([1, 2, 4]))
    expect(k1).not.toBe(k2)
    expect(k1.startsWith(`v${JAR_SUMMARY_FORMAT}|a.jar|3|h`)).toBe(true)
  })
})
