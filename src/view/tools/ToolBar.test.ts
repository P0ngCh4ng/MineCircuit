import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h } from 'vue'
import { useToolStore } from '../stores/toolStore'
import type { Tool } from './tool'
import ToolBar from './ToolBar.vue'
import { useKeyboardShortcuts } from './useKeyboardShortcuts'

function fakeTool(id: Tool['id']): Tool {
  return { id, onHover: () => {}, onClick: () => {} }
}

function mountBar() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useToolStore()
  const wrapper = mount(ToolBar, { global: { plugins: [pinia] } })
  return { store, wrapper }
}

describe('ToolBar', () => {
  it('すべてのツールを並べ、選択ツールだけが最初から使える', () => {
    const { wrapper } = mountBar()
    const buttons = wrapper.findAll('button')
    expect(buttons.map((b) => b.attributes('data-tool'))).toEqual([
      'select',
      'measure',
      'connect',
      'probe',
      'place',
      'erase',
      'pick',
    ])
    expect(wrapper.get('[data-tool="select"]').attributes('aria-pressed')).toBe('true')
    expect(wrapper.get('[data-tool="measure"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[data-tool="measure"]').attributes('title')).toContain('まだ使えません')
  })

  it('登録したツールはボタンで切り替えられる', async () => {
    const { store, wrapper } = mountBar()
    store.register(fakeTool('measure'))
    await wrapper.vm.$nextTick()
    await wrapper.get('[data-tool="measure"]').trigger('click')
    expect(store.activeToolId).toBe('measure')
    expect(wrapper.get('[data-tool="measure"]').attributes('aria-pressed')).toBe('true')
    expect(wrapper.get('[data-tool="select"]').attributes('aria-pressed')).toBe('false')
  })
})

describe('useKeyboardShortcuts', () => {
  it('キーでツールを切り替え、入力欄で打った文字は無視する', () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useToolStore()
    store.register(fakeTool('place'))
    const Host = defineComponent({
      setup() {
        useKeyboardShortcuts({ tool: (a) => store.setTool(a.id) })
        return () => h('input')
      },
    })
    const wrapper = mount(Host, { global: { plugins: [pinia] }, attachTo: document.body })

    const input = wrapper.get('input').element
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', bubbles: true }))
    expect(store.activeToolId).toBe('select')

    const e = new KeyboardEvent('keydown', { key: 'b', bubbles: true, cancelable: true })
    window.dispatchEvent(e)
    expect(store.activeToolId).toBe('place')
    expect(e.defaultPrevented).toBe(true)

    // 処理のない操作（G）は既定の動きを止めない
    const g = new KeyboardEvent('keydown', { key: 'g', cancelable: true })
    window.dispatchEvent(g)
    expect(g.defaultPrevented).toBe(false)
    wrapper.unmount()
  })
})

describe('useToolStore', () => {
  it('選択ツールのクリックで選択中のブロックが変わる', () => {
    setActivePinia(createPinia())
    const store = useToolStore()
    store.hover({ pos: [1, 0, 1], face: 'up', empty: false })
    expect(store.hoveredPos).toEqual([1, 0, 1])
    store.click({ pos: [1, 0, 1], face: 'up', empty: false })
    expect(store.selectedPos).toEqual([1, 0, 1])
    store.click({ pos: [5, 0, 1], empty: true })
    expect(store.selectedPos).toBeNull()
  })
})
