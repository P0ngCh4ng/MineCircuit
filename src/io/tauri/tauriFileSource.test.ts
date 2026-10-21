import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeTauriFs } from '../../../tests/fixtures/fakeTauri'
import { fakeJar } from '../../../tests/fixtures/fakeJar'
import { FileNotFoundError } from '../fileSource'
import { ModpackLoader } from '../modpack/modpackLoader'

const fake = vi.hoisted(() => ({ fs: null as FakeTauriFs | null }))
const fs = () => {
  if (!fake.fs) throw new Error('fs を用意していません')
  return fake.fs
}

vi.mock('@tauri-apps/plugin-fs', () => ({
  SeekMode: { Start: 0, Current: 1, End: 2 },
  readDir: (p: string) => fs().readDir(p),
  readFile: (p: string) => fs().readFile(p),
  stat: (p: string) => fs().stat(p),
  open: (p: string, o: { read?: boolean }) => fs().open(p, o),
  writeFile: (p: string, d: Uint8Array) => fs().writeFile(p, d),
}))

const { TauriFileSource, TauriForbiddenError, baseName, joinPath, toFileError } = await import('./tauriFileSource')

const ROOT = 'C:\\Users\\me\\curseforge\\Instances\\ATM10'
const bytes = (...v: number[]) => new Uint8Array(v)

beforeEach(() => {
  fake.fs = new FakeTauriFs()
  fake.fs.add(`${ROOT}\\mods\\create.jar`, bytes(1, 2, 3, 4, 5, 6, 7, 8), new Date(5000))
  fake.fs.add(`${ROOT}\\mods\\jei.jar`, bytes(9))
  fake.fs.add(`${ROOT}\\config\\create-server.toml`, bytes(10))
  fake.fs.add(`${ROOT}\\minecraftinstance.json`, bytes(11), null)
})

describe('joinPath / baseName', () => {
  it('フォルダのパスの区切り（Windows は \\）で相対パスをつなぐ', () => {
    expect(joinPath('C:\\a\\b', 'mods/x.jar')).toBe('C:\\a\\b\\mods\\x.jar')
    expect(joinPath('C:\\a\\b\\', 'mods')).toBe('C:\\a\\b\\mods')
    expect(joinPath('/home/me/pack', 'mods/x.jar')).toBe('/home/me/pack/mods/x.jar')
    expect(joinPath('C:\\a', '')).toBe('C:\\a')
  })

  it('フォルダの外を指す .. は受け付けない', () => {
    expect(() => joinPath('C:\\a', '../b')).toThrow()
  })

  it('最後の部分を名前にする', () => {
    expect(baseName('C:\\Users\\me\\Instances\\ATM10')).toBe('ATM10')
    expect(baseName('C:\\Users\\me\\Instances\\ATM10\\')).toBe('ATM10')
    expect(baseName('/home/me/a.nbt')).toBe('a.nbt')
  })
})

describe('toFileError', () => {
  it('ないファイルは FileNotFoundError、範囲の外は TauriForbiddenError にする', () => {
    expect(toFileError('... (os error 2)', 'mods/a.jar')).toBeInstanceOf(FileNotFoundError)
    expect(toFileError('... (os error 3)', 'mods')).toBeInstanceOf(FileNotFoundError)
    expect(toFileError('No such file or directory', 'x')).toBeInstanceOf(FileNotFoundError)
    expect(toFileError('forbidden path: C:\\x', 'x')).toBeInstanceOf(TauriForbiddenError)
    const other = toFileError('disk on fire', 'x')
    expect(other).toBeInstanceOf(Error)
    expect(other.message).toBe('disk on fire')
  })
})

