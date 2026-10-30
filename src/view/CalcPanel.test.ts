import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type DOMWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { blueprintFixture, state } from '../../tests/fixtures/blueprintFixture'
import { noopCalcPlugin } from '../../tests/fixtures/noopCalcPlugin'
import { InlineCalcBackend } from '../calc/calcScheduler'
import { PluginRegistry } from '../calc/pluginRegistry'
import { resolved } from '../calc/provenance'
import { nbt } from '../domain/nbt'
import { placeBlock } from '../edit/editCommand'
import { EditHistory } from '../edit/editHistory'
import { usePortTool } from './calc/usePortTool'
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

/** v-show で隠していなければ true（取り付けていない部品では isVisible が使えないため） */
function shown(el: DOMWrapper<Element>): boolean {
  return !(el.attributes('style') ?? '').includes('display: none')
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

  it('まとめた問題は、その全ブロックを強調する（#153）', async () => {
    const plugin = noopCalcPlugin()
    const run = plugin.run.bind(plugin)
    const grouped = {
      ...plugin,
      run: async (...args: Parameters<typeof plugin.run>) => ({
        ...(await run(...args)),
        issues: [{ pos: [0, 0, 0] as const, message: 'まとめた問題', positions: [[0, 0, 0], [1, 0, 0]] as const }],
      }),
    }
    const { calc } = setup([grouped])
    await calc.attach(sample())
    await flushPromises()
    expect(calc.issuePositions).toEqual([[0, 0, 0], [1, 0, 0]])
  })

  it('位置のある合計の行（ネット一覧）を押すと、そのブロックをプローブの対象にする（#152）', async () => {
    const plugin = noopCalcPlugin()
    const run = plugin.run.bind(plugin)
    const withNet = {
      ...plugin,
      run: async (...args: Parameters<typeof plugin.run>) => {
        const r = await run(...args)
        return { ...r, summary: [...r.summary, { label: 'ネットワーク 1', value: resolved('使用 0 SU', 'blueprint'), pos: [1, 0, 0] as const, network: true }] }
      },
    }
    const { calc, wrapper } = setup([withNet])
    await calc.attach(sample())
    await flushPromises()
    const buttons = wrapper.findAll('.summary .net')
    expect(buttons.map((b) => b.text())).toEqual(['ネットワーク 1'])
    await buttons[0].trigger('click')
    expect(useProbeStore().probedPos).toEqual([1, 0, 0])
  })

  it('計算をタブに分け、ネットワークの行はまとめでなくネットワークのタブに出す（#157）', async () => {
    const plugin = noopCalcPlugin()
    const run = plugin.run.bind(plugin)
    const withNet = {
      ...plugin,
      run: async (...args: Parameters<typeof plugin.run>) => {
        const r = await run(...args)
        return { ...r, summary: [...r.summary, { label: 'ネットワーク 1', value: resolved('使用 0 SU', 'blueprint'), pos: [1, 0, 0] as const, network: true }] }
      },
    }
    const { calc, wrapper } = setup([withNet])
    await calc.attach(sample())
    await flushPromises()
    const tabs = wrapper.findAll('[role="tab"]')
    expect(tabs.map((t) => t.text())).toEqual(['まとめ', 'ネットワーク（1）', '問題（1）', '入出力（0）', '仮定（1）'])
    const panel = (id: string) => wrapper.find(`[data-tabpanel="${id}"]`)
    expect(shown(panel('summary'))).toBe(true)
    expect(panel('summary').text()).toContain('ブロック数')
    expect(panel('summary').text()).not.toContain('ネットワーク 1')
    expect(shown(panel('networks'))).toBe(false)

    await wrapper.find('[data-tab="networks"]').trigger('click')
    expect(shown(panel('summary'))).toBe(false)
    expect(shown(panel('networks'))).toBe(true)
    expect(panel('networks').text()).toContain('ネットワーク 1')
    expect(wrapper.find('[data-tab="networks"]').attributes('aria-selected')).toBe('true')

    await wrapper.find('[data-tab="issues"]').trigger('click')
    expect(shown(panel('issues'))).toBe(true)
    expect(panel('issues').text()).toContain('壊れている')
  })

  it('仮の入出力のツールに替えると、入出力のタブを開く（#157）', async () => {
    const { calc, wrapper } = setup()
    await calc.attach(sample())
    await flushPromises()
    expect(shown(wrapper.find('[data-tabpanel="ports"]'))).toBe(false)
    usePortTool()
    useToolStore().setTool('port')
    await flushPromises()
    expect(wrapper.find('[data-tab="ports"]').attributes('aria-selected')).toBe('true')
    expect(shown(wrapper.find('[data-tabpanel="ports"]'))).toBe(true)
    expect(wrapper.find('[data-testid="port-panel"]').exists()).toBe(true)
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
