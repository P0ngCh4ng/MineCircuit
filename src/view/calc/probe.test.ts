import { beforeEach, describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h } from 'vue'
import { blueprintFixture } from '../../../tests/fixtures/blueprintFixture'
import { createBuiltinRegistry } from '../../calc/builtinPlugins'
import { InlineCalcBackend } from '../../calc/calcScheduler'
import type { PluginOutcome } from '../../calc/pluginRegistry'
import { resolved } from '../../calc/provenance'
import { nbt } from '../../domain/nbt'
import type { Vec3 } from '../../domain/vec3'
import { useDocumentSession } from '../document/documentSession'
import { SHOW_ALL_LAYERS } from '../layers/layerDisplay'
import { useCalcStore } from '../stores/calcStore'
import { useProbeStore } from '../stores/probeStore'
import { useToolStore } from '../stores/toolStore'
import { resolveKeyAction } from '../tools/keymap'
import { ProbeTool } from '../tools/probeTool'
import { CalcOverlay3D } from '../viewport/calcOverlay3D'
import ProbePanel from './ProbePanel.vue'
import { issuesAt, networkAt, networkRowsAt, probeAt } from './probeModel'
import { useProbeTool } from './useProbeTool'

/** クリエイティブモーター → 軸 → 軸 → プレス、離れたところに軸が1本 */
function line() {
  return blueprintFixture({ size: [5, 2, 3] })
    .place([0, 0, 0], 'create:creative_motor', { facing: 'east' }, nbt.compound({ ScrollValue: nbt.int(16) }))
    .place([1, 0, 0], 'create:shaft', { axis: 'x' })
    .place([2, 0, 0], 'create:shaft', { axis: 'x' })
    .place([3, 0, 0], 'create:mechanical_press', { facing: 'east' })
    .place([0, 0, 2], 'create:shaft', { axis: 'x' })
    .place([4, 1, 2], 'minecraft:stone')
    .toBlueprint()
}

const sorted = (ps: readonly Vec3[] | null) => (ps ? [...ps].map((p) => p.join()).sort() : null)

