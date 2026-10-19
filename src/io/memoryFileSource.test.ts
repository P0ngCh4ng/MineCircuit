import { describe, expect, it } from 'vitest'
import { FileNotFoundError, normalizePath } from './fileSource'
import { MemoryFileSource, fileSourceFromPickedFiles, type PickedFile } from './memoryFileSource'

const bytes = (...values: number[]) => new Uint8Array(values)

describe('normalizePath', () => {
  it('区切りをそろえ、空の部分と . を捨てる', () => {
    expect(normalizePath('/mods//a.jar')).toBe('mods/a.jar')
    expect(normalizePath('config\\create\\x.toml')).toBe('config/create/x.toml')
    expect(normalizePath('./')).toBe('')
  })

  it('フォルダの外を指す .. は受け付けない', () => {
    expect(() => normalizePath('../secret')).toThrow()
  })
})

describe('MemoryFileSource', () => {
  const source = () =>
    new MemoryFileSource([
      ['mods/create.jar', bytes(1, 2, 3)],
      ['mods/jei.jar', bytes(4)],
      ['config/create-server.toml', bytes(5)],
      ['minecraftinstance.json', bytes(6)],
    ])

  it('フォルダの中の名前を名前順で返し、フォルダには / を付ける', async () => {
    const s = source()
    expect(await s.list('')).toEqual(['config/', 'minecraftinstance.json', 'mods/'])
    expect(await s.list('mods')).toEqual(['create.jar', 'jei.jar'])
    expect(await s.list('/mods/')).toEqual(['create.jar', 'jei.jar'])
  })

  it('ファイルの中身を返す', async () => {
    const data = await source().read('mods/create.jar')
    expect(new Uint8Array(data)).toEqual(bytes(1, 2, 3))
  })

  it('返した中身を書き換えても元は変わらない', async () => {
    const s = source()
    new Uint8Array(await s.read('mods/jei.jar'))[0] = 99
    expect(new Uint8Array(await s.read('mods/jei.jar'))).toEqual(bytes(4))
  })

  it('ないファイルやフォルダは FileNotFoundError', async () => {
    const s = source()
    await expect(s.read('mods/none.jar')).rejects.toBeInstanceOf(FileNotFoundError)
    await expect(s.read('mods')).rejects.toBeInstanceOf(FileNotFoundError)
    await expect(s.list('resourcepacks')).rejects.toBeInstanceOf(FileNotFoundError)
  })

  it('読む関数を渡すと、読むときに呼ぶ', async () => {
    let calls = 0
    const s = new MemoryFileSource([
      [
        'a.txt',
        async () => {
          calls++
          return bytes(7).buffer
        },
      ],
    ])
    expect(calls).toBe(0)
    expect(new Uint8Array(await s.read('a.txt'))).toEqual(bytes(7))
    expect(calls).toBe(1)
  })
})

describe('fileSourceFromPickedFiles', () => {
  const picked = (path: string, value: number): PickedFile => ({
    webkitRelativePath: path,
    arrayBuffer: async () => bytes(value).buffer,
  })

  it('選んだフォルダの名前を取り除き、フォルダの中からのパスにする', async () => {
    const result = fileSourceFromPickedFiles([
      picked('All the Mods 10/mods/create.jar', 1),
      picked('All the Mods 10/config/create-server.toml', 2),
    ])
    expect(result?.name).toBe('All the Mods 10')
    expect(await result?.source.list('')).toEqual(['config/', 'mods/'])
    expect(new Uint8Array((await result?.source.read('mods/create.jar')) ?? new ArrayBuffer(0))).toEqual(bytes(1))
  })

  it('ファイルがなければ null', () => {
    expect(fileSourceFromPickedFiles([])).toBeNull()
  })

  it('File の大きさと更新時刻を stat で返す', async () => {
    const result = fileSourceFromPickedFiles([
      { ...picked('P/mods/a.jar', 1), size: 10, lastModified: 20 },
      picked('P/mods/b.jar', 2),
    ])
    expect(await result?.source.stat?.('mods/a.jar')).toEqual({ size: 10, lastModified: 20 })
    expect(await result?.source.stat?.('mods/b.jar')).toBeNull()
    await expect(result?.source.stat?.('mods/none.jar')).rejects.toThrow(FileNotFoundError)
  })
})
