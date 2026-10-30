import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h, nextTick } from 'vue'
import { blueprintFixture } from '../../../tests/fixtures/blueprintFixture'
import { createDocumentSession, provideDocumentSession, type DocumentSession } from '../document/documentSession'
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
  return { session, bp: doc.blueprint, wrapper, tools }
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

  it('座標（段は1始まり）と大きさだけを出す。範囲の操作のボタンはツールバーにある（#160）', async () => {
    const { wrapper } = await setup()
    await nextTick()
    const value = (sel: string) => (wrapper.get(`[data-coord="${sel}"]`).element as HTMLInputElement).value
    expect([value('min-0'), value('min-1'), value('min-2')]).toEqual(['0', '1', '0'])
    expect([value('max-0'), value('max-1'), value('max-2')]).toEqual(['2', '2', '0'])
    expect(wrapper.get('[data-selection="size"]').text()).toBe('3 × 2 × 1（6 マス）')
    expect(wrapper.findAll('[data-action]')).toEqual([])
    expect(wrapper.find('[data-selection="count"]').exists()).toBe(false)
  })

  it('座標を打つと範囲が変わる。最小と最大が逆なら入れ替える', async () => {
    const { wrapper, tools } = await setup()
    await nextTick()
    const maxY = wrapper.get('[data-coord="max-1"]')
    await maxY.setValue('3')
    await maxY.trigger('change')
    expect(tools.selectionBox).toEqual({ min: [0, 0, 0], max: [2, 2, 0] })
    expect(wrapper.get('[data-selection="size"]').text()).toBe('3 × 3 × 1（9 マス）')

    const minX = wrapper.get('[data-coord="min-0"]')
    await minX.setValue('9')
    await minX.trigger('change')
    // 9 は設計図の外なので 3 に切り詰め、最大の 2 と入れ替わる
    expect(tools.selectionBox).toEqual({ min: [2, 0, 0], max: [3, 2, 0] })
  })

  it('「選択の解除」で範囲を消す', async () => {
    const { wrapper, tools } = await setup()
    await wrapper.get('button.small').trigger('click')
    expect(tools.selectionBox).toBeNull()
    expect(tools.selectedPos).toBeNull()
  })
})
