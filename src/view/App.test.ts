import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { markRaw } from 'vue'
import { blueprintFixture } from '../../tests/fixtures/blueprintFixture'
import { noopCalcPlugin } from '../../tests/fixtures/noopCalcPlugin'
import { InlineCalcBackend, type CalcBackend, type CalcRequest } from '../calc/calcScheduler'
import { PluginRegistry } from '../calc/pluginRegistry'
import { nbt } from '../domain/nbt'
import { eraseBlock } from '../edit/editCommand'
import { Modpack } from '../io/modpack/modpack'
import App from './App.vue'
import { createDocumentSession, DOCUMENT_SESSION_KEY, type FileLike } from './document/documentSession'
import { useCalcStore } from './stores/calcStore'
import { setModpackLoadEnvironment, useModpackContentStore } from './stores/modpackContent'
import { useToolStore } from './stores/toolStore'

function sample() {
  return blueprintFixture({ size: [3, 2, 2], name: 'line.nbt', dataVersion: 2975 })
    .place([0, 0, 0], 'create:shaft', { axis: 'x' })
    .place([1, 0, 0], 'create:creative_motor', nbt.compound({ Speed: nbt.int(64) }))
    .fill([0, 1, 0], [2, 1, 0], 'minecraft:stone')
}

function fileOf(name: string, bytes: Uint8Array): FileLike {
  return { name, arrayBuffer: async () => bytes.slice().buffer }
}

function mountApp() {
  const pinia = createPinia()
  setActivePinia(pinia)
  useCalcStore().setBackend(new InlineCalcBackend(new PluginRegistry([noopCalcPlugin()])), { delayMs: 0 })
  const session = createDocumentSession()
  const wrapper = mount(App, {
    global: { plugins: [pinia], provide: { [DOCUMENT_SESSION_KEY as symbol]: session } },
    attachTo: document.body,
  })
  return { session, wrapper }
}

function fact(wrapper: ReturnType<typeof mountApp>['wrapper'], key: string): string {
  return wrapper.get(`[data-fact="${key}"] dd`).text()
}

