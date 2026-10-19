import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h, markRaw } from 'vue'
import { blueprintFixture } from '../../../tests/fixtures/blueprintFixture'
import { fakeJar } from '../../../tests/fixtures/fakeJar'
import { BlockState } from '../../domain/blockState'
import { ResourceLocation } from '../../domain/resourceLocation'
import { placeBlock } from '../../edit/editCommand'
import { scanJar } from '../../io/modpack/jarScanner'
import { Modpack } from '../../io/modpack/modpack'
import { createDocumentSession, provideDocumentSession, type DocumentSession } from '../document/documentSession'
import { clampLayer, useLayerStore } from '../stores/layerStore'
import { setModpackLoadEnvironment, useModpackContentStore } from '../stores/modpackContent'
import BlockList from './BlockList.vue'
import { statsFor } from './useBlueprintStats'

function createPack(): Modpack {
  const jar = fakeJar({
    forgeMods: [{ modId: 'create', displayName: 'Create' }],
    lang: { create: { ja_jp: { 'block.create.shaft': 'シャフト' } } },
  })
  return new Modpack([scanJar('create.jar', jar)], null)
}

function blueprint() {
  return blueprintFixture({ size: [3, 2, 1] })
    .place([0, 0, 0], 'create:shaft', { axis: 'x' })
    .place([1, 0, 0], 'create:shaft', { axis: 'x' })
    .place([2, 0, 0], 'minecraft:stone')
    .place([0, 1, 0], 'minecraft:stone')
    .place([1, 1, 0], 'minecraft:stone')
    .toBlueprint()
}

function mountWith(session: DocumentSession) {
  const Host = defineComponent({
    setup() {
      provideDocumentSession(session)
      return () => h(BlockList)
    },
  })
  return mount(Host)
}

function rowTexts(wrapper: ReturnType<typeof mountWith>) {
  return wrapper.findAll('li').map((li) => [li.attributes('data-id'), li.find('.name').text(), li.find('.count').text()])
}

describe('BlockList', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    setModpackLoadEnvironment({ cache: null, scan: null })
  })

  afterEach(() => {
    setModpackLoadEnvironment(null)
  })

  it('設計図がないときは案内だけ出す', () => {
    const wrapper = mountWith(createDocumentSession())
    expect(wrapper.text()).toContain('設計図を開くと、ブロックの数が出ます。')
    expect(wrapper.findAll('li')).toHaveLength(0)
  })

  it('全体の数を ID で出す（Modpack がないとき）', () => {
    const session = createDocumentSession()
    session.setBlueprint(blueprint())
    const wrapper = mountWith(session)
    expect(rowTexts(wrapper)).toEqual([
      ['minecraft:stone', 'minecraft:stone', '3'],
      ['create:shaft', 'create:shaft', '2'],
    ])
    expect(wrapper.find('.summary').text()).toBe('2 種類・5 個')
    expect(wrapper.text()).toContain('名前は ID のままです。')
  })

  it('「この段」で今の段だけを数える', async () => {
    const session = createDocumentSession()
    session.setBlueprint(blueprint())
    const wrapper = mountWith(session)
    await wrapper.find('[data-scope="layer"]').trigger('click')
    expect(wrapper.find('[data-scope="layer"]').attributes('aria-pressed')).toBe('true')
    expect(rowTexts(wrapper).map((r) => [r[0], r[2]])).toEqual([
      ['create:shaft', '2'],
      ['minecraft:stone', '1'],
    ])
    expect(wrapper.find('.summary').text()).toBe('2 種類・3 個（段 1）')

    useLayerStore().setLayer(1)
    await wrapper.vm.$nextTick()
    expect(rowTexts(wrapper).map((r) => [r[0], r[2]])).toEqual([['minecraft:stone', '2']])
    expect(wrapper.find('.summary').text()).toBe('1 種類・2 個（段 2）')

    // 高さを超える段は一番上の段にする
    useLayerStore().setLayer(9)
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.summary').text()).toBe('1 種類・2 個（段 2）')

    await wrapper.find('[data-scope="all"]').trigger('click')
    expect(wrapper.find('.summary').text()).toBe('2 種類・5 個')
  })

  it('空の段では、ブロックがないと出す', async () => {
    const session = createDocumentSession()
    session.setBlueprint(blueprintFixture({ size: [1, 2, 1] }).place([0, 1, 0], 'minecraft:stone').toBlueprint())
    const wrapper = mountWith(session)
    await wrapper.find('[data-scope="layer"]').trigger('click')
    expect(wrapper.findAll('li')).toHaveLength(0)
    expect(wrapper.text()).toContain('段 1 にブロックはありません。')
  })

  it('Modpack を読み込むと表示名を出し、ID を添える。名前がないものは ID のまま', async () => {
    const session = createDocumentSession()
    session.setBlueprint(blueprint())
    const wrapper = mountWith(session)
    const content = useModpackContentStore()
    content.pack = markRaw(createPack())
    content.phase = 'loaded'
    await wrapper.vm.$nextTick()

    const shaft = wrapper.find('li[data-id="create:shaft"] .name')
    expect(shaft.text()).toContain('シャフト')
    expect(shaft.find('small').text()).toBe('create:shaft')
    const stone = wrapper.find('li[data-id="minecraft:stone"] .name')
    expect(stone.text()).toBe('minecraft:stone')
    expect(stone.find('small').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('名前は ID のままです。')
  })

  it('編集すると数え直す', async () => {
    const session = createDocumentSession()
    const doc = session.setBlueprint(blueprint())
    const wrapper = mountWith(session)
    const shaft = new BlockState(ResourceLocation.parse('create:shaft'), { axis: 'y' })
    session.apply(placeBlock(doc.blueprint, [2, 1, 0], shaft, false))
    await wrapper.vm.$nextTick()
    expect(rowTexts(wrapper).map((r) => [r[0], r[2]])).toEqual([
      ['create:shaft', '3'],
      ['minecraft:stone', '3'],
    ])
    session.undo()
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.summary').text()).toBe('2 種類・5 個')
  })
})

describe('statsFor', () => {
  it('同じ設計図と version なら同じ集計を返し、version が変われば作り直す', () => {
    const bp = blueprint()
    const a = statsFor(bp, 1)
    expect(statsFor(bp, 1)).toBe(a)
    expect(statsFor(bp, 2)).not.toBe(a)
  })
})

describe('clampLayer', () => {
  it('段を 0 〜 高さ-1 に収める', () => {
    expect(clampLayer(5, 3)).toBe(2)
    expect(clampLayer(-1, 3)).toBe(0)
    expect(clampLayer(1, 3)).toBe(1)
    expect(clampLayer(0, 0)).toBe(0)
  })
})
