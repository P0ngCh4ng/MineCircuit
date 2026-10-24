import { describe, expect, it } from 'vitest'
import { strToU8 } from 'fflate'
import {
  FAKE_JA_JP_HASH,
  FAKE_PNG,
  fakeAssetIndexFiles,
  fakeClientJar,
  fakeVersionJson,
} from '../../../tests/fixtures/fakeGameFolder'
import { fakeJar } from '../../../tests/fixtures/fakeJar'
import { ResourceLocation } from '../../domain/resourceLocation'
import { MemoryFileSource } from '../memoryFileSource'
import { scanJarContent } from './jarScanner'
import { MemoryJarCache, ModpackLoader, MODPACK_FOLDER_LABEL, type JarScanner } from './modpackLoader'
import {
  findAssetIndex,
  findClientJar,
  findJaJpObject,
  guessGameFolderPath,
  looksLikeGameFolder,
  readInstanceVersion,
  soleInstalledVersion,
} from './vanillaAssets'

const rl = (s: string) => ResourceLocation.parse(s)

/** 版が 1.20.1 と分かる Mod の jar */
function modJar(): Uint8Array {
  return fakeJar({
    forgeMods: [{ modId: 'gears', version: '1.20.1-1.0' }],
    lang: { gears: { ja_jp: { 'block.gears.gear': '歯車' } } },
    files: {
      // Mod が本体の石のテクスチャを差し替える（本体より優先される）
      'assets/minecraft/textures/block/stone.png': new Uint8Array([9, 9, 9]),
    },
  })
}

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

describe('guessGameFolderPath', () => {
  it('ランチャーごとに、Modpack のフォルダからゲームのフォルダを割り出す', () => {
    expect(guessGameFolderPath('C:\\Users\\me\\curseforge\\minecraft\\Instances\\Create Astral')).toBe(
      'C:\\Users\\me\\curseforge\\minecraft\\Install',
    )
    expect(guessGameFolderPath('C:\\Users\\me\\curseforge\\minecraft\\Instances\\Create Astral\\')).toBe(
      'C:\\Users\\me\\curseforge\\minecraft\\Install',
    )
    expect(guessGameFolderPath('C:/Users/me/AppData/Roaming/ModrinthApp/profiles/ATM10')).toBe(
      'C:/Users/me/AppData/Roaming/ModrinthApp/meta',
    )
    expect(guessGameFolderPath('D:\\PrismLauncher\\instances\\ATM10\\.minecraft')).toBe('D:\\PrismLauncher')
    expect(guessGameFolderPath('D:\\MultiMC\\instances\\ATM10\\minecraft')).toBe('D:\\MultiMC')
  })

  it('どれにも当たらなければ null', () => {
    expect(guessGameFolderPath('C:\\Users\\me\\AppData\\Roaming\\.minecraft')).toBeNull()
    expect(guessGameFolderPath('Instances')).toBeNull()
  })
})