describe('App', () => {
  beforeEach(() => setModpackLoadEnvironment({ cache: null, scan: null }))
  afterEach(() => setModpackLoadEnvironment(null))

  it('読み込んだ Modpack を計算に渡し、変えたら計算し直す（#141）', async () => {
    const { session, wrapper } = mountApp()
    const requests: CalcRequest[] = []
    const backend: CalcBackend = {
      run: async (request) => {
        requests.push(request)
        return []
      },
    }
    useCalcStore().setBackend(backend, { delayMs: 0 })
    session.setBlueprint(sample().toBlueprint())
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    expect(requests[0]!.pack).toBeNull()

    const pack = markRaw(new Modpack([], null))
    useModpackContentStore().pack = pack
    await vi.waitFor(() => expect(requests).toHaveLength(2))
    expect(requests[1]!.pack).toBe(pack)
    wrapper.unmount()
  })

  it('非公式ツールであることと、ファイルを外部に送信しないことを表示する', () => {
    const { wrapper } = mountApp()
    expect(wrapper.text()).toContain('非公式ツールです')
    expect(wrapper.text()).toContain('外部に送信しません')
    expect(wrapper.text()).toContain('設計図（.nbt）を開いてください')
    wrapper.unmount()
  })

  it('「ファイルを開く」で選んだ .nbt を開き、上のバーに情報を出す', async () => {
    const { session, wrapper } = mountApp()
    const input = wrapper.get('[data-testid="open-file-input"]')
    expect(input.attributes('accept')).toBe('.nbt')
    Object.defineProperty(input.element, 'files', { value: [fileOf('line.nbt', await sample().toNbtBytes())] })
    await input.trigger('change')

    await vi.waitFor(() => expect(session.current.value).not.toBeNull())
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('line.nbt')
    expect(fact(wrapper, 'size')).toBe('3 × 2 × 2')
    expect(fact(wrapper, 'blocks')).toBe('5')
    expect(fact(wrapper, 'kinds')).toBe('3')
    expect(fact(wrapper, 'nbt')).toBe('1')
    expect(fact(wrapper, 'entities')).toBe('0')
    expect(fact(wrapper, 'version')).toBe('約 1.18.2（2975）')
    expect(fact(wrapper, 'edits')).toBe('変更なし')
    expect(wrapper.text()).not.toContain('設計図（.nbt）を開いてください')
    expect(useCalcStore().hasBlueprint).toBe(true)
    wrapper.unmount()
  })

  it('表示部分に落としたファイルを開く', async () => {
    const { session, wrapper } = mountApp()
    const viewport = wrapper.get('[data-testid="viewport"]')
    const file = fileOf('dropped.nbt', await sample().toNbtBytes())

    const enter = new Event('dragenter', { bubbles: true, cancelable: true })
    Object.defineProperty(enter, 'dataTransfer', { value: { types: ['Files'], files: [] } })
    viewport.element.dispatchEvent(enter)
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('ここに落として設計図を開く')

    const drop = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(drop, 'dataTransfer', { value: { types: ['Files'], files: [file] } })
    viewport.element.dispatchEvent(drop)
    expect(drop.defaultPrevented).toBe(true)

    await vi.waitFor(() => expect(session.current.value?.fileName).toBe('dropped.nbt'))
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).not.toContain('ここに落として設計図を開く')
    wrapper.unmount()
  })

  it('開けなかったときは、何が起きたかとどうすればよいかを出し、閉じられる', async () => {
    const { session, wrapper } = mountApp()
    await session.openBytes('house.schem', new Uint8Array([1]))
    await wrapper.vm.$nextTick()
    const alert = wrapper.get('[role="alert"]')
    expect(alert.text()).toContain('"house.schem" は開けない形式です')
    await alert.get('button').trigger('click')
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('元に戻す・やり直すをボタンと Ctrl+Z / Ctrl+Y で行い、ツールチップに操作の名前を出す', async () => {
    const { session, wrapper } = mountApp()
    const doc = session.setBlueprint(sample().toBlueprint())
    await wrapper.vm.$nextTick()
    const undo = wrapper.get('[data-action="undo"]')
    const redo = wrapper.get('[data-action="redo"]')
    expect(undo.attributes('disabled')).toBeDefined()
    expect(undo.attributes('title')).toBe('元に戻す操作はありません（Ctrl+Z）')

    session.apply(eraseBlock(doc.blueprint, [0, 0, 0]))
    await wrapper.vm.$nextTick()
    expect(undo.attributes('disabled')).toBeUndefined()
    expect(undo.attributes('title')).toBe('元に戻す：shaft を消す（Ctrl+Z）')
    expect(fact(wrapper, 'blocks')).toBe('4')
    expect(fact(wrapper, 'edits')).toBe('1 回の変更')

    await undo.trigger('click')
    expect(doc.blueprint.get([0, 0, 0])?.id.toString()).toBe('create:shaft')
    expect(redo.attributes('title')).toBe('やり直す：shaft を消す（Ctrl+Y）')
    expect(fact(wrapper, 'blocks')).toBe('5')

    await redo.trigger('click')
    expect(doc.blueprint.get([0, 0, 0])).toBeNull()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, cancelable: true }))
    expect(doc.blueprint.get([0, 0, 0])).not.toBeNull()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', ctrlKey: true, cancelable: true }))
    expect(doc.blueprint.get([0, 0, 0])).toBeNull()
    wrapper.unmount()
  })

  it('書き出しのボタンは上のバー1段目の設計図のグループにあり、編集のグループにはない（#151）', () => {
    const { wrapper } = mountApp()
    const fileGroup = wrapper.get('.top-bar > .row:first-child')
    expect(fileGroup.find('[data-action="export"]').exists()).toBe(true)
    expect(wrapper.get('[aria-label="編集"]').find('[data-action="export"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('別の設計図を開くと選択を消す', async () => {
    const { session, wrapper } = mountApp()
    session.setBlueprint(sample().toBlueprint())
    await wrapper.vm.$nextTick()
    const tools = useToolStore()
    tools.setSelected([0, 0, 0])
    await wrapper.vm.$nextTick()
    expect(wrapper.get('[data-status="selected"]').text()).toBe('0, 0, 0（段 1）')
    session.setBlueprint(sample().toBlueprint())
    await wrapper.vm.$nextTick()
    expect(tools.selectedPos).toBeNull()
    wrapper.unmount()
  })
})
