import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeTauriDialog, FakeTauriFs } from '../../../tests/fixtures/fakeTauri'
import { FileNotFoundError } from '../fileSource'
import type { ModpackStore, StoredModpack } from '../modpack/modpackRegistry'

const fake = vi.hoisted(() => ({ fs: null as FakeTauriFs | null, dialog: null as FakeTauriDialog | null }))
const fs = () => {
  if (!fake.fs) throw new Error('fs を用意していません')
  return fake.fs
}
const dialog = () => {
  if (!fake.dialog) throw new Error('dialog を用意していません')
  return fake.dialog
}

vi.mock('@tauri-apps/plugin-fs', () => ({
  SeekMode: { Start: 0 },
  readDir: (p: string) => fs().readDir(p),
  readFile: (p: string) => fs().readFile(p),
  stat: (p: string) => fs().stat(p),
  open: (p: string, o: { read?: boolean }) => fs().open(p, o),
}))
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: (o: unknown) => dialog().open(o),
}))

const { createTauriGameFolderRegistry, createTauriModpackRegistry, pickTauriFolder, pickTauriGameFolder, samePath } =
  await import('./tauriModpackRegistry')

/** IndexedDB の代わり。アプリを閉じて開き直すのは、同じ store で registry を作り直すことにあたる */
class MemoryStore implements ModpackStore<string> {
  items: StoredModpack<string>[] = []
  async list() {
    return [...this.items]
  }
  async put(item: StoredModpack<string>) {
    this.items = [...this.items.filter((i) => i.id !== item.id), item]
  }
  async remove(id: string) {
    this.items = this.items.filter((i) => i.id !== id)
  }
}

const PROFILE = 'C:\\Users\\me\\curseforge\\minecraft\\Instances\\Create Astral'

beforeEach(() => {
  fake.fs = new FakeTauriFs()
  fake.dialog = new FakeTauriDialog()
  fake.fs.add(`${PROFILE}\\mods\\create.jar`, new Uint8Array([1]))
  fake.fs.add(`${PROFILE}\\config\\a.toml`, new Uint8Array([2]))
})

describe('samePath', () => {
  it('区切り・末尾の区切り・大文字小文字の違いを無視する', () => {
    expect(samePath('C:\\A\\b\\', 'c:/a/B')).toBe(true)
    expect(samePath('C:\\A\\b', 'C:\\A\\c')).toBe(false)
  })
})

describe('pickTauriFolder', () => {
  it('フォルダを選ぶ画面を、中まで読める形（recursive）で出す', async () => {
    dialog().nextOpen = PROFILE
    const picked = await pickTauriFolder()
    expect(picked?.name).toBe('Create Astral')
    expect(picked?.path).toBe(PROFILE)
    expect(dialog().openOptions[0]).toMatchObject({ directory: true, recursive: true, multiple: false })
    expect(await picked?.source.list('')).toEqual(['config/', 'mods/'])
  })

  it('取り消したら null', async () => {
    expect(await pickTauriFolder()).toBeNull()
  })
})

