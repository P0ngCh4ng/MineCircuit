import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { blueprintFixture } from '../../../tests/fixtures/blueprintFixture'
import { createDocumentSession, DOCUMENT_SESSION_KEY, type DocumentSession } from '../document/documentSession'
import { BUILD_CHECKLIST_KEY } from '../stores/buildChecklistStore'
import { useLayerStore } from '../stores/layerStore'
import BuildChecklist from './BuildChecklist.vue'
import LayerPanel from './LayerPanel.vue'

/** 高さ 3。段 1 に石 3 と木 1、段 2 は空、段 3 に木 2 */
function blueprint() {
  return blueprintFixture({ size: [3, 3, 2] })
    .fill([0, 0, 0], [2, 0, 0], 'minecraft:stone')
    .place([0, 0, 1], 'minecraft:oak_planks')
    .place([0, 2, 0], 'minecraft:oak_planks')
    .place([1, 2, 0], 'minecraft:oak_planks')
    .toBlueprint()
}

function open(fileName = 'tower.nbt'): DocumentSession {
  const session = createDocumentSession()
  session.setBlueprint(blueprint(), fileName)
  return session
}

function mountChecklist(session: DocumentSession, print: () => void = () => {}) {
  return mount(BuildChecklist, {
    attachTo: document.body,
    props: { print },
    global: { provide: { [DOCUMENT_SESSION_KEY as symbol]: session } },
  })
}

function items(wrapper: ReturnType<typeof mountChecklist>) {
  return wrapper.findAll('.items li').map((li) => [li.attributes('data-id'), li.find('.count').text()])
}

