import { describe, expect, it } from 'vitest'
import type { FileSource } from '../fileSource'
import { MemoryFileSource } from '../memoryFileSource'
import { checkModpackFolder } from './modpackFolder'
import { ModpackRegistry, type ModpackHandleOpener, type ModpackStore, type StoredModpack } from './modpackRegistry'

const empty = new Uint8Array(0)

/** CurseForge のプロファイルのフォルダと同じ形 */
function curseForgeProfile(): MemoryFileSource {
  return new MemoryFileSource([
    ['minecraftinstance.json', empty],
    ['mods/create-1.21.1-6.0.6.jar', empty],
    ['mods/jei-1.21.1.jar', empty],
    ['mods/.index/readme.txt', empty],
    ['config/create-server.toml', empty],
  ])
}

/** テスト用のハンドル。中に FileSource を持たせる */
interface FakeHandle {
  folder: FileSource
  granted: boolean
}

class MemoryStore implements ModpackStore<FakeHandle> {
  readonly items = new Map<string, StoredModpack<FakeHandle>>()
  async list() {
    return [...this.items.values()]
  }
  async put(item: StoredModpack<FakeHandle>) {
    this.items.set(item.id, item)
  }
  async remove(id: string) {
    this.items.delete(id)
  }
}

const opener: ModpackHandleOpener<FakeHandle> = {
  async open(handle, requestPermission) {
    if (requestPermission) handle.granted = true
    return handle.granted ? handle.folder : null
  },
}

function makeRegistry(store: ModpackStore<FakeHandle> | null) {
  let n = 0
  let t = 1000
  return new ModpackRegistry(store, opener, { newId: () => `id${++n}`, now: () => t++ })
}

describe('checkModpackFolder', () => {
  it('CurseForge のプロファイルのフォルダは登録できる。jar だけを数える', async () => {
    expect(await checkModpackFolder(curseForgeProfile())).toEqual({ kind: 'ok', jarCount: 2 })
  })

  it('mods フォルダの中を選んだときは分かる', async () => {
    const mods = new MemoryFileSource([['create.jar', empty]])
    expect(await checkModpackFolder(mods)).toEqual({ kind: 'mods-folder' })
  })

  it('mods フォルダがなければ登録できない', async () => {
    const other = new MemoryFileSource([['Instances/a/mods/create.jar', empty]])
    expect(await checkModpackFolder(other)).toEqual({ kind: 'no-mods' })
  })
})

describe('ModpackRegistry', () => {
  it('ハンドルを保存した登録は、次に開いたときも一覧にあり、同じフォルダを読める', async () => {
    const store = new MemoryStore()
    const folder = curseForgeProfile()
    const result = await makeRegistry(store).register('All the Mods 10', folder, { folder, granted: true })
    expect(result.kind).toBe('registered')
    if (result.kind !== 'registered') return
    expect(result.entry).toEqual({ id: 'id1', name: 'All the Mods 10', addedAt: 1000, persistent: true })
    expect(result.jarCount).toBe(2)

    // ページを開き直した
    const next = makeRegistry(store)
    expect(await next.list()).toEqual([result.entry])
    const opened = await next.open('id1', false)
    expect(opened).toEqual({ kind: 'opened', source: folder })
  })

  it('許可が切れていれば needs-permission。許可を求めると開ける', async () => {
    const store = new MemoryStore()
    const folder = curseForgeProfile()
    const handle = { folder, granted: true }
    await makeRegistry(store).register('pack', folder, handle)
    handle.granted = false

    const next = makeRegistry(store)
    expect(await next.open('id1', false)).toEqual({ kind: 'needs-permission' })
    expect(await next.open('id1', true)).toEqual({ kind: 'opened', source: folder })
  })

  it('保存先がないときやハンドルがないときは、今回だけの登録になる', async () => {
    const folder = curseForgeProfile()
    const noStore = makeRegistry(null)
    const r1 = await noStore.register('pack', folder, { folder, granted: true })
    expect(r1.kind === 'registered' && r1.entry.persistent).toBe(false)
    expect(await noStore.open('id1', false)).toEqual({ kind: 'opened', source: folder })

    const store = new MemoryStore()
    const noHandle = makeRegistry(store)
    const r2 = await noHandle.register('pack', folder, null)
    expect(r2.kind === 'registered' && r2.entry.persistent).toBe(false)
    expect(store.items.size).toBe(0)
    expect(await noHandle.list()).toHaveLength(1)
    expect(await makeRegistry(store).list()).toEqual([])
  })

  it('mods フォルダがなければ登録しない', async () => {
    const store = new MemoryStore()
    const folder = new MemoryFileSource([['readme.txt', empty]])
    const registry = makeRegistry(store)
    expect(await registry.register('x', folder, { folder, granted: true })).toEqual({
      kind: 'invalid',
      check: { kind: 'no-mods' },
    })
    expect(await registry.list()).toEqual([])
  })

  it('一覧は登録した順。登録を外すと消える', async () => {
    const store = new MemoryStore()
    const registry = makeRegistry(store)
    const folder = curseForgeProfile()
    await registry.register('A', folder, { folder, granted: true })
    await registry.register('B', folder, null)
    await registry.register('C', folder, { folder, granted: true })
    expect((await registry.list()).map((e) => e.name)).toEqual(['A', 'B', 'C'])

    await registry.remove('id1')
    await registry.remove('id2')
    expect((await registry.list()).map((e) => e.name)).toEqual(['C'])
    expect(await registry.open('id1', true)).toEqual({ kind: 'not-registered' })
  })
})