describe('本体の jar を探す', () => {
  it('公式ランチャー・CurseForge の versions/<版>/<版>.jar', async () => {
    const s = new MemoryFileSource([['versions/1.20.1/1.20.1.jar', fakeClientJar()]])
    expect(await findClientJar(s, '1.20.1')).toEqual({ path: 'versions/1.20.1/1.20.1.jar', versionId: '1.20.1' })
    expect(await findClientJar(s, '1.19.2')).toBeNull()
  })

  it('Prism / MultiMC の libraries/com/mojang/minecraft/<版>/minecraft-<版>-client.jar', async () => {
    const path = 'libraries/com/mojang/minecraft/1.20.1/minecraft-1.20.1-client.jar'
    const s = new MemoryFileSource([[path, fakeClientJar()]])
    expect(await findClientJar(s, '1.20.1')).toEqual({ path, versionId: null })
  })

  it('Modrinth App の Mod ローダー付きの版（versions/<版>-<ローダー>/）', async () => {
    const s = new MemoryFileSource([
      ['versions/1.20.10/1.20.10.jar', fakeClientJar()],
      ['versions/1.20.1-forge-47.2.0/1.20.1-forge-47.2.0.jar', fakeClientJar()],
    ])
    expect(await findClientJar(s, '1.20.1')).toEqual({
      path: 'versions/1.20.1-forge-47.2.0/1.20.1-forge-47.2.0.jar',
      versionId: '1.20.1-forge-47.2.0',
    })
  })

  it('版のフォルダそのものを選んだとき', async () => {
    const s = new MemoryFileSource([['1.20.1.jar', fakeClientJar()]])
    expect(await findClientJar(s, '1.20.1')).toEqual({ path: '1.20.1.jar', versionId: null })
  })

  it('入っている版が1つだけなら、その版を使う', async () => {
    const one = new MemoryFileSource([
      ['versions/1.20.1/1.20.1.jar', fakeClientJar()],
      ['versions/1.20.1-forge-47.2.0/1.20.1-forge-47.2.0.json', strToU8('{}')],
    ])
    expect(await soleInstalledVersion(one)).toBe('1.20.1')
    const two = new MemoryFileSource([
      ['versions/1.20.1/1.20.1.jar', fakeClientJar()],
      ['libraries/com/mojang/minecraft/1.19.2/minecraft-1.19.2-client.jar', fakeClientJar()],
    ])
    expect(await soleInstalledVersion(two)).toBeNull()
    expect(await soleInstalledVersion(new MemoryFileSource())).toBeNull()
  })

  it('ゲームのフォルダらしいか', async () => {
    expect(await looksLikeGameFolder(new MemoryFileSource([['versions/1.20.1/1.20.1.jar', fakeClientJar()]]))).toBe(true)
    expect(await looksLikeGameFolder(new MemoryFileSource([['1.20.1.jar', fakeClientJar()]]))).toBe(true)
    expect(await looksLikeGameFolder(new MemoryFileSource([['saves/a/level.dat', strToU8('x')]]))).toBe(false)
  })
})

describe('Modpack の版をランチャーの情報から読む', () => {
  it('CurseForge の minecraftinstance.json', async () => {
    const a = new MemoryFileSource([['minecraftinstance.json', strToU8(JSON.stringify({ gameVersion: '1.20.1' }))]])
    expect(await readInstanceVersion(a)).toBe('1.20.1')
    const b = new MemoryFileSource([
      ['minecraftinstance.json', strToU8(JSON.stringify({ baseModLoader: { minecraftVersion: '1.18.2' } }))],
    ])
    expect(await readInstanceVersion(b)).toBe('1.18.2')
  })

  it('Modrinth App の profile.json', async () => {
    const s = new MemoryFileSource([['profile.json', strToU8(JSON.stringify({ metadata: { game_version: '1.19.2' } }))]])
    expect(await readInstanceVersion(s)).toBe('1.19.2')
  })

  it('壊れた情報や知らない形は null', async () => {
    const s = new MemoryFileSource([['minecraftinstance.json', strToU8('{ 壊れている')]])
    expect(await readInstanceVersion(s)).toBeNull()
    expect(await readInstanceVersion(new MemoryFileSource())).toBeNull()
  })
})

describe('資産の索引から日本語の翻訳を探す', () => {
  it('版の情報の assetIndex.id から索引を探す', async () => {
    const s = new MemoryFileSource([
      ['versions/1.20.1/1.20.1.jar', fakeClientJar()],
      ['versions/1.20.1/1.20.1.json', fakeVersionJson('1.20.1', '5')],
      ...fakeAssetIndexFiles('5', { 'block.minecraft.stone': '石' }),
    ])
    const jar = await findClientJar(s, '1.20.1')
    expect(jar).not.toBeNull()
    const index = await findAssetIndex(s, '1.20.1', jar!)
    expect(index).toBe('assets/indexes/5.json')
    expect(await findJaJpObject(s, index!)).toEqual({
      path: `assets/objects/ab/${FAKE_JA_JP_HASH}`,
      hash: FAKE_JA_JP_HASH,
    })
  })

  it('Prism は meta/net.minecraft/<版>.json の assetIndex.id を使う', async () => {
    const s = new MemoryFileSource([
      ['meta/net.minecraft/1.20.1.json', fakeVersionJson('1.20.1', '5')],
      ...fakeAssetIndexFiles('5', {}),
    ])
    expect(await findAssetIndex(s, '1.20.1', { path: 'x.jar', versionId: null })).toBe('assets/indexes/5.json')
  })

  it('版の情報がなければ、版の名前の索引を試す', async () => {
    const s = new MemoryFileSource(fakeAssetIndexFiles('1.12', {}))
    expect(await findAssetIndex(s, '1.12.2', { path: 'x.jar', versionId: null })).toBe('assets/indexes/1.12.json')
    expect(await findAssetIndex(new MemoryFileSource(), '1.20.1', { path: 'x.jar', versionId: null })).toBeNull()
  })
})

