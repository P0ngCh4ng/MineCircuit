import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { strToU8 } from 'fflate'
import { fakeJar } from '../../tests/fixtures/fakeJar'
import { MemoryFileSource } from '../io/memoryFileSource'
import { ModpackRegistry } from '../io/modpack/modpackRegistry'
import ModpackLoadStatus from './ModpackLoadStatus.vue'
import { useModpackStore } from './stores/modpack'
import { setModpackLoadEnvironment, useModpackContentStore } from './stores/modpackContent'

function folder(): MemoryFileSource {
  return new MemoryFileSource([
    [
      'mods/gears.jar',
      fakeJar({
        forgeMods: [{ modId: 'gears', displayName: 'Gears', version: '1' }],
        lang: { gears: { ja_jp: { 'block.gears.gear': 'テスト歯車' }, en_us: { 'block.gears.gear': 'Gear', 'block.gears.big': 'Big' } } },
      }),
    ],
    ['mods/broken.jar', strToU8('not a zip')],
  ])
}

function registry(): ModpackRegistry<FileSystemDirectoryHandle> {
  let n = 0
  return new ModpackRegistry<FileSystemDirectoryHandle>(null, { open: async () => null }, { newId: () => `id${++n}` })
}

describe('ModpackLoadStatus と useModpackContentStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    // Worker と IndexedDB を使わず、その場で読む
    setModpackLoadEnvironment({ cache: null, scan: null })
  })

  afterEach(() => {
    setModpackLoadEnvironment(null)
  })

  it('Modpack を選ぶと jar を読み、表示名を日本語 → 英語の順で返す', async () => {
    const modpack = useModpackStore()
    const content = useModpackContentStore()
    const wrapper = mount(ModpackLoadStatus)
    expect(content.phase).toBe('idle')
    expect(wrapper.text()).toBe('')

    await modpack.init(registry())
    await modpack.register('Test', folder(), null)
    await flushPromises()

    expect(content.phase).toBe('loaded')
    expect(content.displayName('gears:gear')).toBe('テスト歯車')
    expect(content.displayName('gears:big')).toBe('Big')
    expect(content.displayName('gears:none')).toBeNull()
    expect(content.displayName('bad:id:x')).toBeNull()
    expect(wrapper.text()).toContain('Mod 1 個（jar 1 個）を読みました')
    expect(wrapper.text()).toContain('読めなかったファイルが 1 個あります')

    await modpack.select(null)
    await flushPromises()
    expect(content.phase).toBe('idle')
    expect(content.pack).toBeNull()
    expect(content.displayName('gears:gear')).toBeNull()
  })

  it('mods/ を読めなければエラーを出す', async () => {
    const modpack = useModpackStore()
    const content = useModpackContentStore()
    const wrapper = mount(ModpackLoadStatus)
    await modpack.init(registry())
    // 登録のときの確認を通すため、確認のあとで読めなくする
    const source = new MemoryFileSource([['mods/a.jar', fakeJar()]])
    await modpack.register('Test', source, null)
    await flushPromises()
    expect(content.phase).toBe('loaded')

    source.list = async () => {
      throw new Error('読めない')
    }
    await content.reload()
    await flushPromises()
    expect(content.phase).toBe('error')
    expect(wrapper.text()).toContain('Mod の jar を読めませんでした（読めない）')
  })
})
