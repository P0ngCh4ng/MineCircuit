import { afterEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { blueprintFixture } from '../../../tests/fixtures/blueprintFixture'
import { noopCalcPlugin } from '../../../tests/fixtures/noopCalcPlugin'
import { InlineCalcBackend } from '../../calc/calcScheduler'
import { PluginRegistry } from '../../calc/pluginRegistry'
import { BlockState } from '../../domain/blockState'
import { ResourceLocation } from '../../domain/resourceLocation'
import App from '../App.vue'
import { createDocumentSession, DOCUMENT_SESSION_KEY } from '../document/documentSession'
import { NO_ROTATION_MESSAGE, useBrushStore } from '../stores/brushStore'
import { useCalcStore } from '../stores/calcStore'
import { useToolStore } from '../stores/toolStore'

const state = (id: string, properties: Record<string, string> = {}) =>
  new BlockState(ResourceLocation.parse(id), properties)

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
    blueprintFixture({ size: [2, 1, 1] })
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

describe('R / Shift+R のキー', () => {
  it('選択中のブロックがなければ、置くブロックを回す。回せなければ下の状態表示に知らせる', async () => {
    const { wrapper, brush } = mountApp()
    brush.setFromBlock(state('create:creative_motor', { facing: 'north' }))
    press('R', true)
    expect(brush.state?.properties.facing).toBe('up')
    press('r')
    expect(brush.state?.properties.facing).toBe('up') // up は水平の回転で変わらない
    await nextTick()
    expect(wrapper.get('[data-status="message"]').text()).toBe(NO_ROTATION_MESSAGE)
  })

  it('選択中のブロックを編集の操作で回し、元に戻せる', async () => {
    const { session, tools, brush } = mountApp()
    brush.setFromBlock(state('create:creative_motor', { facing: 'north' }))
    tools.setSelected([0, 0, 0])
    press('r')
    const bp = session.current.value?.blueprint
    expect(bp?.get([0, 0, 0])?.properties.axis).toBe('z')
    expect(brush.state?.properties.facing).toBe('north') // 置くブロックは回さない
    expect(session.nextUndoLabel.value).toBe('shaft を回す')
    session.undo()
    expect(bp?.get([0, 0, 0])?.properties.axis).toBe('x')
  })

  it('選択中のブロックが回せなければ知らせ、選択を変えたら消す', async () => {
    const { wrapper, session, tools, brush } = mountApp()
    tools.setSelected([1, 0, 0])
    press('r')
    expect(session.canUndo.value).toBe(false)
    expect(brush.message).toBe(NO_ROTATION_MESSAGE)
    tools.setSelected([0, 0, 0])
    await nextTick()
    expect(brush.message).toBeNull()
    expect(wrapper.find('[data-status="message"]').exists()).toBe(false)
  })
})
