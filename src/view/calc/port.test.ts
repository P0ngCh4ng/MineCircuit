import { beforeEach, describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { blueprintFixture } from '../../../tests/fixtures/blueprintFixture'
import { createBuiltinRegistry } from '../../calc/builtinPlugins'
import { InlineCalcBackend } from '../../calc/calcScheduler'
import type { PortKindDef, VirtualPort } from '../../calc/virtualPort'
import { useDocumentSession } from '../document/documentSession'
import { SHOW_ALL_LAYERS } from '../layers/layerDisplay'
import { useCalcStore } from '../stores/calcStore'
import { usePortStore } from '../stores/portStore'
import { useProbeStore } from '../stores/probeStore'
import { useToolStore } from '../stores/toolStore'
import { PortTool } from '../tools/portTool'
import type { GridLayout2D } from '../tools/picker'
import { portMarkRect } from '../viewport/portOverlay2D'
import { PORT_ITEM_COLOR, PORT_LOAD_COLOR, PORT_SOURCE_COLOR, PortOverlay3D, portColor } from '../viewport/portOverlay3D'
import PortPanel from './PortPanel.vue'
import {
  createPort,
  defaultPortFace,
  defaultPortParams,
  itemCandidates,
  parsePortNumber,
  portAt,
  portKindOptions,
  withPortFace,
  withPortItem,
  withPortLabel,
  withPortParam,
} from './portModel'
import { usePortTool } from './usePortTool'

/** 動力源のない軸の列：軸 → 軸 → 軸（x 方向） */
function shafts() {
  return blueprintFixture({ size: [3, 1, 1] })
    .place([0, 0, 0], 'create:shaft', { axis: 'x' })
    .place([1, 0, 0], 'create:shaft', { axis: 'x' })
    .place([2, 0, 0], 'create:shaft', { axis: 'x' })
    .toBlueprint()
}

const LOAD: PortKindDef = {
  kind: 'rotation-load',
  label: '回転の負荷',
  params: [
    { key: 'stress', label: '応力', defaultValue: 256, optional: true },
    { key: 'impact', label: '1 RPM あたりの応力', defaultValue: 4, optional: true },
  ],
}

function port(over: Partial<VirtualPort> = {}): VirtualPort {
  return { id: 'p', pos: [0, 0, 0], face: 'west', pluginId: 'create-stress', kind: 'rotation-source', params: { rpm: 16, capacity: 100 }, ...over }
}

describe('portModel', () => {
  it('プラグインの portKinds から種類を並べる', () => {
    const options = portKindOptions(createBuiltinRegistry().all())
    expect(options.map((o) => `${o.pluginId}/${o.def.kind}`)).toEqual(['create-stress/rotation-source', 'create-stress/rotation-load', 'create-stress/item-input'])
  })

  it('初期値は、省略できない値と、省略できる値の最初の1つだけ', () => {
    expect(defaultPortParams(LOAD)).toEqual({ stress: 256 })
    const [source] = portKindOptions(createBuiltinRegistry().all())
    expect(defaultPortParams(source.def)).toEqual({ rpm: 16, capacity: 4096 })
    expect(createPort('a', source, [1, 2, 3], 'up')).toEqual({
      id: 'a',
      pos: [1, 2, 3],
      face: 'up',
      pluginId: 'create-stress',
      kind: 'rotation-source',
      params: { rpm: 16, capacity: 4096 },
    })
  })

  it('値・面・メモを変えた新しい仮の入出力を返す（元は変えない）', () => {
    const p = port()
    expect(withPortParam(p, 'rpm', -32).params).toEqual({ rpm: -32, capacity: 100 })
    expect(withPortParam(p, 'capacity', null).params).toEqual({ rpm: 16 })
    expect(withPortFace(p, 'east').face).toBe('east')
    expect(withPortLabel(p, ' 外の水車 ').label).toBe('外の水車')
    expect('label' in withPortLabel({ ...p, label: 'x' }, '  ')).toBe(false)
    expect(p).toEqual(port())
  })

  it('入力欄の文字を数値に直す', () => {
    expect(parsePortNumber(' 12.5 ')).toBe(12.5)
    expect(parsePortNumber('')).toBeNull()
    expect(parsePortNumber('abc')).toBeUndefined()
  })

  it('同じ位置と面の仮の入出力を探す', () => {
    const ports = [port({ id: 'a' }), port({ id: 'b', face: 'east' })]
    expect(portAt(ports, [0, 0, 0], 'east')?.id).toBe('b')
    expect(portAt(ports, [0, 0, 0], 'up')).toBeNull()
  })

  it('面が分からないときは、軸の面のうち外か空きの面を選ぶ', () => {
    const bp = shafts()
    expect(defaultPortFace(bp, [0, 0, 0])).toBe('west')
    expect(defaultPortFace(bp, [2, 0, 0])).toBe('east')
    // 軸がなければ全部の面から（最初は下）
    const stone = blueprintFixture({ size: [1, 2, 1] }).place([0, 1, 0], 'minecraft:stone').place([0, 0, 0], 'minecraft:stone').toBlueprint()
    expect(defaultPortFace(stone, [0, 1, 0])).toBe('up')
  })
})

describe('PortTool', () => {
  it('面をクリックすると置き、2D では面を決めてもらう。空きマスで選択を外す', () => {
    const calls: string[] = []
    const tool = new PortTool({
      setHovered: (p) => calls.push(`hover ${p?.join() ?? 'null'}`),
      defaultFace: () => 'north',
      place: (p, f) => calls.push(`place ${p.join()} ${f}`),
      deselect: () => calls.push('deselect'),
    })
    tool.onHover({ pos: [1, 0, 0], empty: false })
    tool.onHover({ pos: [1, 0, 0], empty: true })
    tool.onClick({ pos: [1, 0, 0], face: 'up', empty: false }, { shift: false })
    tool.onClick({ pos: [2, 0, 0], empty: false }, { shift: false })
    tool.onClick({ pos: [3, 0, 0], empty: true }, { shift: false })
    tool.deactivate()
    expect(calls).toEqual(['hover 1,0,0', 'hover null', 'place 1,0,0 up', 'place 2,0,0 north', 'deselect', 'hover null'])
  })
})

describe('仮の入出力と計算（#70 の完了の条件）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useDocumentSession().close()
  })

  async function setup() {
    const calc = useCalcStore()
    calc.setBackend(new InlineCalcBackend(createBuiltinRegistry()), { delayMs: 0 })
    usePortTool()
    const session = useDocumentSession()
    session.setBlueprint(shafts(), 'shafts.nbt')
    await flushPromises()
    await calc.attach(session.current.value!.blueprint)
    return { calc, ports: usePortStore(), tools: useToolStore() }
  }

  function createOutcome(calc: ReturnType<typeof useCalcStore>) {
    const o = calc.outcomes?.find((x) => x.pluginId === 'create-stress')
    if (!o || o.status !== 'ok') throw new Error('Create の応力の結果がない')
    return o.result
  }

  it('動力源のない設計図に仮の動力源を置くと、回転数と応力が計算され、出どころは仮の入出力', async () => {
    const { calc, ports, tools } = await setup()
    expect(createOutcome(calc).summary[0].value.value).toBe('ネットワーク 1／過負荷 0／止まっている 1')

    expect(tools.setTool('port')).toBe(true)
    tools.click({ pos: [0, 0, 0], face: 'west', empty: false })
    expect(ports.ports).toHaveLength(1)
    expect(ports.selectedId).toBe(ports.ports[0].id)
    ports.update(withPortParam(ports.ports[0], 'rpm', 64))
    await calc.recalculate()

    const result = createOutcome(calc)
    expect(result.issues).toEqual([])
    const net = result.summary.find((s) => s.label === 'ネットワーク 1')
    expect(net?.value.value).toContain('64 RPM')
    expect(net?.value.source).toBe('virtual')
    // プローブ：軸の回転数の出どころも仮の入出力
    useProbeStore().setProbed([2, 0, 0])
    const speed = useProbeStore().readings[0].values.find((v) => v.label === '回転数')
    expect(speed?.value).toEqual({ value: '64 RPM', source: 'virtual' })
  })

  it('仮の負荷を足すと過負荷になり、問題の一覧に出る。消すと戻る', async () => {
    const { calc, ports, tools } = await setup()
    tools.setTool('port')
    tools.click({ pos: [0, 0, 0], face: 'west', empty: false })
    ports.update(withPortParam(ports.ports[0], 'capacity', 1000))
    ports.setPlaceKey('create-stress/rotation-load')
    tools.click({ pos: [2, 0, 0], face: 'east', empty: false })
    const load = ports.ports[1]
    expect(load.kind).toBe('rotation-load')
    ports.update(withPortParam(load, 'stress', 5000))
    await calc.recalculate()
    const result = createOutcome(calc)
    expect(result.summary.some((s) => s.value.value.includes('過負荷'))).toBe(true)
    expect(result.issues.length).toBeGreaterThan(0)
    // 仮の入出力の位置は問題にしない（ブロックの位置だけ）
    expect(result.issues.every((i) => i.pos[0] >= 0 && i.pos[0] <= 2)).toBe(true)

    ports.remove(load.id)
    await calc.recalculate()
    expect(createOutcome(calc).issues).toEqual([])
  })

  it('同じ面をもう一度クリックすると、新しく置かずに選ぶ。別の設計図を開くと消える', async () => {
    const { ports, tools } = await setup()
    tools.setTool('port')
    tools.click({ pos: [0, 0, 0], face: 'west', empty: false })
    tools.click({ pos: [1, 0, 0], empty: true })
    expect(ports.selectedId).toBeNull()
    tools.click({ pos: [0, 0, 0], face: 'west', empty: false })
    expect(ports.ports).toHaveLength(1)
    expect(ports.selectedId).toBe(ports.ports[0].id)

    useDocumentSession().setBlueprint(shafts(), 'other.nbt')
    await flushPromises()
    expect(ports.ports).toEqual([])
    expect(ports.selectedId).toBeNull()
  })

  it('2D（面なし）では「2Dで置く面」の面に置く。「自動」なら軸と隣の空きから決める（#167）', async () => {
    const { ports, tools } = await setup()
    tools.setTool('port')
    tools.click({ pos: [0, 0, 0], empty: false })
    expect(ports.ports[0].face).toBe('west')
    ports.setFace2D('up')
    tools.click({ pos: [1, 0, 0], empty: false })
    expect(ports.ports[1].face).toBe('up')
  })
})

