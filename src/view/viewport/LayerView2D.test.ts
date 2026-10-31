import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { blueprintFixture } from '../../../tests/fixtures/blueprintFixture'
import { createDocumentSession, DOCUMENT_SESSION_KEY } from '../document/documentSession'
import { useLayerStore } from '../stores/layerStore'
import { useToolStore } from '../stores/toolStore'
import { useViewStore } from '../stores/viewStore'
import type { PickTarget } from '../tools/tool'
import ViewControls from '../shell/ViewControls.vue'
import ViewModeSwitch from '../shell/ViewModeSwitch.vue'
import { layoutGrid2D } from './layerGrid2D'
import LayerView2D from './LayerView2D.vue'
import { clampToView, panBy, wheelZoomFactor, zoomAt } from './view2D'

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
  return { wrapper, session, at, layout }
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

  it('範囲の中を押してドラッグすると範囲を動かし、続くクリックで選び直さない。1マスの選択からは範囲を選ぶ（#199）', async () => {
    const { wrapper, session, at } = mountView()
    const tools = useToolStore()
    const bp = session.current.value!.blueprint
    const canvas = wrapper.get('canvas')
    tools.setSelectionBox({ min: [0, 0, 1], max: [1, 0, 2] })

    await canvas.trigger('pointerdown', { button: 0, ...at(1, 2) })
    await canvas.trigger('pointermove', { buttons: 1, ...at(2, 2) })
    // 動いている間は範囲を選び直さない
    expect(tools.selectionBox).toEqual({ min: [0, 0, 1], max: [1, 0, 2] })
    await canvas.trigger('pointerup', { button: 0, ...at(3, 1) })
    await canvas.trigger('click', at(3, 1))
    // 石 (1,0,2) が x +2・z −1 で (3,0,1) へ
    expect(bp.get([1, 0, 2])).toBeNull()
    expect(bp.get([3, 0, 1])?.key).toBe('minecraft:stone')

    // 1マスだけ選んでいるときは、押したマスから範囲を選ぶ
    tools.setSelectionBox({ min: [3, 0, 1], max: [3, 0, 1] })
    await canvas.trigger('pointerdown', { button: 0, ...at(3, 1) })
    await canvas.trigger('pointermove', { buttons: 1, ...at(2, 0) })
    await canvas.trigger('pointerup', { button: 0, ...at(2, 0) })
    expect(tools.selectionBox).toEqual({ min: [2, 0, 0], max: [3, 0, 1] })
    expect(bp.get([3, 0, 1])?.key).toBe('minecraft:stone')
    wrapper.unmount()
  })

  it('範囲の辺を引くと範囲を広げる・縮める。角は2つの辺を動かし、設計図の外へは出さない。履歴には入れない（#205）', async () => {
    const { wrapper, session, layout } = mountView()
    const tools = useToolStore()
    const canvas = wrapper.get('canvas')
    // マスの境目 (x, z) の画素
    const edge = (x: number, z: number) => ({ clientX: layout.originX + x * layout.cellSize, clientY: layout.originY + z * layout.cellSize })
    tools.setSelectionBox({ min: [0, 0, 1], max: [1, 0, 2] })

    // 右の辺の真ん中（x = 2、z = 2）を x = 3 へ
    await canvas.trigger('pointerdown', { button: 0, ...edge(2, 2) })
    await canvas.trigger('pointermove', { buttons: 1, ...edge(3.2, 2) })
    expect(tools.selectionBox).toEqual({ min: [0, 0, 1], max: [2, 0, 2] })
    await canvas.trigger('pointerup', { button: 0, ...edge(3.2, 2) })
    await canvas.trigger('click', edge(3.2, 2))
    expect(tools.selectionBox).toEqual({ min: [0, 0, 1], max: [2, 0, 2] })

    // 左上の角（0, 1）を外へ引いても設計図の中まで。奥へ押すと 1 マスは残す
    await canvas.trigger('pointerdown', { button: 0, ...edge(0, 1) })
    await canvas.trigger('pointermove', { buttons: 1, ...edge(-2, -2) })
    expect(tools.selectionBox).toEqual({ min: [0, 0, 0], max: [2, 0, 2] })
    await canvas.trigger('pointermove', { buttons: 1, ...edge(9, 9) })
    expect(tools.selectionBox).toEqual({ min: [2, 0, 2], max: [2, 0, 2] })
    await canvas.trigger('pointerup', { button: 0, ...edge(9, 9) })
    expect(session.canUndo.value).toBe(false)
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

  it('置くツールでドラッグすると、ツールに一直線のドラッグを渡し、続くクリックで置かない（#161）', async () => {
    const { wrapper, at } = mountView()
    const tools = useToolStore()
    const log: string[] = []
    const pos = (t: PickTarget | null) => (t ? t.pos.join(',') : 'null')
    tools.register({
      id: 'place',
      onHover: () => {},
      onClick: (t) => log.push(`click:${pos(t)}`),
      dragStart: (t) => (log.push(`start:${pos(t)}`), true),
      dragMove: (t) => log.push(`move:${pos(t)}`),
      dragEnd: (t) => log.push(`end:${pos(t)}`),
    })
    tools.setTool('place')
    const canvas = wrapper.get('canvas')

    await canvas.trigger('pointerdown', { button: 0, pointerId: 1, ...at(0, 1) })
    await canvas.trigger('pointermove', { buttons: 1, pointerId: 1, ...at(2, 1) })
    await canvas.trigger('pointerup', { button: 0, pointerId: 1, ...at(3, 1) })
    await canvas.trigger('click', at(3, 1))
    expect(log).toEqual(['start:0,0,1', 'move:2,0,1', 'move:3,0,1', 'end:null'])
    // 範囲は選ばない
    expect(tools.selectionBox).toBeNull()

    // 動かさずに離したときは、ふつうのクリック
    log.length = 0
    await canvas.trigger('pointerdown', { button: 0, pointerId: 2, ...at(1, 1) })
    await canvas.trigger('pointerup', { button: 0, pointerId: 2, ...at(1, 1) })
    await canvas.trigger('click', at(1, 1))
    expect(log).toEqual(['click:1,0,1'])
    wrapper.unmount()
  })

  it('2つ以上のマスの範囲を選ぶと、範囲の近くに範囲のツールバーを出す（#160）', async () => {
    const { wrapper } = mountView()
    const tools = useToolStore()
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="selection-toolbar"]').exists()).toBe(false)
    tools.setSelectionBox({ min: [0, 0, 0], max: [2, 0, 1] })
    await wrapper.vm.$nextTick()
    const bar = wrapper.get('[data-testid="selection-toolbar"]')
    expect(bar.attributes('style')).toContain('left:')
    expect(bar.find('[data-action="mirror-x"]').exists()).toBe(true)
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

describe('LayerView2D の拡大・縮小と移動（#155）', () => {
  it('ホイールでマウスの位置を中心に拡大し、そのマスはマウスの下に残る', async () => {
    const { wrapper, at, layout } = mountView()
    const tools = useToolStore()
    const canvas = wrapper.get('canvas')
    const p = at(1, 2)
    await canvas.trigger('wheel', { deltaY: -300, ...p })
    expect(tools.hoverTarget?.pos).toEqual([1, 0, 2])
    // 拡大したので、もとの (3, 2) の位置は、もう (3, 2) ではない
    const zoomed = zoomAt(layout, p.clientX, p.clientY, wheelZoomFactor(-300))
    expect(zoomed.cellSize).toBeGreaterThan(layout.cellSize)
    await canvas.trigger('pointermove', at(3, 2))
    expect(tools.hoverTarget?.pos).not.toEqual([3, 0, 2])
    wrapper.unmount()
  })

  it('中ボタンでドラッグして表示を動かす', async () => {
    const { wrapper, at, layout } = mountView()
    const tools = useToolStore()
    const canvas = wrapper.get('canvas')
    const start = at(0, 0)
    // 2マス右・1マス下へ動かす
    const end = { clientX: start.clientX + layout.cellSize * 2, clientY: start.clientY + layout.cellSize }
    await canvas.trigger('pointerdown', { button: 1, pointerId: 1, ...start })
    await canvas.trigger('pointermove', { buttons: 4, pointerId: 1, ...end })
    await canvas.trigger('pointerup', { button: 1, pointerId: 1, ...end })
    // 動かしたあと、もとの (2, 1) の位置にはマス (0, 0) がある
    await canvas.trigger('pointermove', at(2, 1))
    expect(tools.hoverTarget?.pos).toEqual([0, 0, 0])
    wrapper.unmount()
  })

  it('空白キーを押したまま左ドラッグで表示を動かす。範囲は選ばず、続くクリックで選ばない', async () => {
    const { wrapper, at, layout } = mountView()
    const tools = useToolStore()
    const canvas = wrapper.get('canvas')
    await canvas.trigger('pointerenter')
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ' }))
    await wrapper.vm.$nextTick()
    expect(canvas.classes()).toContain('grab')

    const start = at(3, 2)
    const end = { clientX: start.clientX - layout.cellSize * 3, clientY: start.clientY - layout.cellSize * 2 }
    await canvas.trigger('pointerdown', { button: 0, pointerId: 2, ...start })
    expect(canvas.classes()).toContain('grabbing')
    await canvas.trigger('pointermove', { buttons: 1, pointerId: 2, ...end })
    await canvas.trigger('pointerup', { button: 0, pointerId: 2, ...end })
    await canvas.trigger('click', end)
    expect(tools.selectionBox).toBeNull()
    expect(tools.selectedPos).toBeNull()

    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space', key: ' ' }))
    await wrapper.vm.$nextTick()
    expect(canvas.classes()).not.toContain('grab')
    // マス (3, 2) は、もとの (0, 0) の位置に来ている
    await canvas.trigger('pointermove', at(0, 0))
    expect(tools.hoverTarget?.pos).toEqual([3, 0, 2])
    wrapper.unmount()
  })

  it('マウスが 2D表示の外にあるときは、空白キーを使わない', async () => {
    const { wrapper } = mountView()
    const canvas = wrapper.get('canvas')
    const e = new KeyboardEvent('keydown', { code: 'Space', key: ' ', cancelable: true })
    window.dispatchEvent(e)
    await wrapper.vm.$nextTick()
    expect(e.defaultPrevented).toBe(false)
    expect(canvas.classes()).not.toContain('grab')
    wrapper.unmount()
  })

  it('大きい設計図の端まで動かして見られる。「全体を表示」で全体が入る大きさに戻す', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const session = createDocumentSession()
    const bp = blueprintFixture({ size: [400, 1, 300], name: 'large.nbt' }).place([399, 0, 299], 'minecraft:stone').toBlueprint()
    session.setBlueprint(bp, 'large.nbt')
    const global = { plugins: [pinia], provide: { [DOCUMENT_SESSION_KEY as symbol]: session } }
    const wrapper = mount(LayerView2D, { global, attachTo: document.body })
    const viewMode = useViewStore()
    viewMode.setMode('2d')
    const tools = useToolStore()
    const canvas = wrapper.get('canvas')
    const fit = layoutGrid2D(WIDTH, HEIGHT, bp.size)
    const cornerAt = (g: { originX: number; originY: number; cellSize: number }) => ({
      clientX: g.originX + 399.5 * g.cellSize,
      clientY: g.originY + 299.5 * g.cellSize,
    })

    // 左上で5目盛り拡大すると、右下の端のマスは表示の外になる
    let grid = fit
    for (let i = 0; i < 5; i++) {
      await canvas.trigger('wheel', { deltaY: -100, clientX: 0, clientY: 0 })
      grid = clampToView(zoomAt(grid, 0, 0, wheelZoomFactor(-100)), bp.size, WIDTH, HEIGHT)
    }
    expect(grid.cellSize).toBeGreaterThan(fit.cellSize)
    const far = cornerAt(grid)
    expect(far.clientX > WIDTH || far.clientY > HEIGHT).toBe(true)

    // 表示の真ん中まで動かすと、右下の端のマスに届く
    const dx = WIDTH / 2 - far.clientX
    const dy = HEIGHT / 2 - far.clientY
    await canvas.trigger('pointerdown', { button: 1, pointerId: 3, clientX: 300, clientY: 200 })
    await canvas.trigger('pointermove', { buttons: 4, pointerId: 3, clientX: 300 + dx, clientY: 200 + dy })
    await canvas.trigger('pointerup', { button: 1, pointerId: 3, clientX: 300 + dx, clientY: 200 + dy })
    await canvas.trigger('pointermove', cornerAt(clampToView(panBy(grid, dx, dy), bp.size, WIDTH, HEIGHT)))
    expect(tools.hoverTarget?.pos).toEqual([399, 0, 299])

    // 上のバーの「全体を表示」を 2D でも押せて、はじめの置き方に戻る
    const controls = mount(ViewControls, { global })
    const fitButton = controls.get('[data-view="fit"]')
    expect(fitButton.attributes('disabled')).toBeUndefined()
    expect(controls.get('[data-view="iso"]').attributes('disabled')).toBeDefined()
    await fitButton.trigger('click')
    await wrapper.vm.$nextTick()
    await canvas.trigger('pointermove', cornerAt(fit))
    expect(tools.hoverTarget?.pos).toEqual([399, 0, 299])
    controls.unmount()
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
