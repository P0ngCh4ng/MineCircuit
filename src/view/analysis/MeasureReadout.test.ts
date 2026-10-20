import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { blueprintFixture } from '../../../tests/fixtures/blueprintFixture'
import { eraseBlock, placeBlock } from '../../edit/editCommand'
import { state } from '../../../tests/fixtures/blueprintFixture'
import { createDocumentSession, DOCUMENT_SESSION_KEY } from '../document/documentSession'
import { useMeasureStore } from '../stores/measureStore'
import { useToolStore } from '../stores/toolStore'
import MeasureReadout from './MeasureReadout.vue'

function sample() {
  return blueprintFixture({ size: [5, 2, 5] })
    .fill([0, 0, 0], [2, 0, 0], 'create:shaft', { axis: 'x' })
    .place([2, 1, 0], 'create:shaft', { axis: 'x' })
    .place([4, 1, 4], 'minecraft:stone')
    .toBlueprint()
}

function mountReadout() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const session = createDocumentSession()
  session.setBlueprint(sample(), 'sample.nbt')
  const wrapper = mount(MeasureReadout, {
    global: { plugins: [pinia], provide: { [DOCUMENT_SESSION_KEY as symbol]: session } },
  })
  return { wrapper, session, tools: useToolStore(), measures: useMeasureStore() }
}

describe('MeasureReadout と計測・つながりツール', () => {
  it('計測ツールとつながりツールが使えるようになる。選択ツールの間は何も出さない', () => {
    const { wrapper, tools } = mountReadout()
    expect(tools.isAvailable('measure')).toBe(true)
    expect(tools.isAvailable('connect')).toBe(true)
    expect(tools.activeToolId).toBe('select')
    expect(wrapper.text()).toBe('')
  })

  it('2点をクリックすると差・直線距離・軸に沿った距離・囲む範囲を出す', async () => {
    const { wrapper, tools, measures } = mountReadout()
    tools.setTool('measure')
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('1つ目のブロックをクリックしてください')

    tools.click({ pos: [0, 0, 0], empty: false })
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('2つ目のブロックをクリックしてください')

    tools.click({ pos: [4, 1, 4], empty: false })
    await wrapper.vm.$nextTick()
    expect(wrapper.get('[data-readout="delta"]').text()).toBe('X +4, Y +1, Z +4')
    expect(wrapper.get('[data-readout="euclidean"]').text()).toBe('5.74 ブロック')
    expect(wrapper.get('[data-readout="manhattan"]').text()).toContain('9 ブロック')
    expect(wrapper.get('[data-readout="bounds"]').text()).toBe('5 × 2 × 5')

    // ツールを切り替えると消える
    tools.setTool('select')
    expect(measures.measurePoints).toEqual([])
  })

  it('つながり：まとまりの種類・個数・段の数を出し、回転のつながりではないと書く', async () => {
    const { wrapper, tools, measures } = mountReadout()
    tools.setTool('connect')
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('回転や配管のつながりではありません')

    tools.click({ pos: [1, 0, 0], empty: false })
    await wrapper.vm.$nextTick()
    expect(wrapper.get('[data-readout="state"]').text()).toBe('create:shaft[axis=x]')
    expect(wrapper.get('[data-readout="count"]').text()).toBe('4 個')
    expect(wrapper.get('[data-readout="layers"]').text()).toBe('2 段')
    expect(measures.connectGroup?.positions[0]).toEqual([1, 0, 0])
  })

  it('編集・元に戻すのあとは、まとまりを求め直す。始めのブロックが消えたら強調をやめる', async () => {
    const { wrapper, session, tools, measures } = mountReadout()
    tools.setTool('connect')
    tools.click({ pos: [0, 0, 0], empty: false })
    expect(measures.connectGroup?.positions).toHaveLength(4)

    const bp = session.current.value!.blueprint
    session.apply(placeBlock(bp, [3, 0, 0], state('create:shaft[axis=x]'), false))
    expect(measures.connectGroup?.positions).toHaveLength(5)
    session.undo()
    expect(measures.connectGroup?.positions).toHaveLength(4)

    session.apply(eraseBlock(bp, [0, 0, 0]))
    await wrapper.vm.$nextTick()
    expect(measures.connectGroup).toBeNull()
    expect(wrapper.text()).toContain('ブロックをクリックすると')
  })

  it('別の設計図を開くと、計測とつながりを消す', async () => {
    const { session, tools, measures } = mountReadout()
    tools.setTool('measure')
    tools.click({ pos: [0, 0, 0], empty: false })
    expect(measures.measurePoints).toHaveLength(1)
    session.setBlueprint(sample(), 'other.nbt')
    await Promise.resolve()
    expect(measures.measurePoints).toEqual([])
  })
})