describe('PortPanel', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  function mountPanel() {
    const pinia = createPinia()
    setActivePinia(pinia)
    const calc = useCalcStore()
    calc.setBackend(new InlineCalcBackend(createBuiltinRegistry()), { delayMs: 0 })
    const wrapper = mount(PortPanel, { global: { plugins: [pinia] } })
    return { wrapper, ports: usePortStore(), tools: useToolStore() }
  }

  it('ツールを使っていなくて、置いてもいなければ出さない', () => {
    const { wrapper } = mountPanel()
    expect(wrapper.find('[data-testid="port-panel"]').exists()).toBe(false)
  })

  it('置いた仮の入出力の値を変え、消せる', async () => {
    const { wrapper, ports } = mountPanel()
    ports.place([0, 0, 0], 'west')
    await flushPromises()
    const item = wrapper.find('[data-port]')
    expect(item.text()).toContain('回転の供給')
    expect(item.text()).toContain('[0, 0, 0]')

    const rpm = item.find('input[data-param="rpm"]')
    await rpm.setValue('-128')
    expect(ports.ports[0].params.rpm).toBe(-128)
    // 省略できない値を空にしても変えない
    await rpm.setValue('')
    expect(ports.ports[0].params.rpm).toBe(-128)
    expect((rpm.element as HTMLInputElement).value).toBe('-128')

    await item.find('select[data-field="face"]').setValue('east')
    expect(ports.ports[0].face).toBe('east')
    await item.find('input[data-field="label"]').setValue('外の水車列')
    expect(ports.ports[0].label).toBe('外の水車列')

    await item.find('[data-action="remove-port"]').trigger('click')
    expect(ports.ports).toEqual([])
  })

  it('物の入口のアイテムは、打っている途中で元に戻らず、欄を離れると入る（#127）', async () => {
    const { wrapper, ports } = mountPanel()
    ports.setPlaceKey('create-stress/item-input')
    ports.place([0, 0, 0], 'up')
    await flushPromises()
    const input = wrapper.find('[data-port] input[data-item="item"]')
    const el = input.element as HTMLInputElement
    el.value = 'whe'
    await input.trigger('input')
    expect(el.value).toBe('whe')
    expect(ports.ports[0].items).toBeUndefined()
    el.value = 'wheat'
    await input.trigger('input')
    await input.trigger('change')
    expect(ports.ports[0].items).toEqual({ item: 'minecraft:wheat' })
    expect(el.value).toBe('minecraft:wheat')
  })

  it('負荷の省略できる値は空にできる', async () => {
    const { wrapper, ports } = mountPanel()
    ports.setPlaceKey('create-stress/rotation-load')
    ports.place([0, 0, 0], 'east')
    await flushPromises()
    const item = wrapper.find('[data-port]')
    await item.find('input[data-param="impact"]').setValue('8')
    await item.find('input[data-param="stress"]').setValue('')
    expect(ports.ports[0].params).toEqual({ impact: 8 })
  })

  it('ツールを使っている間は、置く種類を選べる', async () => {
    const { wrapper, ports, tools } = mountPanel()
    usePortTool()
    tools.setTool('port')
    await flushPromises()
    await wrapper.find('select[data-testid="port-kind"]').setValue('create-stress/rotation-load')
    expect(ports.placeOption?.def.kind).toBe('rotation-load')
    await wrapper.find('select[data-testid="port-face-2d"]').setValue('north')
    expect(ports.face2D).toBe('north')
    await wrapper.find('select[data-testid="port-face-2d"]').setValue('auto')
    expect(ports.face2D).toBe('auto')
  })
})

