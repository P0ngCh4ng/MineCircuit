import { afterEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { blueprintFixture } from '../../../tests/fixtures/blueprintFixture'
import { noopCalcPlugin } from '../../../tests/fixtures/noopCalcPlugin'
import { InlineCalcBackend } from '../../calc/calcScheduler'
import { PluginRegistry } from '../../calc/pluginRegistry'
import App from '../App.vue'
import { createDocumentSession, DOCUMENT_SESSION_KEY } from '../document/documentSession'
import { useBrushStore } from '../stores/brushStore'
import { useCalcStore } from '../stores/calcStore'
import { useLayerStore } from '../stores/layerStore'
import { useToolStore } from '../stores/toolStore'
import { useViewStore } from '../stores/viewStore'

function press(key: string, shiftKey = false): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey }))
}

let wrapper: VueWrapper | null = null

function mountApp() {
  const pinia = createPinia()
  setActivePinia(pinia)
  useCalcStore().setBackend(new InlineCalcBackend(new PluginRegistry([noopCalcPlugin()])), { delayMs: 0 })
  const session = createDocumentSession()
  session.setBlueprint(
    blueprintFixture({ size: [3, 3, 1] })
      .place([0, 0, 0], 'create:shaft', { axis: 'x' })
      .place([1, 0, 0], 'minecraft:stone')
      .toBlueprint(),
  )
  wrapper = mount(App, {
    global: { plugins: [pinia], provide: { [DOCUMENT_SESSION_KEY as symbol]: session } },
    attachTo: document.body,
  })
  return { session, wrapper, tools: useToolStore(), brush: useBrushStore() }
}

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

describe('編集のツール', () => {
  it('置く・消す・スポイトのボタンが使え、B / E / I で切り替わる', async () => {
    const { wrapper, tools } = mountApp()
    await nextTick()
    for (const id of ['place', 'erase', 'pick']) {
      expect(wrapper.get(`[data-tool="${id}"]`).attributes('disabled')).toBeUndefined()
    }
    press('b')
    expect(tools.activeToolId).toBe('place')
    press('e')
    expect(tools.activeToolId).toBe('erase')
    press('i')
    expect(tools.activeToolId).toBe('pick')
  })

  it('スポイトで取ったブロックを置き、R は置くツールのとき置くブロックを回す', async () => {
    const { session, tools, brush } = mountApp()
    const bp = session.current.value!.blueprint
    press('i')
    tools.click({ pos: [0, 0, 0], face: 'up', empty: false })
    expect(brush.state?.key).toBe('create:shaft[axis=x]')

    press('b')
    tools.setSelected([1, 0, 0])
    press('r')
    expect(brush.state?.key).toBe('create:shaft[axis=z]')
    expect(bp.get([1, 0, 0])?.key).toBe('minecraft:stone')

    tools.click({ pos: [2, 0, 0], empty: true })
    expect(bp.get([2, 0, 0])?.key).toBe('create:shaft[axis=z]')
    expect(session.nextUndoLabel.value).toBe('shaft を置く')
  })

  it('Delete で選択中のブロックを消し、選択を外す。元に戻せる', () => {
    const { session, tools } = mountApp()
    const bp = session.current.value!.blueprint
    tools.setSelected([1, 0, 0])
    press('Delete')
    expect(bp.get([1, 0, 0])).toBeNull()
    expect(tools.selectedPos).toBeNull()
    session.undo()
    expect(bp.get([1, 0, 0])?.key).toBe('minecraft:stone')
  })

  it('置いた段が隠れる表示なら、その段へ移る', () => {
    const { session, tools, brush } = mountApp()
    const view = useViewStore()
    const layers = useLayerStore()
    view.setLayerMode('only')
    view.setLayerHidden(1, true)
    brush.setFromBlock(session.current.value!.blueprint.get([1, 0, 0]))
    tools.setTool('place')
    tools.click({ pos: [1, 0, 0], face: 'up', empty: false })
    expect(session.current.value!.blueprint.get([1, 1, 0])?.key).toBe('minecraft:stone')
    expect(layers.current).toBe(1)
    expect(view.hiddenLayers.has(1)).toBe(false)
  })

  it('左パネルで、棚の「この設計図」から選ぶか ID を入力して置くブロックを決める', async () => {
    const { wrapper, brush, tools } = mountApp()
    await wrapper.get('[data-testid="shelf"] [data-key="minecraft:stone"]').trigger('click')
    expect(brush.state?.key).toBe('minecraft:stone')
    expect(tools.activeToolId).toBe('place')

    const input = wrapper.get('[data-testid="brush-input"]')
    await input.setValue('create:shaft[axis=')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.text()).toContain('"]" がありません')
    expect(brush.state?.key).toBe('minecraft:stone')

    await input.setValue('create:cogwheel[axis=y]')
    await wrapper.get('form').trigger('submit')
    expect(brush.state?.key).toBe('create:cogwheel[axis=y]')
    expect(wrapper.get('[data-testid="brush-current"]').text()).toContain('create:cogwheel')
  })
})
