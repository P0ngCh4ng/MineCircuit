import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h, nextTick } from 'vue'
import { blueprintFixture, state } from '../../../tests/fixtures/blueprintFixture'
import { createDocumentSession, provideDocumentSession, type DocumentSession } from '../document/documentSession'
import { useBrushStore } from '../stores/brushStore'
import { setModpackLoadEnvironment } from '../stores/modpackContent'
import { useToolStore } from '../stores/toolStore'
import SelectionPanel from './SelectionPanel.vue'

function blueprint() {
  return blueprintFixture({ size: [4, 3, 1] })
    .place([0, 0, 0], 'create:shaft', { axis: 'x' })
    .place([1, 0, 0], 'create:shaft', { axis: 'x' })
    .place([2, 0, 0], 'minecraft:stone')
    .place([0, 1, 0], 'minecraft:dirt')
    .place([3, 2, 0], 'minecraft:stone')
    .toBlueprint()
}

function mountWith(session: DocumentSession) {
  const Host = defineComponent({
    setup() {
      provideDocumentSession(session)
      return () => h(SelectionPanel)
    },
  })
  return mount(Host)
}

async function setup() {
  const session = createDocumentSession()
  const doc = session.setBlueprint(blueprint())
  const wrapper = mountWith(session)
  const tools = useToolStore()
  tools.setSelectionBox({ min: [0, 0, 0], max: [2, 1, 0] })
  await nextTick()
  return { session, bp: doc.blueprint, wrapper, tools, brush: useBrushStore() }
}

