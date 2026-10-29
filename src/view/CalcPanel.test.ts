import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { blueprintFixture, state } from '../../tests/fixtures/blueprintFixture'
import { noopCalcPlugin } from '../../tests/fixtures/noopCalcPlugin'
import { InlineCalcBackend } from '../calc/calcScheduler'
import { PluginRegistry } from '../calc/pluginRegistry'
import { nbt } from '../domain/nbt'
import { placeBlock } from '../edit/editCommand'
import { EditHistory } from '../edit/editHistory'
import CalcPanel from './CalcPanel.vue'
import { useCalcStore } from './stores/calcStore'
import { useLayerStore } from './stores/layerStore'
import { useProbeStore } from './stores/probeStore'
import { useToolStore } from './stores/toolStore'
import { useViewStore } from './stores/viewStore'

function setup(plugins = [noopCalcPlugin()]) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const calc = useCalcStore()
  calc.setBackend(new InlineCalcBackend(new PluginRegistry(plugins)), { delayMs: 100 })
  const wrapper = mount(CalcPanel, { global: { plugins: [pinia] } })
  return { calc, wrapper }
}

function sample() {
  return blueprintFixture({ size: [3, 2, 1] })
    .place([0, 0, 0], 'create:shaft', { axis: 'x' })
    .place([1, 0, 0], 'create:cogwheel', { axis: 'x' }, nbt.compound({ Broken: nbt.byte(1) }))
    .toBlueprint()
}

describe('CalcPanel（右パネルの計算結果）', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('設計図がなければ案内を出す', () => {
    const { wrapper } = setup()
    expect(wrapper.text()).toContain('設計図を開くと、ここに計算結果が出ます。')
  })

  it('テスト用プラグインの合計・問題・仮定と、値の出どころを出す', async () => {
    const { calc, wrapper } = setup()
    await calc.attach(sample())
    await flushPromises()
    const text = wrapper.text()
    expect(text).toContain('テスト用')
    expect(text).toContain('ブロック数')
    expect(text).toContain('問題（1）')
    expect(text).toContain('[1, 0, 0]')
    expect(text).toContain('壊れている')
    expect(text).toContain('仮定（1）')
    expect(text).toContain('範囲外は空気とみなした')
    const sources = wrapper.findAll('.source').map((s) => s.attributes('data-source'))
    expect(sources).toEqual(['blueprint', 'builtin'])
    expect(wrapper.find('.source').text()).toBe('設計図')
    expect(calc.issuePositions).toEqual([[1, 0, 0]])
  })

  it('警告は「警告」と付けて一覧に出し、3D・2D の強調には入れない（#148）', async () => {
    const { calc, wrapper } = setup()
    const bp = blueprintFixture({ size: [3, 1, 1] })
      .place([0, 0, 0], 'create:shaft', { axis: 'x' }, nbt.compound({ Broken: nbt.byte(2) }))
      .place([1, 0, 0], 'create:shaft', { axis: 'x' }, nbt.compound({ Broken: nbt.byte(1) }))
      .toBlueprint()
    await calc.attach(bp)
    await flushPromises()
    const items = wrapper.findAll('.issues li')
    expect(items.map((li) => li.attributes('data-severity'))).toEqual(['warning', 'error'])
    expect(items[0].find('.severity').text()).toBe('警告')
    expect(items[1].find('.severity').exists()).toBe(false)
    expect(calc.issuePositions).toEqual([[1, 0, 0]])
  })

  it('問題の位置を押すと、そのブロックを選び、その段へ移ってプローブの対象にする', async () => {
    const { calc, wrapper } = setup()
    await calc.attach(sample())
    await flushPromises()
    useLayerStore().setLayer(1)
    useViewStore().setLayerHidden(0, true)
    await wrapper.find('.issues .pos').trigger('click')
    expect(useToolStore().selectedPos).toEqual([1, 0, 0])
    expect(useLayerStore().current).toBe(0)
    expect(useViewStore().hiddenLayers.has(0)).toBe(false)
    expect(useProbeStore().probedPos).toEqual([1, 0, 0])
  })

  it('編集が止まってから計算し直す', async () => {
    const { calc, wrapper } = setup()
    const bp = sample()
    const history = new EditHistory(bp)
    await calc.attach(bp, history.onChange)
    await flushPromises()
    expect(wrapper.text()).toContain('2')

    for (const x of [0, 1, 2]) {
      const cmd = placeBlock(bp, [x, 1, 0], state('minecraft:stone'), true)
      if (cmd) history.apply(cmd)
      await vi.advanceTimersByTimeAsync(50)
    }
    expect(calc.status).toBe('waiting')
    expect(wrapper.text()).toContain('変更が止まったら計算します')
    await vi.advanceTimersByTimeAsync(100)
    await flushPromises()
    expect(calc.status).toBe('idle')
    const count = wrapper.findAll('.summary dd')[0].text()
    expect(count).toMatch(/^5/)
  })

  it('計算できるプラグインがないとき・プラグインが失敗したときに知らせる', async () => {
    const none = setup([noopCalcPlugin({ supports: false })])
    await none.calc.attach(sample())
    await flushPromises()
    expect(none.wrapper.text()).toContain('この設計図を計算できるプラグインはありません。')

    const failing = setup([noopCalcPlugin({ fail: true })])
    await failing.calc.attach(sample())
    await flushPromises()
    expect(failing.wrapper.text()).toContain('計算の途中でエラーが起きました（テスト用の失敗）')
  })

  it('設計図を外すと結果を消す', async () => {
    const { calc, wrapper } = setup()
    await calc.attach(sample())
    await calc.attach(null)
    await flushPromises()
    expect(wrapper.text()).toContain('設計図を開くと')
  })
})
