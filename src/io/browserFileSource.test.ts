import { afterEach, describe, expect, it } from 'vitest'
import { BrowserFileSource, ensureReadPermission, pickDirectory, supportsDirectoryPicker } from './browserFileSource'
import { FileNotFoundError } from './fileSource'

// File System Access API のハンドルの代わり。テストで使う部分だけ作る
type FakeTree = { [name: string]: FakeTree | Uint8Array }

function notFound(): DOMException {
  return new DOMException('not found', 'NotFoundError')
}

function fakeDirectory(name: string, tree: FakeTree): FileSystemDirectoryHandle {
  const handle = {
    kind: 'directory',
    name,
    async getDirectoryHandle(child: string) {
      const node = tree[child]
      if (node === undefined) throw notFound()
      if (node instanceof Uint8Array) throw new DOMException('type mismatch', 'TypeMismatchError')
      return fakeDirectory(child, node)
    },
    async getFileHandle(child: string) {
      const node = tree[child]
      if (node === undefined) throw notFound()
      if (!(node instanceof Uint8Array)) throw new DOMException('type mismatch', 'TypeMismatchError')
      return { kind: 'file', name: child, getFile: async () => new File([node.slice()], child) }
    },
    async *entries() {
      for (const [child, node] of Object.entries(tree)) {
        yield [child, { kind: node instanceof Uint8Array ? 'file' : 'directory', name: child }]
      }
    },
  }
  return handle as unknown as FileSystemDirectoryHandle
}

const profile = () =>
  fakeDirectory('Create Astral', {
    mods: { 'create.jar': new Uint8Array([1, 2]), 'jei.jar': new Uint8Array([3]) },
    config: { 'create-common.toml': new Uint8Array([4]) },
    'minecraftinstance.json': new Uint8Array([5]),
  })

describe('BrowserFileSource', () => {
  it('フォルダの中の名前を返し、フォルダには / を付ける', async () => {
    const s = new BrowserFileSource(profile())
    expect(await s.list('')).toEqual(['config/', 'minecraftinstance.json', 'mods/'])
    expect(await s.list('mods')).toEqual(['create.jar', 'jei.jar'])
  })

  it('ファイルの中身を返す', async () => {
    const s = new BrowserFileSource(profile())
    expect(new Uint8Array(await s.read('mods/create.jar'))).toEqual(new Uint8Array([1, 2]))
  })

  it('ないものは FileNotFoundError', async () => {
    const s = new BrowserFileSource(profile())
    await expect(s.read('mods/none.jar')).rejects.toBeInstanceOf(FileNotFoundError)
    await expect(s.read('none/a.jar')).rejects.toBeInstanceOf(FileNotFoundError)
    await expect(s.read('mods')).rejects.toBeInstanceOf(FileNotFoundError)
    await expect(s.list('none')).rejects.toBeInstanceOf(FileNotFoundError)
    await expect(s.list('minecraftinstance.json')).rejects.toBeInstanceOf(FileNotFoundError)
  })
})

describe('ensureReadPermission', () => {
  function withPermission(initial: PermissionState, afterRequest: PermissionState) {
    let requested = false
    const handle = {
      queryPermission: async () => initial,
      requestPermission: async () => {
        requested = true
        return afterRequest
      },
    } as unknown as FileSystemHandle
    return { handle, wasRequested: () => requested }
  }

  it('許可があれば求めない', async () => {
    const h = withPermission('granted', 'denied')
    expect(await ensureReadPermission(h.handle, true)).toBe(true)
    expect(h.wasRequested()).toBe(false)
  })

  it('request が false なら求めない', async () => {
    const h = withPermission('prompt', 'granted')
    expect(await ensureReadPermission(h.handle, false)).toBe(false)
    expect(h.wasRequested()).toBe(false)
  })

  it('request が true なら求め、その結果を返す', async () => {
    const granted = withPermission('prompt', 'granted')
    expect(await ensureReadPermission(granted.handle, true)).toBe(true)
    const denied = withPermission('prompt', 'denied')
    expect(await ensureReadPermission(denied.handle, true)).toBe(false)
  })
})

describe('pickDirectory', () => {
  const w = window as unknown as { showDirectoryPicker?: unknown }

  afterEach(() => {
    delete w.showDirectoryPicker
  })

  it('画面がなければ対応していない', () => {
    delete w.showDirectoryPicker
    expect(supportsDirectoryPicker()).toBe(false)
  })

  it('選んだフォルダのハンドルを返す', async () => {
    const handle = profile()
    w.showDirectoryPicker = async () => handle
    expect(supportsDirectoryPicker()).toBe(true)
    expect(await pickDirectory()).toBe(handle)
  })

  it('取り消したら null', async () => {
    w.showDirectoryPicker = async () => {
      throw new DOMException('cancelled', 'AbortError')
    }
    expect(await pickDirectory()).toBeNull()
  })
})
