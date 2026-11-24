import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import type { PluginOutcome } from '../../calc/pluginRegistry'
import { useCalcStore } from '../stores/calcStore'
import RotationLegend from './RotationLegend.vue'

function outcome(pluginId: string, speedLevelNote?: string): PluginOutcome {
  return {
    pluginId,
    label: pluginId,
    status: 'ok',
    result: { summary: [], issues: [], assumptions: [], ...(speedLevelNote ? { speedLevelNote } : {}) },
  }
}

describe('RotationLegend', () => {
  it('境目の説明は、計算プラグインが返したものを出す（#267）', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const calc = useCalcStore()
    const wrapper = mount(RotationLegend, { global: { plugins: [pinia] } })
    // 計算の前は境目の説明を出さない（Mod の言葉を固定しない）
    expect(wrapper.findAll('[data-testid="speed-level-note"]')).toHaveLength(0)
    expect(wrapper.text()).not.toContain('Create')

    calc.outcomes = [outcome('a', '境目 A'), outcome('b'), outcome('c', '境目 A'), outcome('d', '境目 D')]
    await wrapper.vm.$nextTick()
    expect(wrapper.findAll('[data-testid="speed-level-note"]').map((n) => n.text())).toEqual(['境目 A', '境目 D'])
  })
})
