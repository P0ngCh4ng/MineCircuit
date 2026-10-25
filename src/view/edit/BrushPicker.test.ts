import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h, markRaw, nextTick } from 'vue'
import { blueprintFixture } from '../../../tests/fixtures/blueprintFixture'
import { fakeJar } from '../../../tests/fixtures/fakeJar'
import { scanJar } from '../../io/modpack/jarScanner'
import { Modpack } from '../../io/modpack/modpack'
import { createDocumentSession, provideDocumentSession } from '../document/documentSession'
import { fakeAppearanceSet } from '../../../tests/fixtures/fakeAppearance'
import type { AppearanceSet } from '../../domain/blockModel'
import type { BlockState } from '../../domain/blockState'
import type { DisposableAppearanceProvider } from '../../workers/appearanceWorkerClient'
import { useBlockIconStore } from '../stores/blockIconStore'
import { useBrushStore } from '../stores/brushStore'
import { setModpackLoadEnvironment, useModpackContentStore } from '../stores/modpackContent'
import BrushPicker from './BrushPicker.vue'

const facings = ['north', 'east', 'south', 'west', 'up', 'down']

/** シャフトにだけ見た目を返す provider（ほかは null） */
class AnyStateProvider implements DisposableAppearanceProvider {
  async prepare(states: readonly BlockState[]): Promise<AppearanceSet> {
    const base = fakeAppearanceSet()
    const cube = base.appearances['test:red_block']!
    return { ...base, appearances: Object.fromEntries(states.map((s) => [s.key, s.id.path === 'shaft' ? cube : null])) }
  }
  dispose(): void {}
}

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

  it('Mod のタブに、ブロックが表示名の順で並び、クリックすると置くブロックになる', async () => {
    const wrapper = mountPicker()
    await loadPack()
    expect(wrapper.findAll('[data-testid="shelf-tabs"] button').map((b) => b.text())).toEqual(['この設計図', 'create'])
    await wrapper.find('[data-tab="ns:create"]').trigger('click')
    const cells = wrapper.findAll('[data-testid="shelf"] button')
    expect(cells.map((c) => c.attributes('data-key'))).toEqual(['create:creative_motor[facing=north]', 'create:shaft[axis=x]'])
    expect(cells[0]!.attributes('aria-label')).toBe('クリエイティブモーター')
    expect(cells[0]!.attributes('title')).toContain('Creative Motor')
    await cells[0]!.trigger('click')
    expect(useBrushStore().state?.key).toBe('create:creative_motor[facing=north]')
    expect(wrapper.find('[data-testid="brush-current"]').text()).toContain('クリエイティブモーター')
    expect(wrapper.find('[data-testid="shelf"] button.on').attributes('data-key')).toBe('create:creative_motor[facing=north]')
  })

  it('向きをブロック状態の定義の値から選べる', async () => {
    const wrapper = mountPicker()
    await loadPack()
    await wrapper.find('[data-tab="ns:create"]').trigger('click')
    await wrapper.find('[data-key="create:creative_motor[facing=north]"]').trigger('click')
    const select = wrapper.find('[data-testid="brush-props"] select[data-prop="facing"]')
    expect(select.findAll('option').map((o) => o.text())).toEqual(facings)
    await select.setValue('up')
    expect(useBrushStore().state?.key).toBe('create:creative_motor[facing=up]')
  })

  it('欄の文字で今のタブを絞り込み、1件なら Enter で使う。2件以上ならそう出す', async () => {
    const wrapper = mountPicker()
    await loadPack()
    await wrapper.find('[data-tab="ns:create"]').trigger('click')
    const input = wrapper.find('[data-testid="brush-input"]')
    await input.setValue('モーター')
    expect(wrapper.findAll('[data-testid="shelf"] button').map((c) => c.attributes('data-key'))).toEqual([
      'create:creative_motor[facing=north]',
    ])
    await wrapper.find('form').trigger('submit')
    expect(useBrushStore().state?.id.toString()).toBe('create:creative_motor')
    expect((input.element as HTMLInputElement).value).toBe('')

    await input.setValue('create')
    await wrapper.find('form').trigger('submit')
    expect(wrapper.find('[role="alert"]').text()).toContain('2 件あります')
  })

  it('"[" を含む入力と、合うものがない ID は、Enter で ID として使う', async () => {
    const wrapper = mountPicker()
    await loadPack()
    const input = wrapper.find('[data-testid="brush-input"]')
    await input.setValue('create:shaft[axis=z]')
    await wrapper.find('form').trigger('submit')
    expect(useBrushStore().state?.key).toBe('create:shaft[axis=z]')

    await input.setValue('minecraft:glass')
    expect(wrapper.find('[data-testid="shelf-summary"]').text()).toContain('このタブにありません')
    await wrapper.find('form').trigger('submit')
    expect(useBrushStore().state?.key).toBe('minecraft:glass')
  })

  it('アイコンを頼み、描けたものは絵で、描けないものは色と略称で出す', async () => {
    useBlockIconStore().useFactories({
      createProvider: () => new AnyStateProvider(),
      createRasterizer: () => ({ draw: () => 'data:image/png;base64,AAAA', dispose() {} }),
    })
    const wrapper = mountPicker()
    await loadPack()
    await wrapper.find('[data-tab="ns:create"]').trigger('click')
    await flushPromises()
    await vi.waitFor(() => expect(wrapper.findAll('[data-testid="shelf"] img')).toHaveLength(1))
    // シャフトだけ見た目がある（AnyStateProvider）。モーターは色と略称
    expect(wrapper.find('[data-key="create:shaft[axis=x]"] img').attributes('src')).toBe('data:image/png;base64,AAAA')
    expect(wrapper.find('[data-key="create:creative_motor[facing=north]"] .fallback').text()).toBe('CM')
  })

  it('Modpack がなければ「この設計図」のタブと ID の入力だけ', async () => {
    const wrapper = mountPicker()
    expect(wrapper.find('label[for="brush-id"]').text()).toBe('ID を入力')
    expect(wrapper.findAll('[data-testid="shelf-tabs"] button').map((b) => b.text())).toEqual(['この設計図'])
    await wrapper.find('[data-key="minecraft:stone"]').trigger('click')
    expect(useBrushStore().state?.key).toBe('minecraft:stone')
    expect(wrapper.find('#brush-id-list').findAll('option').map((o) => o.attributes('value'))).toEqual([
      'minecraft:stone',
    ])
    const input = wrapper.find('[data-testid="brush-input"]')
    await input.setValue('create:shaft[axis=y]')
    await wrapper.find('form').trigger('submit')
    expect(useBrushStore().state?.key).toBe('create:shaft[axis=y]')
    expect(wrapper.find('[data-testid="brush-props"]').exists()).toBe(false)
  })
})