describe('probeModel', () => {
  const outcomes: PluginOutcome[] = [
    { pluginId: 'err', label: '失敗', status: 'error', message: 'x' },
    {
      pluginId: 'a',
      label: 'A',
      status: 'ok',
      result: {
        summary: [],
        issues: [],
        assumptions: [],
        probes: [
          { pos: [0, 0, 0], values: [{ label: '回転数', value: resolved('16 RPM', 'blueprint') }], network: 0 },
          { pos: [1, 0, 0], values: [], network: 0 },
          { pos: [5, 0, 0], values: [], network: 1 },
          { pos: [6, 0, 0], values: [] },
        ],
      },
    },
  ]

  it('位置のブロックの値をプラグインごとに返す', () => {
    expect(probeAt(outcomes, [0, 0, 0])).toEqual([
      { pluginId: 'a', pluginLabel: 'A', values: [{ label: '回転数', value: { value: '16 RPM', source: 'blueprint' } }] },
    ])
    expect(probeAt(outcomes, [9, 9, 9])).toEqual([])
    expect(probeAt(null, [0, 0, 0])).toEqual([])
  })

  it('同じネットワークのブロックの位置を返す。番号がなければ null', () => {
    expect(sorted(networkAt(outcomes, [1, 0, 0]))).toEqual(['0,0,0', '1,0,0'])
    expect(networkAt(outcomes, [5, 0, 0])).toEqual([[5, 0, 0]])
    expect(networkAt(outcomes, [6, 0, 0])).toBeNull()
    expect(networkAt(outcomes, [9, 9, 9])).toBeNull()
  })

  const withRows: PluginOutcome[] = [
    {
      pluginId: 'a',
      label: 'A',
      status: 'ok',
      result: {
        summary: [
          { label: 'まとめ', value: resolved('ネットワーク 2', 'blueprint') },
          { label: 'ネットワーク 1', value: resolved('使用 8 SU', 'blueprint'), pos: [1, 0, 0], network: true },
          { label: 'ネットワーク 2', value: resolved('使用 0 SU', 'blueprint'), pos: [5, 0, 0], network: true },
        ],
        issues: [
          { pos: [5, 0, 0], message: '止まっている', severity: 'warning' },
          { pos: [1, 0, 0], message: 'まとめた過負荷', positions: [[1, 0, 0], [0, 0, 0]] },
          { pos: [0, 0, 0], message: '知らせ', severity: 'info' },
        ],
        assumptions: [],
        probes: [
          { pos: [0, 0, 0], values: [], network: 0 },
          { pos: [1, 0, 0], values: [], network: 0 },
          { pos: [5, 0, 0], values: [], network: 1 },
          { pos: [6, 0, 0], values: [] },
        ],
      },
    },
  ]

  it('ブロックが属するネットワークの、ネット一覧の行を返す（#158）', () => {
    expect(networkRowsAt(withRows, [0, 0, 0]).map((r) => r.row.label)).toEqual(['ネットワーク 1'])
    expect(networkRowsAt(withRows, [5, 0, 0]).map((r) => r.row.label)).toEqual(['ネットワーク 2'])
    expect(networkRowsAt(withRows, [6, 0, 0])).toEqual([])
    expect(networkRowsAt(null, [0, 0, 0])).toEqual([])
  })

  it('ブロックが入る問題を、まとめた問題も含めて重い順に返す（#158）', () => {
    expect(issuesAt(withRows, [0, 0, 0])).toEqual([
      { pluginId: 'a', severity: 'error', message: 'まとめた過負荷' },
      { pluginId: 'a', severity: 'info', message: '知らせ' },
    ])
    expect(issuesAt(withRows, [5, 0, 0]).map((i) => i.severity)).toEqual(['warning'])
    expect(issuesAt(withRows, [6, 0, 0])).toEqual([])
  })
})

describe('ProbeTool', () => {
  it('マウスの下のブロックを知らせ、クリックしたブロックをプローブの対象にする。空きマスで解除', () => {
    const calls: string[] = []
    const tool = new ProbeTool({
      setHovered: (p) => calls.push(`hover ${p?.join() ?? 'null'}`),
      setProbed: (p) => calls.push(`probe ${p?.join() ?? 'null'}`),
    })
    tool.onHover({ pos: [1, 0, 0], empty: false })
    tool.onHover({ pos: [1, 0, 1], empty: true })
    tool.onClick({ pos: [1, 0, 0], empty: false }, { shift: false })
    tool.onClick({ pos: [1, 0, 1], empty: true }, { shift: false })
    tool.deactivate()
    expect(calls).toEqual(['hover 1,0,0', 'hover null', 'probe 1,0,0', 'probe null', 'hover null', 'probe null'])
  })
})

