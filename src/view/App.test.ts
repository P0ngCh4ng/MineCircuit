import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import App from './App.vue'

describe('App', () => {
  it('非公式ツールであることを表示する', () => {
    const wrapper = mount(App)
    expect(wrapper.text()).toContain('非公式ツールです')
  })
})