describe('デスクトップ版の Modpack の登録', () => {
  it('フォルダのパスで登録し、開き直しても許可を求めずに読める', async () => {
    const store = new MemoryStore()
    dialog().nextOpen = PROFILE
    const picked = await pickTauriFolder()
    if (!picked) throw new Error('選べませんでした')
    const first = createTauriModpackRegistry(store)
    const result = await first.register(picked.name, picked.source, picked.path)
    expect(result).toMatchObject({ kind: 'registered', jarCount: 1, entry: { name: 'Create Astral', persistent: true } })
    expect(store.items.map((i) => i.handle)).toEqual([PROFILE])

    // アプリを閉じて開き直す
    const second = createTauriModpackRegistry(store)
    const [entry] = await second.list()
    expect(entry).toMatchObject({ name: 'Create Astral', persistent: true })
    const opened = await second.open(entry.id, false)
    expect(opened.kind).toBe('opened')
    if (opened.kind === 'opened') expect(await opened.source.list('mods')).toEqual(['create.jar'])
    // 選ぶ画面は1回（登録のとき）だけ
    expect(dialog().openOptions).toHaveLength(1)
  })

  it('読む許可の範囲が消えていたら needs-permission。同じフォルダを選び直せば開ける', async () => {
    const store = new MemoryStore()
    await store.put({ id: 'a', name: 'Create Astral', addedAt: 1, handle: PROFILE })
    fs().allowed = []
    const registry = createTauriModpackRegistry(store)
    expect(await registry.open('a', false)).toEqual({ kind: 'needs-permission' })
    expect(dialog().openOptions).toHaveLength(0)

    // 別のフォルダを選んだら開かない
    dialog().nextOpen = 'C:\\other'
    expect(await registry.open('a', true)).toEqual({ kind: 'needs-permission' })

    // 同じフォルダを選ぶと、Tauri が範囲を足す（ここでは手で足す）
    dialog().open = async (options: unknown) => {
      dialog().openOptions.push(options)
      fs().allowed = [PROFILE]
      return `${PROFILE}\\`
    }
    const opened = await registry.open('a', true)
    expect(opened.kind).toBe('opened')
    expect(dialog().openOptions[1]).toMatchObject({ defaultPath: PROFILE, directory: true, recursive: true })
  })

  it('フォルダが消えていたら、そのパスを書いた FileNotFoundError', async () => {
    const store = new MemoryStore()
    await store.put({ id: 'a', name: 'Old', addedAt: 1, handle: 'C:\\gone' })
    const registry = createTauriModpackRegistry(store)
    await expect(registry.open('a', false)).rejects.toThrow(FileNotFoundError)
    await expect(registry.open('a', false)).rejects.toThrow(/C:\\gone/)
  })

  it('mods フォルダがなければ登録しない', async () => {
    fs().add('C:\\empty\\readme.txt', new Uint8Array([1]))
    const registry = createTauriModpackRegistry(new MemoryStore())
    dialog().nextOpen = 'C:\\empty'
    const picked = await pickTauriFolder()
    if (!picked) throw new Error('選べませんでした')
    expect(await registry.register(picked.name, picked.source, picked.path)).toMatchObject({ kind: 'invalid' })
  })
})

describe('デスクトップ版のゲームのフォルダ（Minecraft 本体の jar）', () => {
  const INSTALL = 'C:\\Users\\me\\curseforge\\minecraft\\Install'

  it('本体のフォルダを選ぶ画面で選び、パスを保存して次回も読む', async () => {
    fs().add(`${INSTALL}\\versions\\1.20.1\\1.20.1.jar`, new Uint8Array([1]))
    const store = new MemoryStore()
    dialog().nextOpen = INSTALL
    const picked = await pickTauriGameFolder()
    if (!picked) throw new Error('選べませんでした')
    expect(dialog().openOptions[0]).toMatchObject({ title: 'Minecraft 本体のフォルダを選ぶ', directory: true, recursive: true })
    const registry = createTauriGameFolderRegistry(store)
    expect(await registry.add(picked.name, picked.source, picked.path)).toMatchObject({
      kind: 'added',
      entry: { name: 'Install', persistent: true },
    })
    const [entry] = await createTauriGameFolderRegistry(store).list()
    const opened = await createTauriGameFolderRegistry(store).open(entry.id, false)
    expect(opened.kind).toBe('opened')
  })

  it('許可の範囲が消えていたら、本体のフォルダを選ぶ画面で選び直してもらう', async () => {
    const store = new MemoryStore()
    await store.put({ id: 'g', name: 'Install', addedAt: 1, handle: INSTALL })
    fs().allowed = []
    const registry = createTauriGameFolderRegistry(store)
    expect(await registry.open('g', true)).toEqual({ kind: 'needs-permission' })
    expect(dialog().openOptions[0]).toMatchObject({ title: 'Minecraft 本体のフォルダを選ぶ', defaultPath: INSTALL })
  })
})
