import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h, markRaw, nextTick } from 'vue'
import { blueprintFixture } from '../../../tests/fixtures/blueprintFixture'
import { fakeJar } from '../../../tests/fixtures/fakeJar'
import { scanJar } from '../../io/modpack/jarScanner'
import { Modpack } from '../../io/modpack/modpack'
import { createDocumentSession, provideDocumentSession } from '../document/documentSession'
import { useBrushStore } from '../stores/brushStore'
import { setModpackLoadEnvironment, useModpackContentStore } from '../stores/modpackContent'
import BrushPicker from './BrushPicker.vue'

const facings = ['north', 'east', 'south', 'west', 'up', 'down']

/** Create に似せた小さな Modpack（本物の jar の中身は入れない） */
function createLikePack(): Modpack {
  const jar = fakeJar({
    forgeMods: [{ modId: 'create' }],
    blockStates: {
      'create:creative_motor': { variants: Object.fromEntries(facings.map((f) => [`facing=${f}`, { model: 'x' }])) },
      'create:shaft': { variants: { 'axis=x': { model: 'x' }, 'axis=y': { model: 'x' }, 'axis=z': { model: 'x' } } },
    },
    lang: {
      create: {
        ja_jp: { 'block.create.creative_motor': 'クリエイティブモーター', 'block.create.shaft': 'シャフト' },
        en_us: { 'block.create.creative_motor': 'Creative Motor', 'block.create.shaft': 'Shaft' },
      },
    },
  })
  return new Modpack([scanJar('create.jar', jar)], null)
}

function mountPicker() {
  const session = createDocumentSession()
  session.setBlueprint(
    blueprintFixture({ size: [2, 1, 1] }).place([0, 0, 0], 'minecraft:stone').toBlueprint(),
  )
  const Host = defineComponent({
    setup() {
      provideDocumentSession(session)
      return () => h(BrushPicker)
    },
  })
  return mount(Host)
}

async function loadPack(): Promise<void> {
  const content = useModpackContentStore()
  content.pack = markRaw(createLikePack())
  content.phase = 'loaded'
  await nextTick()
}

describe('BrushPicker（Modpack から探す）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    setModpackLoadEnvironment({ cache: null, scan: null })
  })

  afterEach(() => {
    setModpackLoadEnvironment(null)
  })

  it('「モーター」と入力するとクリエイティブモーターが出て、選ぶと置くブロックになる', async () => {
    const wrapper = mountPicker()
    await loadPack()
    const input = wrapper.find('[data-testid="brush-input"]')
    await input.setValue('モーター')
    const items = wrapper.findAll('[data-testid="brush-results"] li')
    expect(items.map((li) => li.attributes('data-id'))).toEqual(['create:creative_motor'])
    expect(items[0].text()).toContain('クリエイティブモーター')
    await items[0].trigger('click')
    const brush = useBrushStore()
    expect(brush.state?.key).toBe('create:creative_motor[facing=north]')
    expect((input.element as HTMLInputElement).value).toBe('')
    expect(wrapper.find('[data-testid="brush-current"]').text()).toContain('クリエイティブモーター')
  })

  it('向きをブロック状態の定義の値から選べる', async () => {
    const wrapper = mountPicker()
    await loadPack()
    await wrapper.find('[data-testid="brush-input"]').setValue('motor')
    await wrapper.find('form').trigger('submit')
    const select = wrapper.find('[data-testid="brush-props"] select[data-prop="facing"]')
    expect(select.findAll('option').map((o) => o.text())).toEqual(facings)
    await select.setValue('up')
    expect(useBrushStore().state?.key).toBe('create:creative_motor[facing=up]')
  })

  it('↓ と Enter で結果の行を選ぶ。"[" を含む入力は ID として使う', async () => {
    const wrapper = mountPicker()
    await loadPack()
    const input = wrapper.find('[data-testid="brush-input"]')
    await input.setValue('create')
    expect(wrapper.findAll('[data-testid="brush-results"] li')).toHaveLength(2)
    await input.trigger('keydown', { key: 'ArrowDown' })
    const active = wrapper.find('[data-testid="brush-results"] li.active').attributes('data-id')
    await wrapper.find('form').trigger('submit')
    expect(useBrushStore().state?.id.toString()).toBe(active)

    await input.setValue('create:shaft[axis=z]')
    expect(wrapper.find('[data-testid="brush-results"]').exists()).toBe(false)
    await wrapper.find('form').trigger('submit')
    expect(useBrushStore().state?.key).toBe('create:shaft[axis=z]')
  })

  it('合うものがなければそう出し、Enter で ID として使う', async () => {
    const wrapper = mountPicker()
    await loadPack()
    const input = wrapper.find('[data-testid="brush-input"]')
    await input.setValue('minecraft:glass')
    expect(wrapper.find('[data-testid="brush-results-summary"]').text()).toContain('Modpack にありません')
    await wrapper.find('form').trigger('submit')
    expect(useBrushStore().state?.key).toBe('minecraft:glass')
  })

  it('Modpack がなければ今どおり ID の入力と設計図のブロックの候補だけ', async () => {
    const wrapper = mountPicker()
    expect(wrapper.find('label[for="brush-id"]').text()).toBe('ID を入力')
    expect(wrapper.find('#brush-id-list').findAll('option').map((o) => o.attributes('value'))).toEqual([
      'minecraft:stone',
    ])
    const input = wrapper.find('[data-testid="brush-input"]')
    await input.setValue('モーター')
    expect(wrapper.find('[data-testid="brush-results"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="brush-props"]').exists()).toBe(false)
    await input.setValue('create:shaft[axis=y]')
    await wrapper.find('form').trigger('submit')
    expect(useBrushStore().state?.key).toBe('create:shaft[axis=y]')
    expect(wrapper.find('[data-testid="brush-props"]').exists()).toBe(false)
  })
})
