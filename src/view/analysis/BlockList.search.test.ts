import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h, markRaw, nextTick } from 'vue'
import { blueprintFixture } from '../../../tests/fixtures/blueprintFixture'
import { fakeJar } from '../../../tests/fixtures/fakeJar'
import { BlockState } from '../../domain/blockState'
import { ResourceLocation } from '../../domain/resourceLocation'
import { placeBlock } from '../../edit/editCommand'
import { scanJar } from '../../io/modpack/jarScanner'
import { Modpack } from '../../io/modpack/modpack'
import { createDocumentSession, provideDocumentSession, type DocumentSession } from '../document/documentSession'
import { setModpackLoadEnvironment, useModpackContentStore } from '../stores/modpackContent'
import { useSearchStore } from '../stores/searchStore'
import BlockList from './BlockList.vue'
import { useSearchHighlight } from './useSearchHighlight'

function blueprint() {
  return blueprintFixture({ size: [3, 2, 1] })
    .place([0, 0, 0], 'create:shaft', { axis: 'x' })
    .place([1, 0, 0], 'create:cogwheel', { axis: 'x' })
    .place([2, 0, 0], 'minecraft:stone')
    .place([0, 1, 0], 'minecraft:stone')
    .toBlueprint()
}

/** ブロック一覧と、強調の位置（3D/2D表示が見るもの）を一緒に作る */
function mountWith(session: DocumentSession) {
  let highlight: ReturnType<typeof useSearchHighlight> | null = null
  // provide した部品の中では inject できないので、子の部品で受け取る
  const Probe = defineComponent({
    setup() {
      highlight = useSearchHighlight()
      return () => null
    },
  })
  const Host = defineComponent({
    setup() {
      provideDocumentSession(session)
      return () => [h(BlockList), h(Probe)]
    },
  })
  const wrapper = mount(Host)
  return { wrapper, highlight: () => highlight!.value }
}

function ids(wrapper: ReturnType<typeof mount>) {
  return wrapper.findAll('li').map((li) => li.attributes('data-id'))
}

describe('BlockList の検索と強調', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    setModpackLoadEnvironment({ cache: null, scan: null })
  })

  afterEach(() => {
    setModpackLoadEnvironment(null)
  })

  it('入力した言葉で ID を絞り込み、合うものがなければそう出す', async () => {
    const session = createDocumentSession()
    session.setBlueprint(blueprint())
    const { wrapper } = mountWith(session)
    const input = wrapper.find('input[type="search"]')
    await input.setValue('create')
    expect(ids(wrapper)).toEqual(['create:cogwheel', 'create:shaft'])
    expect(wrapper.find('.summary').text()).toBe('2 種類・2 個（3 種類のうち）')
    await input.setValue('cog x')
    expect(ids(wrapper)).toEqual([])
    expect(wrapper.text()).toContain('「cog x」に合うブロックはありません。')
    await input.setValue('')
    expect(ids(wrapper)).toHaveLength(3)
  })

  it('Modpack を読み込むと表示名でも絞り込める', async () => {
    const session = createDocumentSession()
    session.setBlueprint(blueprint())
    const { wrapper } = mountWith(session)
    const content = useModpackContentStore()
    const jar = fakeJar({
      forgeMods: [{ modId: 'create', displayName: 'Create' }],
      lang: { create: { ja_jp: { 'block.create.shaft': 'シャフト' } } },
    })
    content.pack = markRaw(new Modpack([scanJar('create.jar', jar)], null))
    content.phase = 'loaded'
    await wrapper.find('input[type="search"]').setValue('シャフト')
    expect(ids(wrapper)).toEqual(['create:shaft'])
  })

  it('行をクリックするとそのブロックの位置を強調し、もう一度押すか「強調を解除」で戻す', async () => {
    const session = createDocumentSession()
    session.setBlueprint(blueprint())
    const { wrapper, highlight } = mountWith(session)
    expect(highlight()).toBeNull()

    const row = () => wrapper.find('li[data-id="minecraft:stone"] button')
    await row().trigger('click')
    expect(row().attributes('aria-pressed')).toBe('true')
    expect(highlight()).toEqual([
      [2, 0, 0],
      [0, 1, 0],
    ])
    expect(wrapper.find('[data-testid="highlight-status"]').text()).toContain('強調中：minecraft:stone')

    await row().trigger('click')
    expect(highlight()).toBeNull()

    await row().trigger('click')
    await wrapper.find('[data-action="clear-highlight"]').trigger('click')
    expect(highlight()).toBeNull()
    expect(wrapper.find('[data-testid="highlight-status"]').exists()).toBe(false)
  })

  it('編集すると強調の位置を探し直し、別の設計図を開くと強調を解除する', async () => {
    const session = createDocumentSession()
    const doc = session.setBlueprint(blueprint())
    const { highlight } = mountWith(session)
    useSearchStore().setHighlight('create:shaft')
    await nextTick()
    expect(highlight()).toEqual([[0, 0, 0]])

    const shaft = new BlockState(ResourceLocation.parse('create:shaft'), { axis: 'y' })
    session.apply(placeBlock(doc.blueprint, [2, 1, 0], shaft, false))
    expect(highlight()).toEqual([
      [0, 0, 0],
      [2, 1, 0],
    ])

    session.setBlueprint(blueprint())
    await nextTick()
    expect(useSearchStore().highlightId).toBeNull()
    expect(highlight()).toBeNull()
  })
})