describe('TauriFileSource', () => {
  it('フォルダの中の名前を名前順で返し、フォルダには / を付ける', async () => {
    const s = new TauriFileSource(ROOT)
    expect(await s.list('')).toEqual(['config/', 'minecraftinstance.json', 'mods/'])
    expect(await s.list('mods')).toEqual(['create.jar', 'jei.jar'])
    expect(fs().calls).toContain(`readDir ${ROOT}\\mods`)
  })

  it('ファイルの中身を返す', async () => {
    const s = new TauriFileSource(ROOT)
    expect(new Uint8Array(await s.read('mods/jei.jar'))).toEqual(bytes(9))
  })

  it('大きさと更新時刻を返す。更新時刻が分からなければ null', async () => {
    const s = new TauriFileSource(ROOT)
    expect(await s.stat('mods/create.jar')).toEqual({ size: 8, lastModified: 5000 })
    expect(await s.stat('minecraftinstance.json')).toBeNull()
  })

  it('ないものは FileNotFoundError（パスはフォルダの中からの相対パス）', async () => {
    const s = new TauriFileSource(ROOT)
    await expect(s.read('mods/none.jar')).rejects.toBeInstanceOf(FileNotFoundError)
    await expect(s.read('mods/none.jar')).rejects.toMatchObject({ path: 'mods/none.jar' })
    await expect(s.stat('mods/none.jar')).rejects.toBeInstanceOf(FileNotFoundError)
    await expect(s.list('resourcepacks')).rejects.toBeInstanceOf(FileNotFoundError)
    await expect(s.readRange('mods/none.jar', 0, 1)).rejects.toBeInstanceOf(FileNotFoundError)
    await expect(s.read('')).rejects.toBeInstanceOf(FileNotFoundError)
  })

  it('許可の範囲の外は TauriForbiddenError', async () => {
    fs().allowed = ['C:\\other']
    const s = new TauriFileSource(ROOT)
    await expect(s.list('')).rejects.toBeInstanceOf(TauriForbiddenError)
    await expect(s.read('mods/jei.jar')).rejects.toBeInstanceOf(TauriForbiddenError)
  })

  it('フォルダの外は読まない', async () => {
    const s = new TauriFileSource(ROOT)
    await expect(s.read('../secret.txt')).rejects.toThrow()
    expect(fs().calls).toEqual([])
  })

  it('readRange は一部だけを読み、ファイルを閉じる。末尾を超えたら末尾まで', async () => {
    const s = new TauriFileSource(ROOT)
    expect(new Uint8Array(await s.readRange('mods/create.jar', 2, 5))).toEqual(bytes(3, 4, 5))
    expect(new Uint8Array(await s.readRange('mods/create.jar', 6, 100))).toEqual(bytes(7, 8))
    expect(new Uint8Array(await s.readRange('mods/create.jar', 0, 0))).toEqual(bytes())
    expect(fs().openHandles).toBe(0)
    await expect(s.readRange('mods/create.jar', 5, 2)).rejects.toThrow(RangeError)
  })

  it('read が少しずつしか返さなくても、求めた分を読む', async () => {
    fs().readChunk = 3
    const s = new TauriFileSource(ROOT)
    expect(new Uint8Array(await s.readRange('mods/create.jar', 1, 8))).toEqual(bytes(2, 3, 4, 5, 6, 7, 8))
    expect(fs().openHandles).toBe(0)
  })

  it('ModpackLoader は jar 全体を読まず、一部だけを読む', async () => {
    const big = new Uint8Array(500_000)
    for (let i = 0; i < big.length; i++) big[i] = (i * 2654435761) >>> 24
    const jar = fakeJar({
      forgeMods: [{ modId: 'gears', displayName: 'Gears' }],
      lang: { gears: { ja_jp: { 'block.gears.gear': '歯車' } } },
      files: { 'assets/gears/textures/big.png': big },
    })
    fake.fs = new FakeTauriFs()
    fs().add(`${ROOT}\\mods\\gears.jar`, jar)
    const pack = await new ModpackLoader(new TauriFileSource(ROOT)).load()
    expect(pack.mods.map((m) => m.modId)).toEqual(['gears'])
    expect(fs().calls.some((c) => c.startsWith('readFile'))).toBe(false)
    expect(fs().calls.some((c) => c.startsWith('open'))).toBe(true)
  })
})
