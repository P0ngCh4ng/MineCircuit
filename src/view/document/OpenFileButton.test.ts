import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { blueprintFixture } from '../../../tests/fixtures/blueprintFixture'
import { createDocumentSession, provideDocumentSession, type DocumentSession } from './documentSession'
import OpenFileButton from './OpenFileButton.vue'

const dialog = vi.hoisted(() => ({ calls: 0, file: null as { name: string; arrayBuffer(): Promise<ArrayBuffer> } | null }))

vi.mock('../platform/fileAccess', () => ({
  pickDesktopBlueprintFile: async () => {
    dialog.calls++
    return dialog.file
  },
}))

type TauriMarker = { isTauri?: boolean }

function mountWith(session: DocumentSession) {
  const Host = defineComponent({
    setup() {
      provideDocumentSession(session)
      return () => h(OpenFileButton)
    },
  })
  return mount(Host)
}

describe('OpenFileButton', () => {
  afterEach(() => {
    delete (globalThis as TauriMarker).isTauri
    dialog.calls = 0
    dialog.file = null
  })

  it('ブラウザ版では <input type="file"> を開き、ダイアログは使わない', async () => {
    const wrapper = mountWith(createDocumentSession())
    const input = wrapper.find('[data-testid="open-file-input"]').element as HTMLInputElement
    const click = vi.spyOn(input, 'click')
    await wrapper.find('button').trigger('click')
    expect(click).toHaveBeenCalled()
    expect(dialog.calls).toBe(0)
  })

  it('デスクトップ版ではファイルを選ぶダイアログで選んだ設計図を開く', async () => {
    ;(globalThis as TauriMarker).isTauri = true
    const bytes = await blueprintFixture().place([0, 0, 0], 'minecraft:stone').toNbtBytes()
    dialog.file = { name: 'mill.nbt', arrayBuffer: async () => bytes.slice().buffer }
    const session = createDocumentSession()
    const wrapper = mountWith(session)
    await wrapper.find('button').trigger('click')
    await flushPromises()
    expect(dialog.calls).toBe(1)
    // gzip の展開は非同期なので、開き終わるまで待つ
    await vi.waitFor(() => expect(session.current.value?.fileName).toBe('mill.nbt'))
    expect(session.error.value).toBeNull()
  })

  it('デスクトップ版で取り消したら何もしない', async () => {
    ;(globalThis as TauriMarker).isTauri = true
    const session = createDocumentSession()
    const wrapper = mountWith(session)
    await wrapper.find('button').trigger('click')
    await flushPromises()
    expect(session.current.value).toBeNull()
    expect(session.error.value).toBeNull()
  })
})
