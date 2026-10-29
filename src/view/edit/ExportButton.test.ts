import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h } from 'vue'
import { blueprintFixture, state } from '../../../tests/fixtures/blueprintFixture'
import { nbt } from '../../domain/nbt'
import { placeBlock } from '../../edit/editCommand'
import type { FileSink } from '../../io/fileSink'
import { MemoryFileSink } from '../../io/memoryFileSink'
import { BlueprintWriteError } from '../../io/writers/blueprintWriter'
import { readBlueprint } from '../../io/readers/readBlueprint'
import { createDocumentSession, provideDocumentSession, type DocumentSession } from '../document/documentSession'
import { setModpackLoadEnvironment } from '../stores/modpackContent'
import ExportButton from './ExportButton.vue'
import { exportErrorMessage, exportNotices, exportResultMessage, missingBlockEntityNotice } from './exportMessages'

function mountWith(session: DocumentSession, sink: FileSink) {
  const Host = defineComponent({
    setup() {
      provideDocumentSession(session)
      return () => h(ExportButton, { createSink: () => sink })
    },
  })
  return mount(Host)
}

const motorNbt = () => nbt.compound({ Speed: nbt.int(16) })

/**
 * sink.save が終わると解決する Promise を付ける。
 * 書き出しは gzip の圧縮と、確かめのための展開（CompressionStream / DecompressionStream）を挟み、
 * これは Node の別スレッドで動くので、決まった時間を待つと重いときに間に合わない。保存が終わるのを待つ。
 */
function watchSave(sink: FileSink): { sink: FileSink; saved: Promise<void> } {
  let done: () => void = () => {}
  const saved = new Promise<void>((resolve) => {
    done = resolve
  })
  return {
    sink: {
      save: async (name, data) => {
        try {
          return await sink.save(name, data)
        } finally {
          done()
        }
      },
    },
    saved,
  }
}

