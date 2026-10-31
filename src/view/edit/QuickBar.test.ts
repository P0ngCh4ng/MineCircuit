import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { BlockState } from '../../domain/blockState'
import { ResourceLocation } from '../../domain/resourceLocation'
import { useBrushStore } from '../stores/brushStore'
import { QUICK_BAR_KEY, useQuickBarStore } from '../stores/quickBarStore'
import { useToolStore } from '../stores/toolStore'
import { QUICK_ACTION_RUNNER, type QuickActionRunner } from './quickActions'
import QuickBar from './QuickBar.vue'

const state = (id: string, properties: Record<string, string> = {}) =>
  new BlockState(ResourceLocation.parse(id), properties)

function mountBar(runner?: QuickActionRunner) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const brush = useBrushStore()
  const bar = useQuickBarStore()
  const tools = useToolStore()
  const wrapper = mount(QuickBar, {
    global: { plugins: [pinia], provide: runner ? { [QUICK_ACTION_RUNNER as symbol]: runner } : {} },
  })
  return { wrapper, brush, bar, tools }
}

const slotKeys = (wrapper: ReturnType<typeof mountBar>['wrapper']) =>
  wrapper.findAll('[data-slot]').map((b) => b.attributes('data-key'))

describe('QuickBar', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('置くブロックにしたものを左に並べ、空なら説明を出す', async () => {
    const { wrapper, brush } = mountBar()
    expect(wrapper.text()).toContain('棚から選んだブロックがここに並びます')
    brush.setFromBlock(state('create:shaft', { axis: 'y' }))
    brush.setFromBlock(state('create:cogwheel', { axis: 'y' }))
    await nextTick()
    expect(slotKeys(wrapper)).toEqual(['create:cogwheel[axis=y]', 'create:shaft[axis=y]'])
    expect(wrapper.get('[data-slot="0"]').attributes('aria-pressed')).toBe('true')
  })

  it('回すとマスの状態も変わり、並びは変えない', async () => {
    const { wrapper, brush } = mountBar()
    brush.setFromBlock(state('create:shaft', { axis: 'y' }))
    brush.setFromBlock(state('create:cogwheel', { axis: 'x' }))
    expect(brush.rotate(false)).toBe(true)
    await nextTick()
    expect(slotKeys(wrapper)).toEqual(['create:cogwheel[axis=z]', 'create:shaft[axis=y]'])
  })

  it('クリックでそのブロックを置くブロックにして置くツールにし、並びは変えない', async () => {
    const { wrapper, brush, tools } = mountBar()
    tools.register({ id: 'place', onHover: () => {}, onClick: () => {} })
    brush.setFromBlock(state('create:shaft', { axis: 'x' }))
    brush.setFromBlock(state('create:cogwheel', { axis: 'y' }))
    await nextTick()
    await wrapper.get('[data-slot="1"]').trigger('click')
    expect(brush.state?.key).toBe('create:shaft[axis=x]')
    expect(tools.activeToolId).toBe('place')
    expect(slotKeys(wrapper)).toEqual(['create:cogwheel[axis=y]', 'create:shaft[axis=x]'])
  })

  it('右クリックで固定し、固定したものは左に残る', async () => {
    const { wrapper, brush } = mountBar()
    brush.setFromBlock(state('create:shaft', { axis: 'y' }))
    brush.setFromBlock(state('create:cogwheel', { axis: 'y' }))
    await nextTick()
    await wrapper.get('[data-slot="1"]').trigger('contextmenu')
    brush.setFromBlock(state('create:gearbox'))
    await nextTick()
    expect(slotKeys(wrapper)).toEqual(['create:shaft[axis=y]', 'create:gearbox', 'create:cogwheel[axis=y]'])
    expect(wrapper.get('[data-slot="0"]').attributes('aria-label')).toContain('固定')
  })

  it('操作のボタンは渡された処理を呼び、押せないものは押せない', async () => {
    const run = vi.fn()
    const { wrapper } = mountBar({ run, enabled: (id) => id !== 'redo' })
    expect(wrapper.findAll('[data-action^="quick-"]').map((b) => b.attributes('data-action'))).toEqual([
      'quick-undo',
      'quick-redo',
      'quick-rotate',
      'quick-rotateVertical',
      'quick-menu',
    ])
    expect(wrapper.get('[data-action="quick-redo"]').attributes('disabled')).toBeDefined()
    await wrapper.get('[data-action="quick-rotate"]').trigger('click')
    expect(run).toHaveBeenCalledWith('rotate')
  })

  it('「…」で操作を出し入れ・並べ替えし、初期に戻せる', async () => {
    const { wrapper } = mountBar({ run: () => {}, enabled: () => true })
    const shown = () => wrapper.findAll('.actions button').map((b) => b.attributes('data-action'))
    await wrapper.get('[data-action="quick-menu"]').trigger('click')
    await wrapper.get('[data-toggle="redo"]').trigger('change')
    expect(shown()).toEqual(['quick-undo', 'quick-rotate', 'quick-rotateVertical'])
    await wrapper.get('[data-move-up="rotateVertical"]').trigger('click')
    expect(shown()).toEqual(['quick-undo', 'quick-rotateVertical', 'quick-rotate'])
    await wrapper.get('[data-action="quick-reset"]').trigger('click')
    expect(shown()).toEqual(['quick-undo', 'quick-redo', 'quick-rotate', 'quick-rotateVertical'])
  })

  it('最近のブロックと固定・操作の並びを保存し、次に開いても残る', async () => {
    const first = mountBar()
    first.brush.setFromBlock(state('create:shaft', { axis: 'y' }))
    first.bar.pin(0)
    first.bar.toggle('undo')
    first.wrapper.unmount()
    expect(localStorage.getItem(QUICK_BAR_KEY)).not.toBeNull()

    const second = mountBar()
    expect(second.bar.slots.map((s) => [s.state.key, s.pinned])).toEqual([['create:shaft[axis=y]', true]])
    expect(second.bar.actions).toEqual(['redo', 'rotate', 'rotateVertical'])
  })
})
