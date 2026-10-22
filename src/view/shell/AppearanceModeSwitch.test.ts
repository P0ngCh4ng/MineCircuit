import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { fakeAppearanceSet } from '../../../tests/fixtures/fakeAppearance'
import { useAppearanceStore } from '../stores/appearanceStore'
import AppearanceModeSwitch from './AppearanceModeSwitch.vue'

let pinia: Pinia
beforeEach(() => {
  pinia = createPinia()
  setActivePinia(pinia)
})

const mountSwitch = () => mount(AppearanceModeSwitch, { global: { plugins: [pinia] } })

describe('AppearanceModeSwitch', () => {
  it('見た目がないときは押せず、色が選ばれていて、理由を出す', () => {
    const wrapper = mountSwitch()
    const texture = wrapper.get('[data-appearance-mode="texture"]')
    const color = wrapper.get('[data-appearance-mode="color"]')
    expect(texture.attributes('disabled')).toBeDefined()
    expect(color.attributes('disabled')).toBeDefined()
    expect(color.attributes('aria-pressed')).toBe('true')
    expect(texture.attributes('title')).toContain('Modpack を選ぶと')
  })

  it('見た目があれば、テクスチャと色を切り替えられる', async () => {
    const store = useAppearanceStore()
    store.setAppearanceSet(fakeAppearanceSet())
    const wrapper = mountSwitch()
    await wrapper.vm.$nextTick()
    const texture = wrapper.get('[data-appearance-mode="texture"]')
    const color = wrapper.get('[data-appearance-mode="color"]')
    expect(texture.attributes('disabled')).toBeUndefined()
    expect(texture.attributes('aria-pressed')).toBe('true')

    await color.trigger('click')
    expect(store.effectiveMode).toBe('color')
    expect(color.attributes('aria-pressed')).toBe('true')
    await texture.trigger('click')
    expect(store.effectiveMode).toBe('texture')
  })

  it('読めなかったものの件数を出す', async () => {
    useAppearanceStore().setAppearanceSet(fakeAppearanceSet(['x', 'y', 'z']))
    const wrapper = mountSwitch()
    await wrapper.vm.$nextTick()
    expect(wrapper.get('[data-testid="appearance-status"]').text()).toBe('読めないもの 3 件')
  })
})