describe('ExportButton', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    setModpackLoadEnvironment({ cache: null, scan: null })
  })

  afterEach(() => {
    setModpackLoadEnvironment(null)
  })

  it('設計図がなければ押せない', () => {
    const wrapper = mountWith(createDocumentSession(), new MemoryFileSink())
    expect(wrapper.find('[data-action="export"]').attributes('disabled')).toBeDefined()
  })

  it('お知らせがなければ、そのまま書き出して結果を出す', async () => {
    const session = createDocumentSession()
    session.setBlueprint(blueprintFixture({ size: [2, 1, 1], name: 'mill.nbt' }).place([0, 0, 0], 'minecraft:stone').toBlueprint())
    const sink = new MemoryFileSink()
    const { sink: watched, saved } = watchSave(sink)
    const wrapper = mountWith(session, watched)

    await wrapper.find('[data-action="export"]').trigger('click')
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    await saved
    await flushPromises()

    const bytes = sink.files.get('mill.nbt')
    expect(bytes).toBeDefined()
    const reread = await readBlueprint('mill.nbt', bytes ?? new Uint8Array())
    expect(reread.get([0, 0, 0])?.id.toString()).toBe('minecraft:stone')
    expect(wrapper.find('[data-testid="export-message"]').text()).toContain('"mill.nbt"')
    expect(wrapper.find('[data-testid="export-message"]').text()).toContain('を書き出しました。')
  })

  it('書き出すと「書き出してからの変更」が 0 に戻る。やめたときは戻らない', async () => {
    const session = createDocumentSession()
    const doc = session.setBlueprint(blueprintFixture({ size: [2, 1, 1], name: 'mill.nbt' }).toBlueprint())
    session.apply(placeBlock(doc.blueprint, [0, 0, 0], state('minecraft:stone'), false))
    expect(session.unsavedChanges.value).toBe(1)

    const cancelling = new MemoryFileSink()
    cancelling.cancel = true
    const first = watchSave(cancelling)
    const cancelled = mountWith(session, first.sink)
    await cancelled.find('[data-action="export"]').trigger('click')
    await first.saved
    await flushPromises()
    expect(session.unsavedChanges.value).toBe(1)
    cancelled.unmount()

    const second = watchSave(new MemoryFileSink())
    const wrapper = mountWith(session, second.sink)
    await wrapper.find('[data-action="export"]').trigger('click')
    await second.saved
    await flushPromises()
    expect(session.unsavedChanges.value).toBe(0)
  })

  it('生データのないブロックがあれば、確かめてから書き出す', async () => {
    const session = createDocumentSession()
    session.setBlueprint(
      blueprintFixture({ size: [2, 1, 1], name: 'm.nbt' })
        .place([0, 0, 0], 'create:creative_motor', motorNbt())
        .place([1, 0, 0], 'create:creative_motor')
        .toBlueprint(),
    )
    const sink = new MemoryFileSink()
    const { sink: watched, saved } = watchSave(sink)
    const wrapper = mountWith(session, watched)

    await wrapper.find('[data-action="export"]').trigger('click')
    const dialog = wrapper.find('[role="dialog"]')
    expect(dialog.exists()).toBe(true)
    expect(dialog.text()).toContain('生データ（nbt）のないブロックが 1 個あります：create:creative_motor（1 個）')

    // やめると保存しない
    await wrapper.find('[role="dialog"] button:not([data-action])').trigger('click')
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    expect(sink.files.size).toBe(0)

    await wrapper.find('[data-action="export"]').trigger('click')
    await wrapper.find('[data-action="confirm-export"]').trigger('click')
    await saved
    await flushPromises()
    expect(sink.files.has('m.nbt')).toBe(true)
  })

  it('保存できなければ、何が起きたかを出す', async () => {
    const session = createDocumentSession()
    session.setBlueprint(blueprintFixture({ size: [1, 1, 1] }).toBlueprint())
    const { sink: failing, saved } = watchSave({
      save: async () => {
        throw new Error('ディスクがいっぱいです')
      },
    })
    const wrapper = mountWith(session, failing)
    await wrapper.find('[data-action="export"]').trigger('click')
    await saved
    await flushPromises()
    const msg = wrapper.find('[data-testid="export-message"]')
    expect(msg.attributes('role')).toBe('alert')
    expect(msg.text()).toContain('書き出せませんでした（ディスクがいっぱいです）')
  })
})

describe('exportMessages', () => {
  it('生データのないブロックは多い順に5種類まで書く', () => {
    const missing = ['a', 'b', 'c', 'd', 'e', 'f'].map((id, i) => ({ id: `m:${id}`, count: 6 - i }))
    const text = missingBlockEntityNotice({
      blockCount: 30,
      stateCount: 6,
      blockEntityCount: 6,
      missingBlockEntityCount: 21,
      missingBlockEntities: missing,
    })
    expect(text).toContain('21 個あります：m:a（6 個）、m:b（5 個）、m:c（4 個）、m:d（3 個）、m:e（2 個）、ほか 1 種類。')
  })

  it('お知らせがなければ空', () => {
    const summary = { blockCount: 1, stateCount: 1, blockEntityCount: 0, missingBlockEntityCount: 0, missingBlockEntities: [] }
    expect(missingBlockEntityNotice(summary)).toBeNull()
    expect(exportNotices(summary, null)).toEqual([])
    expect(exportNotices(summary, '足りない')).toEqual(['足りない'])
  })

  it('結果とエラーの文', () => {
    expect(exportResultMessage({ status: 'cancelled', fileName: 'a.nbt', byteLength: 10 })).toBe(
      '書き出しをやめました。ファイルは保存していません。',
    )
    expect(exportResultMessage({ status: 'saved', fileName: 'a.nbt', byteLength: 3000 })).toBe('"a.nbt"（3 KB）を書き出しました。')
    expect(exportErrorMessage(new BlueprintWriteError('一致しませんでした。'))).toBe('一致しませんでした。')
  })
})