describe('建築チェックリスト', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('設計図がなければお知らせだけを出し、印刷は押せない', () => {
    const wrapper = mountChecklist(createDocumentSession())
    expect(wrapper.text()).toContain('設計図を開くと')
    expect(wrapper.get('[data-action="print-checklist"]').attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })

  it('今の段に要るブロックと数、合計、進み具合を出す。Mod の名前は出さない', () => {
    const wrapper = mountChecklist(open())
    expect(items(wrapper)).toEqual([
      ['minecraft:stone', '3'],
      ['minecraft:oak_planks', '1'],
    ])
    expect(wrapper.text()).toContain('段 1：2 種類・4 個')
    expect(wrapper.get('[data-testid="checklist-progress"]').text()).toBe('建てた段 0 / 2・0 / 6 個')
    expect(wrapper.text()).not.toMatch(/Create/i)
    wrapper.unmount()
  })

  it('チェックを付けると記録して次の段へ進み、外すと戻る', async () => {
    const wrapper = mountChecklist(open())
    const layers = useLayerStore()
    await wrapper.get('[data-action="toggle-layer-done"]').setValue(true)
    expect(layers.current).toBe(1)
    expect(wrapper.get('[data-testid="checklist-progress"]').text()).toBe('建てた段 1 / 2・4 / 6 個')
    // 空の段はチェックできない
    expect(wrapper.text()).toContain('段 2 にブロックはありません')
    expect(wrapper.get('[data-action="toggle-layer-done"]').attributes('disabled')).toBeDefined()
    // 押した印が次の段に残らない
    expect(wrapper.get<HTMLInputElement>('[data-action="toggle-layer-done"]').element.checked).toBe(false)

    await wrapper.get('[data-action="checklist-down"]').trigger('click')
    expect(layers.current).toBe(0)
    const box = wrapper.get<HTMLInputElement>('[data-action="toggle-layer-done"]')
    expect(box.element.checked).toBe(true)
    expect(wrapper.get('.items').classes()).toContain('finished')
    await box.setValue(false)
    expect(layers.current).toBe(0)
    expect(wrapper.get('[data-testid="checklist-progress"]').text()).toBe('建てた段 0 / 2・0 / 6 個')
    wrapper.unmount()
  })

  it('前の段・次の段は、端では押せない', async () => {
    const wrapper = mountChecklist(open())
    expect(wrapper.get('[data-action="checklist-down"]').attributes('disabled')).toBeDefined()
    await wrapper.get('[data-action="checklist-up"]').trigger('click')
    await wrapper.get('[data-action="checklist-up"]').trigger('click')
    expect(useLayerStore().current).toBe(2)
    expect(wrapper.get('[data-action="checklist-up"]').attributes('disabled')).toBeDefined()
    expect(items(wrapper)).toEqual([['minecraft:oak_planks', '2']])
    wrapper.unmount()
  })

  it('チェックはブラウザ内に設計図ごとに保存し、同じ名前・大きさで開き直すと戻る。設計図のファイルには書かない', async () => {
    const session = open()
    const wrapper = mountChecklist(session)
    await wrapper.get('[data-action="toggle-layer-done"]').setValue(true)
    wrapper.unmount()
    expect(JSON.parse(localStorage.getItem(BUILD_CHECKLIST_KEY) ?? '')).toEqual({
      version: 1,
      entries: [['tower.nbt|3x3x2', [0]]],
    })
    expect(session.unsavedChanges.value).toBe(0)

    // 新しく始めたアプリ（ストアを作り直す）
    setActivePinia(createPinia())
    const again = mountChecklist(open())
    expect(again.get('[data-testid="checklist-progress"]').text()).toBe('建てた段 1 / 2・4 / 6 個')
    again.unmount()

    const other = mountChecklist(open('other.nbt'))
    expect(other.get('[data-testid="checklist-progress"]').text()).toBe('建てた段 0 / 2・0 / 6 個')
    other.unmount()
  })

  it('「チェックを外す」でこの設計図のチェックをすべて外す', async () => {
    const wrapper = mountChecklist(open())
    expect(wrapper.find('[data-action="clear-checklist"]').exists()).toBe(false)
    await wrapper.get('[data-action="toggle-layer-done"]').setValue(true)
    await wrapper.get('[data-action="clear-checklist"]').trigger('click')
    expect(wrapper.get('[data-testid="checklist-progress"]').text()).toBe('建てた段 0 / 2・0 / 6 個')
    expect(wrapper.find('[data-action="clear-checklist"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('印刷は、ブロックのある段の表を出してから印刷し、終わったら表を消す', async () => {
    let sheet: { layers: (string | undefined)[]; captions: string[]; rows: number } | null = null
    const print = vi.fn(() => {
      const el = document.body.querySelector('[data-testid="checklist-print"]')
      sheet = el && {
        layers: [...el.querySelectorAll('table')].map((t) => t.getAttribute('data-layer') ?? undefined),
        captions: [...el.querySelectorAll('caption')].map((c) => c.textContent?.trim() ?? ''),
        rows: el.querySelectorAll('tbody tr').length,
      }
    })
    const wrapper = mountChecklist(open(), print)
    await wrapper.get('[data-action="toggle-layer-done"]').setValue(true)
    await wrapper.get('[data-action="print-checklist"]').trigger('click')
    await nextTick()
    expect(print).toHaveBeenCalledTimes(1)
    expect(sheet).toEqual({
      layers: ['0', '2'],
      captions: ['☑ 段 1（Y=0）・4 個', '☐ 段 3（Y=2）・2 個'],
      rows: 3,
    })
    expect(document.body.querySelector('[data-testid="checklist-print"]')).toBeNull()
    wrapper.unmount()
  })

  it('段の一覧で、建て終えた段に印を出す', async () => {
    const session = open()
    const checklist = mountChecklist(session)
    const panel = mount(LayerPanel, { global: { provide: { [DOCUMENT_SESSION_KEY as symbol]: session } } })
    expect(panel.find('.built').exists()).toBe(false)
    await checklist.get('[data-action="toggle-layer-done"]').setValue(true)
    expect(panel.findAll('li[data-layer="0"] .built')).toHaveLength(1)
    expect(panel.findAll('.built')).toHaveLength(1)
    panel.unmount()
    checklist.unmount()
  })
})
