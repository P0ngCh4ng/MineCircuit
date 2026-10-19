import { beforeEach, describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { MemoryFileSource } from '../io/memoryFileSource'
import { ModpackRegistry, type ModpackStore, type StoredModpack } from '../io/modpack/modpackRegistry'
import ModpackPicker from './ModpackPicker.vue'
import { useModpackStore } from './stores/modpack'

const empty = new Uint8Array(0)

function profile(): MemoryFileSource {
  return new MemoryFileSource([
    ['mods/create.jar', empty],
    ['config/create-server.toml', empty],
  ])
}

class MemoryStore implements ModpackStore<FileSystemDirectoryHandle> {
  readonly items = new Map<string, StoredModpack<FileSystemDirectoryHandle>>()
  async list() {
    return [...this.items.values()]
  }
  async put(item: StoredModpack<FileSystemDirectoryHandle>) {
    this.items.set(item.id, item)
  }
  async remove(id: string) {
    this.items.delete(id)
  }
}

/** ハンドルの代わりに使う値。中身は見ない */
const fakeHandle = {} as FileSystemDirectoryHandle

function registry(store: MemoryStore | null, granted: { value: boolean }, folder = profile()) {
  let n = 0
  return new ModpackRegistry(
    store,
    {
      async open(_handle, request) {
        if (request) granted.value = true
        return granted.value ? folder : null
      },
    },
    { newId: () => `id${++n}` },
  )
}

describe('ModpackPicker', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('フォルダを選ぶ画面がないブラウザでは、次回選び直しになることを書く', async () => {
    const wrapper = mount(ModpackPicker, { props: { registry: registry(null, { value: true }), pickerSupported: false } })
    await flushPromises()
    expect(wrapper.text()).toContain('次回開いたときに選び直し')
    expect(wrapper.text()).toContain('ファイルは外部に送信しません')
  })

  it('Chrome / Edge では選び直しの注意を出さない', async () => {
    const wrapper = mount(ModpackPicker, { props: { registry: registry(null, { value: true }), pickerSupported: true } })
    await flushPromises()
    expect(wrapper.text()).not.toContain('選び直し')
  })

  it('登録したフォルダが一覧に出て、選ばれる', async () => {
    const wrapper = mount(ModpackPicker, { props: { registry: registry(null, { value: true }), pickerSupported: false } })
    await flushPromises()
    const store = useModpackStore()
    await store.register('Create Astral', profile(), null)
    await flushPromises()

    const options = wrapper.findAll('option').map((o) => o.text())
    expect(options).toEqual(['使わない', 'Create Astral（今回だけ）'])
    expect(store.status).toBe('ready')
    expect(store.source).not.toBeNull()
    expect(wrapper.text()).toContain('Mod の jar 1 個')
  })

  it('mods フォルダがなければ登録せず、どうすればよいかを書く', async () => {
    const wrapper = mount(ModpackPicker, { props: { registry: registry(null, { value: true }), pickerSupported: false } })
    await flushPromises()
    await useModpackStore().register('Instances', new MemoryFileSource([['a/mods/x.jar', empty]]), null)
    await flushPromises()
    expect(wrapper.findAll('option')).toHaveLength(1)
    expect(wrapper.text()).toContain('mods フォルダがありません')
  })

  it('次に開いたとき、前回選んだ Modpack を開く。許可が切れていれば許可を求めるボタンを出す', async () => {
    const store = new MemoryStore()
    const granted = { value: true }
    const first = mount(ModpackPicker, { props: { registry: registry(store, granted), pickerSupported: true } })
    await flushPromises()
    await useModpackStore().register('ATM10', profile(), fakeHandle)
    first.unmount()

    // ページを開き直した。許可は切れている
    setActivePinia(createPinia())
    granted.value = false
    const second = mount(ModpackPicker, { props: { registry: registry(store, granted), pickerSupported: true } })
    await flushPromises()
    const modpack = useModpackStore()
    expect(modpack.selected?.name).toBe('ATM10')
    expect(modpack.status).toBe('needs-permission')

    const button = second.findAll('button').find((b) => b.text() === 'フォルダを読む許可を出す')
    expect(button).toBeDefined()
    await button?.trigger('click')
    await flushPromises()
    expect(modpack.status).toBe('ready')
  })

  it('登録を外すと一覧から消え、選んでいない状態になる', async () => {
    const store = new MemoryStore()
    const wrapper = mount(ModpackPicker, { props: { registry: registry(store, { value: true }), pickerSupported: true } })
    await flushPromises()
    const modpack = useModpackStore()
    await modpack.register('ATM10', profile(), fakeHandle)
    await flushPromises()

    const button = wrapper.findAll('button').find((b) => b.text() === '登録を外す')
    await button?.trigger('click')
    await flushPromises()
    expect(modpack.entries).toEqual([])
    expect(modpack.selectedId).toBeNull()
    expect(modpack.source).toBeNull()
    expect(store.items.size).toBe(0)
  })
})
