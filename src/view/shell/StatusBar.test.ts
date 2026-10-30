import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it } from 'vitest'
import { blueprintFixture } from '../../../tests/fixtures/blueprintFixture'
import { noopCalcPlugin } from '../../../tests/fixtures/noopCalcPlugin'
import { InlineCalcBackend } from '../../calc/calcScheduler'
import { PluginRegistry } from '../../calc/pluginRegistry'
import { nbt } from '../../domain/nbt'
import { useCalcStore } from '../stores/calcStore'
import StatusBar from './StatusBar.vue'

function setup() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const calc = useCalcStore()
  calc.setBackend(new InlineCalcBackend(new PluginRegistry([noopCalcPlugin()])), { delayMs: 0 })
  const wrapper = mount(StatusBar, { global: { plugins: [pinia] } })
  return { calc, wrapper }
}

describe('StatusBar（下の状態表示）', () => {
  it('設計図を開いている間は、問題の件数を重さごとに出す（0 件でも出す。#159）', async () => {
    const { calc, wrapper } = setup()
    expect(wrapper.find('[data-status="issues"]').exists()).toBe(false)

    await calc.attach(blueprintFixture({ size: [1, 1, 1] }).place([0, 0, 0], 'minecraft:stone').toBlueprint())
    await flushPromises()
    const counts = () => wrapper.findAll('[data-status="issues"] .count').map((c) => c.text())
    expect(counts()).toEqual(['エラー 0', '警告 0', '情報 0'])

    const bp = blueprintFixture({ size: [3, 1, 1] })
      .place([0, 0, 0], 'create:shaft', { axis: 'x' }, nbt.compound({ Broken: nbt.byte(1) }))
      .place([1, 0, 0], 'create:shaft', { axis: 'x' }, nbt.compound({ Broken: nbt.byte(2) }))
      .place([2, 0, 0], 'create:shaft', { axis: 'x' }, nbt.compound({ Broken: nbt.byte(2) }))
      .toBlueprint()
    await calc.attach(bp)
    await flushPromises()
    expect(counts()).toEqual(['エラー 1', '警告 2', '情報 0'])
    expect(wrapper.find('.count[data-severity="error"]').classes()).toContain('some')
    expect(wrapper.find('.count[data-severity="info"]').classes()).not.toContain('some')
  })
})
