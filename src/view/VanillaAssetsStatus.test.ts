import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { strToU8 } from 'fflate'
import { fakeAssetIndexFiles, fakeClientJar, fakeVersionJson } from '../../tests/fixtures/fakeGameFolder'
import { fakeJar } from '../../tests/fixtures/fakeJar'
import type { FileSource } from '../io/fileSource'
import { MemoryFileSource } from '../io/memoryFileSource'
import { GameFolderRegistry } from '../io/modpack/gameFolderRegistry'
import { ModpackRegistry, type ModpackStore, type StoredModpack } from '../io/modpack/modpackRegistry'
import type { DesktopGameFolders } from './platform/fileAccess'
import { useGameFolderStore } from './stores/gameFolders'
import { useModpackStore } from './stores/modpack'
import { setModpackLoadEnvironment, useModpackContentStore } from './stores/modpackContent'
import VanillaAssetsStatus from './VanillaAssetsStatus.vue'

class MemoryStore<H> implements ModpackStore<H> {
  readonly items = new Map<string, StoredModpack<H>>()
  async list() {
    return [...this.items.values()]
  }
  async put(item: StoredModpack<H>) {
    this.items.set(item.id, item)
  }
  async remove(id: string) {
    this.items.delete(id)
  }
}

/** CurseForge のプロファイルのフォルダ（本体の jar はない） */
function instance(): MemoryFileSource {
  return new MemoryFileSource([
    ['mods/gears.jar', fakeJar({ forgeMods: [{ modId: 'gears', version: '1.0' }] })],
    ['minecraftinstance.json', strToU8(JSON.stringify({ gameVersion: '1.20.1' }))],
  ])
}

/** CurseForge の Install のフォルダ */
function install(): MemoryFileSource {
  return new MemoryFileSource([
    ['versions/1.20.1/1.20.1.jar', fakeClientJar()],
    ['versions/1.20.1/1.20.1.json', fakeVersionJson('1.20.1', '5')],
    ...fakeAssetIndexFiles('5', { 'block.minecraft.stone': '石' }),
  ])
}

function gameRegistry(store: MemoryStore<string>, sources: Map<string, FileSource>, granted: { value: boolean }) {
  let n = 0
  return new GameFolderRegistry<string>(
    store,
    {
      async open(path, request) {
        if (request) granted.value = true
        return granted.value ? (sources.get(path) ?? null) : null
      },
    },
    { newId: () => `g${++n}` },
  )
}

async function openModpack(source: FileSource): Promise<void> {
  const modpack = useModpackStore()
  await modpack.init(new ModpackRegistry<FileSystemDirectoryHandle>(null, { open: async () => null }))
  await modpack.register('ATM', source, null)
  await flushPromises()
}

describe('VanillaAssetsStatus', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    setModpackLoadEnvironment({ cache: null, scan: null })
  })

  afterEach(() => {
    setModpackLoadEnvironment(null)
  })

  it('本体の jar がなければ知らせ、選んだフォルダから読み直す', async () => {
    const store = new MemoryStore<string>()
    const sources = new Map<string, FileSource>([['C:\\curseforge\\minecraft\\Install', install()]])
    const desktopFolders: DesktopGameFolders = {
      registry: gameRegistry(store, sources, { value: true }),
      pickFolder: async () => ({ name: 'Install', source: install(), handle: 'C:\\curseforge\\minecraft\\Install' }),
    }
    const wrapper = mount(VanillaAssetsStatus, { props: { desktopFolders } })
    await openModpack(instance())
    const content = useModpackContentStore()

    expect(wrapper.text()).toContain('Minecraft 本体（1.20.1）の jar が見つかりません')
    expect(content.displayName('minecraft:stone')).toBeNull()

    await wrapper.get('button').trigger('click')
    await flushPromises()

    expect(store.items.size).toBe(1)
    expect(content.pack?.vanilla).toMatchObject({ kind: 'found', where: 'Install', jaJp: true })
    expect(content.displayName('minecraft:stone')).toBe('石')
    expect(wrapper.text()).toContain('Minecraft 本体（1.20.1）の jar を読みました（Install）')
    expect(wrapper.text()).not.toContain('日本語の名前は見つからなかった')
  })

  it('保存したフォルダは次回も読み、許可が切れていればボタンで出し直す', async () => {
    const store = new MemoryStore<string>()
    store.items.set('g1', { id: 'g1', name: 'Install', addedAt: 1, handle: 'P' })
    const granted = { value: false }
    const registry = gameRegistry(store, new Map([['P', install()]]), granted)
    const desktopFolders: DesktopGameFolders = { registry, pickFolder: async () => null }
    const wrapper = mount(VanillaAssetsStatus, { props: { desktopFolders } })
    await openModpack(instance())

    expect(wrapper.text()).toMatch(/Install\s*（許可が必要）/)
    const grant = wrapper.findAll('button').find((b) => b.text() === '本体のフォルダを読む許可を出す')
    expect(grant).toBeDefined()
    await grant!.trigger('click')
    await flushPromises()

    expect(useModpackContentStore().displayName('minecraft:stone')).toBe('石')
    expect(wrapper.text()).not.toContain('許可が必要')
  })

  it('ゲームのフォルダでないものは足さず、理由を出す', async () => {
    const store = new MemoryStore<string>()
    const desktopFolders: DesktopGameFolders = {
      registry: gameRegistry(store, new Map(), { value: true }),
      pickFolder: async () => ({ name: 'Downloads', source: new MemoryFileSource([['a.txt', strToU8('x')]]), handle: 'D' }),
    }
    const wrapper = mount(VanillaAssetsStatus, { props: { desktopFolders } })
    await openModpack(instance())
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(store.items.size).toBe(0)
    expect(wrapper.text()).toContain('versions・libraries・assets のフォルダも jar もありません')
  })

  it('外すと一覧から消え、本体の jar を読まなくなる', async () => {
    const store = new MemoryStore<string>()
    store.items.set('g1', { id: 'g1', name: 'Install', addedAt: 1, handle: 'P' })
    const registry = gameRegistry(store, new Map([['P', install()]]), { value: true })
    const wrapper = mount(VanillaAssetsStatus, { props: { desktopFolders: { registry, pickFolder: async () => null } } })
    await openModpack(instance())
    expect(useModpackContentStore().pack?.vanilla?.kind).toBe('found')

    const remove = wrapper.findAll('button').find((b) => b.text() === '外す')
    await remove!.trigger('click')
    await flushPromises()
    expect(store.items.size).toBe(0)
    expect(useGameFolderStore().folders).toEqual([])
    expect(useModpackContentStore().pack?.vanilla?.kind).toBe('missing')
  })
})