describe('ModpackLoader が本体の jar を読む', () => {
  it('Modpack のフォルダ（.minecraft）にある本体の jar と資産の索引を読む', async () => {
    const source = new MemoryFileSource([
      ['mods/gears.jar', modJar()],
      ['versions/1.20.1/1.20.1.jar', fakeClientJar()],
      ['versions/1.20.1/1.20.1.json', fakeVersionJson('1.20.1', '5')],
      ...fakeAssetIndexFiles('5', { 'block.minecraft.stone': '石', 'block.minecraft.stone.desc': '説明は捨てる' }),
    ])
    const pack = await new ModpackLoader(source).load()
    expect(pack.vanilla).toEqual({
      kind: 'found',
      version: '1.20.1',
      where: MODPACK_FOLDER_LABEL,
      jarPath: 'versions/1.20.1/1.20.1.jar',
      jaJp: true,
    })
    expect(pack.displayName(rl('minecraft:stone'), 'ja_jp')).toBe('石')
    expect(pack.displayName(rl('minecraft:stone'), 'en_us')).toBe('Stone')
    expect(pack.displayName(rl('minecraft:oak_log'), 'ja_jp')).toBeNull()
    expect(pack.displayName(rl('gears:gear'), 'ja_jp')).toBe('歯車')
    // Mod の一覧と namespace には足さない
    expect(pack.mods.map((m) => m.modId)).toEqual(['gears'])
    expect(pack.namespaces).toEqual(['gears', 'minecraft'])
    expect(pack.jarCount).toBe(1)
    expect(pack.blockStateDefinition(rl('minecraft:stone'))).toEqual({ variants: { '': { model: 'minecraft:block/stone' } } })
    expect(pack.blockIds()).toContain('minecraft:oak_log')

    const assets = pack.assets()
    expect(JSON.parse((await assets.readText('assets/minecraft/models/block/stone.json'))!)).toEqual({
      parent: 'minecraft:block/cube_all',
      textures: { all: 'minecraft:block/stone' },
    })
    // Mod の jar の同じパスは、本体より優先する
    expect(await assets.readBytes('assets/minecraft/textures/block/stone.png')).toEqual(new Uint8Array([9, 9, 9]))
    expect(await assets.readText('assets/minecraft/blockstates/stone.json')).not.toBeNull()
    // 本体の jar の資産でないもの（data/）は読まない
    expect(await assets.readText('data/minecraft/recipes/stone.json')).toBeNull()
    expect(pack.problems).toEqual([])
  })

  it('Modpack のフォルダの外の本体の jar は、選んだゲームのフォルダから読む（CurseForge）', async () => {
    const instance = new MemoryFileSource([
      ['mods/pipes.jar', fakeJar({ fabricMod: { modId: 'pipes', version: '2.0' } })],
      ['minecraftinstance.json', strToU8(JSON.stringify({ gameVersion: '1.20.1' }))],
    ])
    const install = new MemoryFileSource([
      ['versions/1.19.2/1.19.2.jar', fakeClientJar('Old Stone')],
      ['versions/1.20.1/1.20.1.jar', fakeClientJar()],
      ['versions/1.20.1/1.20.1.json', fakeVersionJson('1.20.1', '5')],
      ...fakeAssetIndexFiles('5', { 'block.minecraft.stone': '石' }),
    ])
    const pack = await new ModpackLoader(instance, { gameFolders: [{ name: 'Install', source: install }] }).load()
    expect(pack.vanilla).toMatchObject({ kind: 'found', version: '1.20.1', where: 'Install', jaJp: true })
    expect(pack.displayName(rl('minecraft:stone'), 'en_us')).toBe('Stone')
    expect(pack.displayName(rl('minecraft:stone'), 'ja_jp')).toBe('石')
    expect(await pack.assets().readBytes('assets/minecraft/textures/block/stone.png')).toEqual(FAKE_PNG)
  })

  it('Prism のゲームのフォルダ（libraries/ と meta/）を読む', async () => {
    const instance = new MemoryFileSource([['mods/gears.jar', modJar()]])
    const prism = new MemoryFileSource([
      ['libraries/com/mojang/minecraft/1.20.1/minecraft-1.20.1-client.jar', fakeClientJar()],
      ['meta/net.minecraft/1.20.1.json', fakeVersionJson('1.20.1', '5')],
      ...fakeAssetIndexFiles('5', { 'block.minecraft.stone': '石' }),
    ])
    const pack = await new ModpackLoader(instance, { gameFolders: [{ name: 'PrismLauncher', source: prism }] }).load()
    expect(pack.vanilla).toMatchObject({ kind: 'found', where: 'PrismLauncher', jaJp: true })
    expect(pack.displayName(rl('minecraft:stone'), 'ja_jp')).toBe('石')
  })

  it('資産の索引がなければ英語の名前だけ', async () => {
    const source = new MemoryFileSource([
      ['mods/gears.jar', modJar()],
      ['versions/1.20.1/1.20.1.jar', fakeClientJar()],
    ])
    const pack = await new ModpackLoader(source).load()
    expect(pack.vanilla).toMatchObject({ kind: 'found', jaJp: false })
    expect(pack.displayName(rl('minecraft:stone'), 'ja_jp')).toBeNull()
    expect(pack.displayName(rl('minecraft:stone'), 'en_us')).toBe('Stone')
  })

  it('見つからなければ missing にし、エラーにはしない', async () => {
    const source = new MemoryFileSource([['mods/gears.jar', modJar()]])
    const pack = await new ModpackLoader(source, {
      gameFolders: [{ name: '別の版', source: new MemoryFileSource([['versions/1.19.2/1.19.2.jar', fakeClientJar()]]) }],
    }).load()
    expect(pack.vanilla).toEqual({ kind: 'missing', version: '1.20.1' })
    expect(pack.displayName(rl('minecraft:stone'), 'en_us')).toBeNull()
    expect(pack.problems).toEqual([])
    expect(await pack.assets().readText('assets/minecraft/models/block/stone.json')).toBeNull()
  })

  it('版が分からなくても、ゲームのフォルダの版が1つだけなら読む', async () => {
    const source = new MemoryFileSource([['mods/a.jar', fakeJar({ forgeMods: [{ modId: 'a' }] })]])
    const game = new MemoryFileSource([['versions/1.20.1/1.20.1.jar', fakeClientJar()]])
    const pack = await new ModpackLoader(source, { gameFolders: [{ name: 'g', source: game }] }).load()
    expect(pack.vanilla).toMatchObject({ kind: 'found', version: '1.20.1' })
  })

  it('壊れた本体の jar は problems に書き、次のフォルダを探す', async () => {
    const source = new MemoryFileSource([
      ['mods/gears.jar', modJar()],
      ['versions/1.20.1/1.20.1.jar', strToU8('zip ではない')],
    ])
    const game = new MemoryFileSource([['versions/1.20.1/1.20.1.jar', fakeClientJar()]])
    const pack = await new ModpackLoader(source, { gameFolders: [{ name: 'g', source: game }] }).load()
    expect(pack.vanilla).toMatchObject({ kind: 'found', where: 'g' })
    expect(pack.problems.map((p) => p.jar)).toEqual(['versions/1.20.1/1.20.1.jar'])
  })

  it('本体の jar と日本語の翻訳も保存し、2回目は読み直さない', async () => {
    const stat = { size: 1000, lastModified: 1 }
    const files = (): MemoryFileSource => {
      const s = new MemoryFileSource([
        ['versions/1.20.1/1.20.1.json', fakeVersionJson('1.20.1', '5')],
        ...fakeAssetIndexFiles('5', { 'block.minecraft.stone': '石' }),
      ])
      s.add('mods/gears.jar', modJar(), stat)
      s.add('versions/1.20.1/1.20.1.jar', fakeClientJar(), stat)
      return s
    }
    const cache = new MemoryJarCache()
    const first = countingScanner()
    await new ModpackLoader(files(), { cache, scan: first.scan }).load()
    expect(first.scanned).toEqual(['gears.jar', 'minecraft|versions/1.20.1/1.20.1.jar'])

    const second = countingScanner()
    const source = files()
    let objectReads = 0
    const read = source.read.bind(source)
    source.read = async (path) => {
      if (path.startsWith('assets/objects/')) objectReads++
      return read(path)
    }
    const pack = await new ModpackLoader(source, { cache, scan: second.scan }).load()
    expect(second.scanned).toEqual([])
    expect(objectReads).toBe(0)
    expect(pack.displayName(rl('minecraft:stone'), 'ja_jp')).toBe('石')
    expect(await pack.assets().readText('assets/minecraft/models/block/stone.json')).not.toBeNull()
  })
})