describe('仮の入出力の印', () => {
  it('3D：面の外側に板を置き、隠した段の印は出さない', () => {
    const overlay = new PortOverlay3D()
    const ports = [port({ id: 'a' }), port({ id: 'b', kind: 'rotation-load', face: 'up', pos: [0, 2, 0] })]
    overlay.update(ports, 'a', SHOW_ALL_LAYERS)
    expect(overlay.count()).toBe(2)
    const a = overlay.group.getObjectByName('port-a')!
    expect(a.position.x).toBeLessThan(0)
    expect(a.scale.x).toBeLessThan(a.scale.y)
    overlay.update(ports, null, { layer: 0, mode: 'only', hidden: new Set<number>() })
    expect(overlay.count()).toBe(1)
    overlay.dispose()
    expect(portColor('rotation-source')).toBe(PORT_SOURCE_COLOR)
    expect(portColor('rotation-load')).toBe(PORT_LOAD_COLOR)
  })

  it('2D：東西南北はマスの外の帯、上下はマスの中央', () => {
    const layout: GridLayout2D = { originX: 10, originY: 20, cellSize: 10 }
    expect(portMarkRect(port({ face: 'west', pos: [1, 0, 1] }), layout)).toEqual([17, 30, 3, 10])
    expect(portMarkRect(port({ face: 'south', pos: [1, 0, 1] }), layout)).toEqual([20, 40, 10, 3])
    expect(portMarkRect(port({ face: 'up', pos: [0, 0, 0] }), layout)).toEqual([13, 23, 4, 4])
  })
})

