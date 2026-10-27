import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { blueprintFixture } from '../../../tests/fixtures/blueprintFixture'
import { createDocumentSession, DOCUMENT_SESSION_KEY } from '../document/documentSession'
import { useLayerStore } from '../stores/layerStore'
import { useToolStore } from '../stores/toolStore'
import { useViewStore } from '../stores/viewStore'
import ViewModeSwitch from '../shell/ViewModeSwitch.vue'
import { layoutGrid2D } from './layerGrid2D'
import LayerView2D from './LayerView2D.vue'

const WIDTH = 400
const HEIGHT = 300

// happy-dom は大きさを計算しないので、表示の大きさを決めておく
let restore: (() => void) | null = null
beforeEach(() => {
  const proto = HTMLElement.prototype
  const w = Object.getOwnPropertyDescriptor(proto, 'clientWidth')
  const h = Object.getOwnPropertyDescriptor(proto, 'clientHeight')
  Object.defineProperty(proto, 'clientWidth', { configurable: true, get: () => WIDTH })
  Object.defineProperty(proto, 'clientHeight', { configurable: true, get: () => HEIGHT })
  restore = () => {
    if (w) Object.defineProperty(proto, 'clientWidth', w)
    if (h) Object.defineProperty(proto, 'clientHeight', h)
  }
})
afterEach(() => restore?.())

function sample() {
  return blueprintFixture({ size: [4, 3, 3], name: 'line.nbt' })
    .place([1, 0, 2], 'minecraft:stone')
    .place([2, 1, 1], 'create:shaft', { axis: 'x' })
    .toBlueprint()
}

function mountView() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const session = createDocumentSession()
  const bp = sample()
  session.setBlueprint(bp, 'line.nbt')
  const wrapper = mount(LayerView2D, {
    global: { plugins: [pinia], provide: { [DOCUMENT_SESSION_KEY as symbol]: session } },
    attachTo: document.body,
  })
  const layout = layoutGrid2D(WIDTH, HEIGHT, bp.size)
  // canvas の左上が (0, 0) なので、clientX/Y がそのまま canvas の中の位置になる
  const at = (x: number, z: number) => ({
    clientX: layout.originX + (x + 0.5) * layout.cellSize,
    clientY: layout.originY + (z + 0.5) * layout.cellSize,
  })
  return { wrapper, session, at }
}

