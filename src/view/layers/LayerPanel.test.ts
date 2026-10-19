import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { blueprintFixture } from '../../../tests/fixtures/blueprintFixture'
import { createDocumentSession, DOCUMENT_SESSION_KEY, type DocumentSession } from '../document/documentSession'
import ViewControls from '../shell/ViewControls.vue'
import { useLayerStore } from '../stores/layerStore'
import { useViewStore } from '../stores/viewStore'
import LayerPanel from './LayerPanel.vue'

/** 高さ 3。段 1 に 3 個、段 2 に 1 個、段 3 は空 */
function blueprint() {
  return blueprintFixture({ size: [3, 3, 1] })
    .fill([0, 0, 0], [2, 0, 0], 'minecraft:stone')
    .place([1, 1, 0], 'create:shaft', { axis: 'y' })
    .toBlueprint()
}

function mountPanel(session: DocumentSession) {
  return mount(LayerPanel, {
    attachTo: document.body,
    global: { provide: { [DOCUMENT_SESSION_KEY as symbol]: session } },
  })
}

function mountControls(session: DocumentSession) {
  return mount(ViewControls, { global: { provide: { [DOCUMENT_SESSION_KEY as symbol]: session } } })
}

function rows(wrapper: ReturnType<typeof mountPanel>) {
  return wrapper.findAll('li').map((li) => ({
    layer: li.find('.pick b').text(),
    count: li.find('.pick span').text(),
    current: li.attributes('aria-current') === 'true',
    visible: li.find('.eye').attributes('aria-pressed') === 'true',
  }))
}

function press(key: string) {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, cancelable: true }))
}

describe('段の一覧と段の移動', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('設計図がなければ、段を出さずにお知らせを出す', () => {
    const wrapper = mountPanel(createDocumentSession())
    expect(wrapper.findAll('li')).toHaveLength(0)
    expect(wrapper.text()).toContain('設計図を開くと')
    expect(wrapper.get('[data-action="solo"]').attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })

  it('段ごとのブロック数を、上の段から 1 始まりで出す', () => {
    const session = createDocumentSession()
    session.setBlueprint(blueprint())
    const wrapper = mountPanel(session)
    expect(rows(wrapper)).toEqual([
      { layer: '3', count: '0', current: false, visible: true },
      { layer: '2', count: '1', current: false, visible: true },
      { layer: '1', count: '3', current: true, visible: true },
    ])
    wrapper.unmount()
  })

  it('段を押すと今の段にし、丸で表示・非表示を切り替える', async () => {
    const session = createDocumentSession()
    session.setBlueprint(blueprint())
    const wrapper = mountPanel(session)
    const view = useViewStore()
    await wrapper.get('li[data-layer="1"] .pick').trigger('click')
    expect(useLayerStore().current).toBe(1)
    expect(view.layerDisplay.layer).toBe(1)

    await wrapper.get('li[data-layer="0"] .eye').trigger('click')
    expect([...view.hiddenLayers]).toEqual([0])
    expect(wrapper.get('li[data-layer="0"]').classes()).toContain('off')
    expect(wrapper.get('li[data-layer="0"] .eye').attributes('aria-label')).toBe('段 1 を表示する')
    await wrapper.get('li[data-layer="0"] .eye').trigger('click')
    expect(view.hiddenLayers.size).toBe(0)
    wrapper.unmount()
  })

  it('「この段だけ表示」はほかの段を隠し、「すべて表示」で元に戻す', async () => {
    const session = createDocumentSession()
    session.setBlueprint(blueprint())
    const wrapper = mountPanel(session)
    const view = useViewStore()
    useLayerStore().setLayer(1)
    expect(wrapper.get('[data-action="show-all"]').attributes('disabled')).toBeDefined()
    await wrapper.get('[data-action="solo"]').trigger('click')
    expect([...view.hiddenLayers].sort()).toEqual([0, 2])
    view.setLayerMode('ghostAbove')
    await nextTick()
    await wrapper.get('[data-action="show-all"]').trigger('click')
    expect(view.hiddenLayers.size).toBe(0)
    expect(view.layerMode).toBe('all')
    wrapper.unmount()
  })

  it('PageUp / PageDown で段を動かし、設計図の高さの外へは出ない', async () => {
    const session = createDocumentSession()
    session.setBlueprint(blueprint())
    const wrapper = mountPanel(session)
    const layers = useLayerStore()
    press('PageUp')
    press('PageUp')
    press('PageUp')
    expect(layers.current).toBe(2)
    press('PageDown')
    expect(layers.current).toBe(1)
    press('PageDown')
    press('PageDown')
    expect(layers.current).toBe(0)
    wrapper.unmount()
    // 外したあとはキーを受け取らない
    press('PageUp')
    expect(layers.current).toBe(0)
  })

  it('別の設計図を開くと、非表示を消し、今の段を高さに収める', async () => {
    const session = createDocumentSession()
    session.setBlueprint(blueprint())
    const wrapper = mountPanel(session)
    const view = useViewStore()
    useLayerStore().setLayer(2)
    view.setLayerHidden(1, true)
    session.setBlueprint(blueprintFixture({ size: [2, 2, 2] }).toBlueprint())
    await nextTick()
    expect(view.hiddenLayers.size).toBe(0)
    expect(useLayerStore().current).toBe(1)
    wrapper.unmount()
  })

  it('上のバーの ▲▼ で段を動かし、表示方法を選ぶ', async () => {
    const session = createDocumentSession()
    session.setBlueprint(blueprint())
    const controls = mountControls(session)
    const view = useViewStore()
    expect(controls.get('[data-testid="layer-current"]').text()).toBe('1 / 3')
    expect(controls.get('[data-layer="down"]').attributes('disabled')).toBeDefined()
    await controls.get('[data-layer="up"]').trigger('click')
    await controls.get('[data-layer="up"]').trigger('click')
    expect(controls.get('[data-testid="layer-current"]').text()).toBe('3 / 3')
    expect(controls.get('[data-layer="up"]').attributes('disabled')).toBeDefined()
    await controls.get('[data-layer="down"]').trigger('click')
    expect(useLayerStore().current).toBe(1)

    const select = controls.get('select[aria-label="段の表示方法"]')
    expect(select.findAll('option').map((o) => o.text())).toEqual(['すべて', '上を消す', '上を半透明', 'この段だけ'])
    await select.setValue('ghostAbove')
    expect(view.layerMode).toBe('ghostAbove')
    expect(view.layerDisplay).toMatchObject({ layer: 1, mode: 'ghostAbove' })
  })

  it('設計図がなければ、段の操作を押せない', () => {
    const controls = mountControls(createDocumentSession())
    expect(controls.get('[data-testid="layer-current"]').text()).toBe('– / –')
    expect(controls.get('[data-layer="up"]').attributes('disabled')).toBeDefined()
    expect(controls.get('[data-layer="down"]').attributes('disabled')).toBeDefined()
    expect(controls.get('select[aria-label="段の表示方法"]').attributes('disabled')).toBeDefined()
  })
})