describe('物の入口のアイテム（#127）', () => {
  const port: VirtualPort = { id: 'p', pos: [0, 0, 0], face: 'up', pluginId: 'create-stress', kind: 'item-input', params: { rate: 1 } }

  it('アイテムの欄を入れる・消す。namespace がなければ minecraft: を付ける', () => {
    const withWheat = withPortItem(port, 'item', ' wheat ')
    expect(withWheat.items).toEqual({ item: 'minecraft:wheat' })
    expect(withPortItem(withWheat, 'item', 'create:crushed_raw_iron').items).toEqual({ item: 'create:crushed_raw_iron' })
    expect(withPortItem(withWheat, 'item', '')).not.toHaveProperty('items')
  })

  it('候補は名前か ID に打った文字を含むもの。Modpack がないか、文字が空なら出さない', () => {
    const pack = {
      itemIds: () => ['minecraft:wheat', 'create:wheat_flour', 'minecraft:stone'],
      displayName: (id: { namespace: string; path: string }, lang: 'ja_jp' | 'en_us') =>
        lang === 'ja_jp' ? ({ wheat: '小麦', wheat_flour: '小麦粉' } as Record<string, string>)[id.path] ?? null : null,
    }
    expect(itemCandidates(pack, '小麦')).toEqual([
      { id: 'minecraft:wheat', name: '小麦' },
      { id: 'create:wheat_flour', name: '小麦粉' },
    ])
    expect(itemCandidates(pack, 'stone')).toEqual([{ id: 'minecraft:stone', name: 'minecraft:stone' }])
    expect(itemCandidates(pack, ' ')).toEqual([])
    expect(itemCandidates(null, '小麦')).toEqual([])
  })

  it('物の入口の印は青', () => {
    expect(portColor('item-input')).toBe(PORT_ITEM_COLOR)
  })
})