describe('LayerView2D', () => {
  it('2D でクリックしたブロックを選ぶ。空きマスをクリックすると選択を解除する', async () => {
    const { wrapper, at } = mountView()
    const tools = useToolStore()
    const canvas = wrapper.get('canvas')

    await canvas.trigger('click', at(1, 2))
    expect(tools.selectedPos).toEqual([1, 0, 2])

    await canvas.trigger('click', at(0, 0))
    expect(tools.selectedPos).toBeNull()
    wrapper.unmount()
  })

  it('今の段のマスを、マウスの下として知らせる', async () => {
    const { wrapper, at } = mountView()
    const tools = useToolStore()
    useLayerStore().setLayer(1)
    await wrapper.vm.$nextTick()
    const canvas = wrapper.get('canvas')

    await canvas.trigger('pointermove', at(2, 1))
    expect(tools.hoverTarget).toEqual({ pos: [2, 1, 1], empty: false })
    expect(tools.hoveredPos).toEqual([2, 1, 1])

    await canvas.trigger('pointermove', at(3, 0))
    expect(tools.hoverTarget).toEqual({ pos: [3, 1, 0], empty: true })
    expect(tools.hoveredPos).toBeNull()

    await canvas.trigger('pointerleave')
    expect(tools.hoverTarget).toBeNull()
    wrapper.unmount()
  })

  it('選択ツールでドラッグすると、今の段の長方形を選ぶ。続くクリックで選び直さない（#130）', async () => {
    const { wrapper, at } = mountView()
    const tools = useToolStore()
    expect(tools.activeToolId).toBe('select')
    useLayerStore().setLayer(1)
    await wrapper.vm.$nextTick()
    const canvas = wrapper.get('canvas')

    await canvas.trigger('pointerdown', { button: 0, ...at(3, 0) })
    await canvas.trigger('pointermove', { buttons: 1, ...at(2, 1) })
    // 動いている間も範囲を広げる
    expect(tools.selectionBox).toEqual({ min: [2, 1, 0], max: [3, 1, 1] })
    await canvas.trigger('pointerup', { button: 0, ...at(1, 2) })
    await canvas.trigger('click', at(1, 2))
    expect(tools.selectionBox).toEqual({ min: [1, 1, 0], max: [3, 1, 2] })
    // 起点はドラッグを始めたマス（続く Shift+クリックはここから広げる）
    expect(tools.selectedPos).toEqual([3, 1, 0])

    // そのあとのふつうのクリックは、今までどおり1つを選ぶ・解除する
    await canvas.trigger('pointerdown', { button: 0, ...at(2, 1) })
    await canvas.trigger('pointerup', { button: 0, ...at(2, 1) })
    await canvas.trigger('click', at(2, 1))
    expect(tools.selectedPos).toEqual([2, 1, 1])
    expect(tools.selectionBox).toEqual({ min: [2, 1, 1], max: [2, 1, 1] })
    wrapper.unmount()
  })

  it('Shift+ドラッグで、起点の段から今の段までの高さにする（#130）', async () => {
    const { wrapper, at } = mountView()
    const tools = useToolStore()
    const canvas = wrapper.get('canvas')
    // 段 1 のブロックを起点にする
    await canvas.trigger('click', at(1, 2))
    expect(tools.selectedPos).toEqual([1, 0, 2])

    useLayerStore().setLayer(2)
    await wrapper.vm.$nextTick()
    await canvas.trigger('pointerdown', { button: 0, shiftKey: true, ...at(0, 0) })
    await canvas.trigger('pointermove', { buttons: 1, shiftKey: true, ...at(3, 1) })
    await canvas.trigger('pointerup', { button: 0, shiftKey: true, ...at(3, 1) })
    await canvas.trigger('click', { shiftKey: true, ...at(3, 1) })
    expect(tools.selectionBox).toEqual({ min: [0, 0, 0], max: [3, 2, 1] })
    wrapper.unmount()
  })

  it('選択ツールでなければ、ドラッグで範囲を選ばない', async () => {
    const { wrapper, at } = mountView()
    const tools = useToolStore()
    const canvas = wrapper.get('canvas')
    tools.activeToolId = 'measure'
    await canvas.trigger('pointerdown', { button: 0, ...at(0, 0) })
    await canvas.trigger('pointermove', { buttons: 1, ...at(3, 2) })
    await canvas.trigger('pointerup', { button: 0, ...at(3, 2) })
    expect(tools.selectionBox).toBeNull()
    wrapper.unmount()
  })

  it('今の段と北の向きを出す。段は設計図の高さに収める', async () => {
    const { wrapper } = mountView()
    expect(wrapper.text()).toContain('北（−Z）')
    expect(wrapper.get('[data-testid="layer-view-2d-layer"]').text()).toBe('段 1 / 3')
    useLayerStore().setLayer(10)
    await wrapper.vm.$nextTick()
    expect(wrapper.get('[data-testid="layer-view-2d-layer"]').text()).toBe('段 3 / 3')
    wrapper.unmount()
  })
})

describe('ViewModeSwitch', () => {
  it('3D と 2D を切り替える', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const wrapper = mount(ViewModeSwitch, { global: { plugins: [pinia] } })
    const viewMode = useViewStore()
    expect(viewMode.mode).toBe('3d')

    await wrapper.get('[data-view-mode="2d"]').trigger('click')
    expect(viewMode.mode).toBe('2d')
    expect(wrapper.get('[data-view-mode="2d"]').attributes('aria-pressed')).toBe('true')
    wrapper.unmount()
  })
})