describe('プローブとネットのハイライト（Create の応力で）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  async function setup() {
    const pinia = createPinia()
    setActivePinia(pinia)
    const calc = useCalcStore()
    calc.setBackend(new InlineCalcBackend(createBuiltinRegistry()), { delayMs: 0 })
    const session = useDocumentSession()
    const bp = line()
    // useProbeTool は setup の中で呼ぶので、部品の中で呼ぶ
    const wrapper = mount(
      defineComponent({
        setup() {
          useProbeTool()
          return () => h(ProbePanel)
        },
      }),
      { global: { plugins: [pinia] } },
    )
    session.setBlueprint(bp, 'line.nbt')
    await calc.attach(bp)
    await flushPromises()
    return { calc, session, wrapper, tools: useToolStore(), probe: useProbeStore() }
  }

  it('プローブのツールを登録し、クリックしたブロックのネットワークを強調する', async () => {
    const { tools, probe, wrapper } = await setup()
    expect(tools.isAvailable('probe')).toBe(true)
    expect(tools.setTool('probe')).toBe(true)
    await flushPromises()
    expect(wrapper.find('[data-testid="probe-panel"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('ブロックにマウスを重ねると')

    tools.hover({ pos: [3, 0, 0], empty: false })
    await flushPromises()
    expect(tools.hoveredPos).toEqual([3, 0, 0])
    const text = wrapper.text()
    expect(text).toContain('[3, 0, 0]')
    expect(text).toContain('create:mechanical_press')
    expect(text).toContain('回転数')
    expect(text).toContain('16 RPM')
    expect(text).toContain('応力')
    // 値だけ出し、出どころは選択中のブロックの欄で見る（#158）
    expect(wrapper.findAll('.source').length).toBe(0)

    tools.click({ pos: [1, 0, 0], empty: false })
    await flushPromises()
    expect(sorted(probe.networkPositions)).toEqual(['0,0,0', '1,0,0', '2,0,0', '3,0,0'])
    expect(wrapper.find('[data-testid="probe-network"]').text()).toContain('4 ブロックを強調中')

    // 離れた軸は別のネットワーク
    tools.click({ pos: [0, 0, 2], empty: false })
    expect(probe.networkPositions).toEqual([[0, 0, 2]])

    // 回転でつながらないブロック
    tools.click({ pos: [4, 1, 2], empty: false })
    await flushPromises()
    expect(probe.networkPositions).toBeNull()
    tools.hover(null)
    await flushPromises()
    expect(wrapper.text()).toContain('このブロックには計算の値がありません')
    expect(wrapper.text()).toContain('回転でつながるブロックではありません')

    await wrapper.find('[data-action="clear-probe"]').trigger('click')
    expect(probe.probedPos).toBeNull()
  })

  it('P でプローブに替え、ほかのツールに替えたら結果の欄と強調を消す（#154）', async () => {
    const { tools, probe, wrapper } = await setup()
    const action = resolveKeyAction({ key: 'p', shiftKey: false, ctrlKey: false, metaKey: false, altKey: false })
    expect(action).toEqual({ type: 'tool', id: 'probe' })
    if (action?.type === 'tool') tools.setTool(action.id)
    expect(tools.activeToolId).toBe('probe')
    tools.click({ pos: [1, 0, 0], empty: false })
    await flushPromises()
    expect(wrapper.find('[data-testid="probe-network"]').exists()).toBe(true)

    tools.setTool('select')
    await flushPromises()
    expect(probe.probedPos).toBeNull()
    expect(probe.networkPositions).toBeNull()
    expect(wrapper.find('[data-testid="probe-panel"]').exists()).toBe(false)
  })

  it('別の設計図を開いたら強調を消す', async () => {
    const { tools, probe, session } = await setup()
    tools.setTool('probe')
    tools.click({ pos: [1, 0, 0], empty: false })
    expect(probe.probedPos).toEqual([1, 0, 0])
    session.setBlueprint(line(), 'other.nbt')
    await flushPromises()
    expect(probe.probedPos).toBeNull()
  })
})

describe('CalcOverlay3D', () => {
  it('ネットワークと問題の印を出し、隠した段の印は出さない', () => {
    const overlay = new CalcOverlay3D()
    overlay.update(
      [
        [0, 0, 0],
        [1, 1, 0],
      ],
      [[2, 0, 0]],
      SHOW_ALL_LAYERS,
    )
    expect(overlay.count('network')).toBe(2)
    expect(overlay.count('issue')).toBe(1)
    overlay.setLayerDisplay({ layer: 0, mode: 'only', hidden: new Set() })
    expect(overlay.count('network')).toBe(1)
    overlay.setNetwork(null)
    overlay.setIssues([])
    expect(overlay.count('network')).toBe(0)
    expect(overlay.count('issue')).toBe(0)
    expect(overlay.group.children).toHaveLength(0)
    overlay.dispose()
  })
})
