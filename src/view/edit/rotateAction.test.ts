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

function press(key: string, shiftKey = false, ctrlKey = false): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, ctrlKey }))
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

  it('回した向きがゲームで置けない向きなら、回さずに理由を出す（#121）', () => {
    const { session, tools, brush } = mountApp()
    const bp = session.current.value!.blueprint
    // [0,0,0] の大きい歯車（axis=x）の東に小さい歯車（axis=y）。大きい歯車の軸の向きの隣は調べないので、今は置ける
    session.apply({
      label: '用意',
      changes: [
        { pos: [0, 0, 0], before: { state: bp.get([0, 0, 0]), blockEntity: null }, after: { state: state('create:large_cogwheel', { axis: 'x' }), blockEntity: null } },
        { pos: [1, 0, 0], before: { state: bp.get([1, 0, 0]), blockEntity: null }, after: { state: state('create:cogwheel', { axis: 'y' }), blockEntity: null } },
      ],
    })
    tools.setSelected([0, 0, 0])
    // 水平に回すと axis=z になり、東の小さい歯車が軸に垂直な横に来る
    press('r')
    expect(bp.get([0, 0, 0])?.properties.axis).toBe('x')
    expect(brush.message).toContain('大きい歯車は小さい歯車の横に置けません')
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

  it('2つ以上のマスの範囲なら範囲を回し、選択範囲も一緒に回る。ぶつかれば止め、Ctrl+R で上書きする（#132）', async () => {
    const { session, tools, brush } = mountApp()
    const bp = session.current.value!.blueprint
    tools.setSelected([0, 0, 0])
    tools.setSelectionBox({ min: [0, 0, 0], max: [1, 0, 0] })
    press('r')
    // 中心 [0,0,0] のまわりで、[1,0,0] の石が [0,0,1] へ。設計図は奥へ広がる
    expect(bp.get([0, 0, 0])?.key).toBe('create:shaft[axis=z]')
    expect(bp.get([0, 0, 1])?.key).toBe('minecraft:stone')
    expect(tools.selectionBox).toEqual({ min: [0, 0, 0], max: [0, 0, 1] })
    expect(session.nextUndoLabel.value).toBe('範囲を回す（2 個）')

    session.undo()
    expect(tools.selectionBox).toEqual({ min: [0, 0, 0], max: [1, 0, 0] })

    // 縦に並んだシャフトを回すと、横の石に重なる
    session.setBlueprint(
      blueprintFixture({ size: [3, 1, 3] })
        .place([1, 0, 0], 'create:shaft', { axis: 'z' })
        .place([1, 0, 1], 'create:shaft', { axis: 'z' })
        .place([2, 0, 1], 'minecraft:stone')
        .toBlueprint(),
    )
    const bp2 = session.current.value!.blueprint
    tools.setSelectionBox({ min: [1, 0, 0], max: [1, 0, 2] })
    press('r')
    expect(brush.message).toBe('動かす先にブロックがあります（1 個）。Ctrl を押しながら動かすと上書きします')
    press('r', false, true)
    expect(bp2.get([2, 0, 1])?.key).toBe('create:shaft[axis=x]')
  })
})