describe('SelectionPanel', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    setModpackLoadEnvironment({ cache: null, scan: null })
  })

  afterEach(() => {
    setModpackLoadEnvironment(null)
  })

  it('座標（段は1始まり）・大きさ・ブロックの数・多い種類を出す', async () => {
    const { wrapper } = await setup()
    await nextTick()
    const value = (sel: string) => (wrapper.get(`[data-coord="${sel}"]`).element as HTMLInputElement).value
    expect([value('min-0'), value('min-1'), value('min-2')]).toEqual(['0', '1', '0'])
    expect([value('max-0'), value('max-1'), value('max-2')]).toEqual(['2', '2', '0'])
    expect(wrapper.get('[data-selection="size"]').text()).toBe('3 × 2 × 1（6 マス）')
    expect(wrapper.get('[data-selection="count"]').text()).toBe('4 個')
    expect(wrapper.findAll('[data-kind]').map((li) => li.attributes('data-kind'))).toEqual([
      'create:shaft',
      'minecraft:dirt',
      'minecraft:stone',
    ])
    // Modpack がなければ名前の代わりに ID を出す
    expect(wrapper.get('[data-kind="create:shaft"] .kind-name').text()).toBe('create:shaft')
    expect(wrapper.findAll('[data-action]').map((b) => b.attributes('data-action'))).toEqual([
      'erase',
      'rotate-right',
      'rotate-left',
      'mirror-x',
      'mirror-z',
      'copy',
      'cut',
      'duplicate',
      'fill',
      'replace',
    ])
  })

  it('座標を打つと範囲が変わる。最小と最大が逆なら入れ替える', async () => {
    const { wrapper, tools } = await setup()
    await nextTick()
    const maxY = wrapper.get('[data-coord="max-1"]')
    await maxY.setValue('3')
    await maxY.trigger('change')
    expect(tools.selectionBox).toEqual({ min: [0, 0, 0], max: [2, 2, 0] })
    expect(wrapper.get('[data-selection="count"]').text()).toBe('4 個')

    const maxX = wrapper.get('[data-coord="max-0"]')
    await maxX.setValue('3')
    await maxX.trigger('change')
    expect(wrapper.get('[data-selection="count"]').text()).toBe('5 個')

    const minX = wrapper.get('[data-coord="min-0"]')
    await minX.setValue('9')
    await minX.trigger('change')
    // 9 は設計図の外なので 3 に切り詰め、最大の 3 と入れ替わる
    expect(tools.selectionBox).toEqual({ min: [3, 0, 0], max: [3, 2, 0] })
  })

  it('「消す」で範囲の中を消し、範囲は残す。1回で元に戻る', async () => {
    const { wrapper, session, bp, tools } = await setup()
    await wrapper.get('[data-action="erase"]').trigger('click')
    expect(bp.get([0, 0, 0])).toBeNull()
    expect(bp.get([0, 1, 0])).toBeNull()
    expect(bp.get([3, 2, 0])?.key).toBe('minecraft:stone')
    expect(tools.selectionBox).toEqual({ min: [0, 0, 0], max: [2, 1, 0] })
    expect(wrapper.get('[data-selection="count"]').text()).toBe('0 個')
    session.undo()
    expect(bp.get([0, 0, 0])?.key).toBe('create:shaft[axis=x]')
    expect(bp.get([0, 1, 0])?.key).toBe('minecraft:dirt')
  })

  it('「左右反転（X）」は範囲の中で写し、「回す（右）」ははみ出せば設計図を広げる。どちらも1回で元に戻る', async () => {
    const { wrapper, session, bp, brush } = await setup()
    await wrapper.get('[data-action="mirror-x"]').trigger('click')
    expect(bp.get([0, 0, 0])?.key).toBe('minecraft:stone')
    expect(bp.get([2, 0, 0])?.key).toBe('create:shaft[axis=x]')
    expect(bp.get([2, 1, 0])?.key).toBe('minecraft:dirt')
    session.undo()
    expect(bp.get([0, 0, 0])?.key).toBe('create:shaft[axis=x]')

    await wrapper.get('[data-action="rotate-right"]').trigger('click')
    // 中心 [1,0,0] のまわりで x 0〜2 が z −1〜1 になるので、z が +1 ずれ、奥行きが 3 になる
    expect(session.current.value!.blueprint.size).toEqual([4, 3, 3])
    expect(bp.get([1, 0, 0])?.key).toBe('create:shaft[axis=z]')
    expect(bp.get([1, 0, 2])?.key).toBe('minecraft:stone')
    expect(brush.message).toBe('設計図を負の向きに広げたので、座標が z +1 ずれました')
    session.undo()
    expect(bp.size).toEqual([4, 3, 1])
    expect(bp.get([0, 0, 0])?.key).toBe('create:shaft[axis=x]')
  })

  it('「置くブロックで塗る」は初期値で空きだけを塗る。外すと全部を塗る', async () => {
    const { wrapper, bp, brush } = await setup()
    await wrapper.get('[data-action="fill"]').trigger('click')
    expect(brush.message).toBe('置くブロックを選んでください（左パネルの棚か、スポイト）')

    brush.setFromBlock(state('minecraft:glass'))
    await nextTick()
    expect((wrapper.get('[data-option="only-empty"]').element as HTMLInputElement).checked).toBe(true)
    await wrapper.get('[data-action="fill"]').trigger('click')
    expect(bp.get([1, 1, 0])?.key).toBe('minecraft:glass')
    expect(bp.get([0, 0, 0])?.key).toBe('create:shaft[axis=x]')

    await wrapper.get('[data-option="only-empty"]').setValue(false)
    await wrapper.get('[data-action="fill"]').trigger('click')
    expect(bp.get([0, 0, 0])?.key).toBe('minecraft:glass')
    expect(bp.get([3, 2, 0])?.key).toBe('minecraft:stone')
  })

  it('置き換え：範囲の中の状態から選び、置くブロックにする。向きは初期値で引き継ぐ', async () => {
    const { wrapper, bp, brush } = await setup()
    await nextTick()
    const select = wrapper.get('[data-option="replace-from"]')
    expect(select.findAll('option').map((o) => o.attributes('value'))).toEqual([
      'create:shaft[axis=x]',
      'minecraft:dirt',
      'minecraft:stone',
    ])
    brush.setFromBlock(state('create:cogwheel', { axis: 'y' }))
    await nextTick()
    expect(wrapper.get('[data-selection="replace-to"]').text()).toBe('create:cogwheel[axis=y]')
    expect((wrapper.get('[data-option="keep-orientation"]').element as HTMLInputElement).checked).toBe(true)

    await wrapper.get('[data-action="replace"]').trigger('click')
    expect(bp.get([0, 0, 0])?.key).toBe('create:cogwheel[axis=x]')
    expect(bp.get([1, 0, 0])?.key).toBe('create:cogwheel[axis=x]')
    expect(bp.get([2, 0, 0])?.key).toBe('minecraft:stone')

    // 石を選び、向きを引き継がずに置き換える
    await select.setValue('minecraft:stone')
    await wrapper.get('[data-option="keep-orientation"]').setValue(false)
    await wrapper.get('[data-action="replace"]').trigger('click')
    expect(bp.get([2, 0, 0])?.key).toBe('create:cogwheel[axis=y]')
    expect(bp.get([3, 2, 0])?.key).toBe('minecraft:stone')
  })

  it('「選択の解除」で範囲を消す', async () => {
    const { wrapper, tools } = await setup()
    await wrapper.get('button.small').trigger('click')
    expect(tools.selectionBox).toBeNull()
    expect(tools.selectedPos).toBeNull()
  })
})
