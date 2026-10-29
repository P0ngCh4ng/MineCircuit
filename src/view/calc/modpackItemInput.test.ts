// Modpack の読み込みから、物の入口を置いてプローブに出るまでを、アプリ全体を組んで確かめる（#141 の再発を防ぐ）。
// 計算に Modpack が渡っていなかった不具合は、部品ごとのテストでは見つからなかったので、画面の配線ごと通す。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { markRaw } from 'vue'
import { strToU8 } from 'fflate'
import { blueprintFixture } from '../../../tests/fixtures/blueprintFixture'
import { fakeJar } from '../../../tests/fixtures/fakeJar'
import { createBuiltinRegistry } from '../../calc/builtinPlugins'
import { InlineCalcBackend } from '../../calc/calcScheduler'
import { nbt } from '../../domain/nbt'
import type { Resolved } from '../../calc/provenance'
import { MemoryFileSource } from '../../io/memoryFileSource'
import { inlineScriptRunner } from '../../io/modpack/kubejsScripts/runScripts'
import App from '../App.vue'
import { createDocumentSession, DOCUMENT_SESSION_KEY } from '../document/documentSession'
import { useCalcStore } from '../stores/calcStore'
import { useModpackStore } from '../stores/modpack'
import { setModpackLoadEnvironment, useModpackContentStore } from '../stores/modpackContent'
import { usePortStore } from '../stores/portStore'
import { useProbeStore } from '../stores/probeStore'
import { withPortItem, withPortParam } from './portModel'

const MILL: [number, number, number] = [0, 1, 0]

/** 創造モーター（64 RPM）の上に石臼 */
function millBlueprint() {
  return blueprintFixture({ size: [1, 2, 1] })
    .place([0, 0, 0], 'create:creative_motor', { facing: 'up' }, nbt.compound({ ScrollValue: nbt.int(64) }))
    .place(MILL, 'create:millstone')
    .toBlueprint()
}

const json = (v: unknown) => strToU8(JSON.stringify(v))

/** 1.18〜1.20 の形のレシピ（recipes/、{ item }、processingTime） */
const LEGACY_WHEAT = {
  'data/create/recipes/milling/wheat.json': json({
    type: 'create:milling',
    ingredients: [{ item: 'minecraft:wheat' }],
    processingTime: 150,
    results: [{ item: 'create:wheat_flour' }, { item: 'create:wheat_flour', count: 2, chance: 0.25 }],
  }),
}

/** 1.21（Create 6.0）の形のレシピ（recipe/、neoforge:compound、processing_time）。#139 */
const NEOFORGE_WHEAT = {
  'data/create/recipe/milling/wheat.json': json({
    type: 'create:milling',
    ingredients: [{ type: 'neoforge:compound', ingredients: [{ item: 'minecraft:wheat' }, { item: 'minecraft:hay_block' }] }],
    processing_time: 120,
    results: [{ id: 'create:wheat_flour' }],
  }),
}

/** 材料がタグのレシピと、そのタグ */
const TAGGED_WHEAT = {
  'data/create/recipe/milling/grain.json': json({
    type: 'create:milling',
    ingredients: [{ tag: 'c:crops/wheat' }],
    processing_time: 90,
    results: [{ id: 'create:wheat_flour' }],
  }),
  'data/c/tags/item/crops/wheat.json': json({ values: ['minecraft:wheat'] }),
}

/** Create の jar 1つだけの Modpack のフォルダ。scripts は kubejs/server_scripts/ からのパス → 中身 */
function modpackFolder(files: Record<string, Uint8Array>, scripts: Record<string, string> = {}) {
  const jar = fakeJar({
    neoforgeMods: [{ modId: 'create', displayName: 'Create' }],
    lang: { create: { en_us: { 'block.create.millstone': 'Millstone' } } },
    files,
  })
  return new MemoryFileSource([
    ['mods/create.jar', jar],
    ...Object.entries(scripts).map(([path, text]) => [`kubejs/server_scripts/${path}`, strToU8(text)] as const),
  ])
}

// 設計図を開くと仮の入出力は消える（usePortTool）ので、開き終わってから置く
async function mountApp() {
  const pinia = createPinia()
  setActivePinia(pinia)
  useCalcStore().setBackend(new InlineCalcBackend(createBuiltinRegistry()), { delayMs: 0 })
  const session = createDocumentSession()
  const wrapper = mount(App, {
    global: { plugins: [pinia], provide: { [DOCUMENT_SESSION_KEY as symbol]: session } },
    attachTo: document.body,
  })
  session.setBlueprint(millBlueprint(), 'mill.nbt')
  await flushPromises()
  return wrapper
}

/** Modpack のフォルダを選んだことにし、読み終わるまで待つ */
async function selectModpack(folder: MemoryFileSource | null) {
  useModpackStore().source = folder ? markRaw(folder) : null
  const content = useModpackContentStore()
  await vi.waitFor(() => expect(content.phase).toBe(folder ? 'loaded' : 'idle'))
}

/** 石臼の上の面に、物の入口（item、rate 個/秒）を置く */
function feedWheat(rate = 1, item = 'minecraft:wheat') {
  const ports = usePortStore()
  ports.setPlaceKey('create-stress/item-input')
  const port = ports.place(MILL, 'up')!
  ports.update(withPortParam(withPortItem(port, 'item', item), 'rate', rate))
}

/** 石臼のプローブの値。見出しで引く */
function millValue(label: string): Resolved<string> | undefined {
  const probe = useProbeStore()
  probe.setProbed(MILL)
  return probe.readings.find((r) => r.pluginId === 'create-stress')?.values.find((v) => v.label === label)?.value
}

describe('Modpack の読み込みと物の入口', () => {
  beforeEach(() => {
    localStorage.clear()
    setModpackLoadEnvironment({ cache: null, scan: null })
  })
  afterEach(() => setModpackLoadEnvironment(null))

  it('Modpack を読み込むと、石臼に入れた小麦のレシピと処理時間を Modpack から出す（1.18〜1.20 の形）', async () => {
    const wrapper = await mountApp()
    await selectModpack(modpackFolder(LEGACY_WHEAT))
    feedWheat()
    await vi.waitFor(() => expect(millValue('レシピ')?.value).toContain('create:milling/wheat'))
    expect(millValue('届く物')?.value).toContain('minecraft:wheat')
    expect(millValue('処理時間')?.source).toBe('modpack')
    wrapper.unmount()
  })

  it('1.21 の形（neoforge:compound の材料）のレシピも当たる（#139）', async () => {
    const wrapper = await mountApp()
    await selectModpack(modpackFolder(NEOFORGE_WHEAT))
    feedWheat()
    await vi.waitFor(() => expect(millValue('レシピ')?.value).toContain('create:milling/wheat'))
    expect(millValue('処理時間')?.source).toBe('modpack')
    wrapper.unmount()
  })

  it('材料がタグのレシピは、jar のタグで小麦を照らして当てる', async () => {
    const wrapper = await mountApp()
    await selectModpack(modpackFolder(TAGGED_WHEAT))
    feedWheat()
    await vi.waitFor(() => expect(millValue('レシピ')?.value).toContain('create:milling/grain'))
    wrapper.unmount()
  })

  it('Modpack を読んでいなければ、レシピが分からないと出し、処理時間は仮定にする', async () => {
    const wrapper = await mountApp()
    feedWheat()
    await vi.waitFor(() => expect(millValue('レシピ')?.value).toContain('Modpack を読んでいないので、レシピが分からない'))
    expect(millValue('処理時間')?.source).toBe('assumed')
    wrapper.unmount()
  })

  it('物の入口を置いた後で Modpack を読み込んでも、計算し直してレシピを出す。外すと分からないに戻る', async () => {
    const wrapper = await mountApp()
    feedWheat()
    await vi.waitFor(() => expect(millValue('レシピ')?.value).toContain('Modpack を読んでいないので'))

    await selectModpack(modpackFolder(LEGACY_WHEAT))
    await vi.waitFor(() => expect(millValue('レシピ')?.value).toContain('create:milling/wheat'))

    await selectModpack(null)
    await vi.waitFor(() => expect(millValue('レシピ')?.value).toContain('Modpack を読んでいないので'))
    wrapper.unmount()
  })

  it('KubeJS のスクリプトで足したレシピで処理し、jar のレシピを消したものは出さない（#145）', async () => {
    setModpackLoadEnvironment({ cache: null, scan: null, scripts: inlineScriptRunner })
    const wrapper = await mountApp()
    await selectModpack(
      modpackFolder(LEGACY_WHEAT, {
        'recipes/milling.js': `
          onEvent('recipes', event => {
            event.remove({ id: 'create:milling/wheat' })
            ;[{ input: 'minecraft:rooted_dirt', output: 'minecraft:dirt' }].forEach(r => {
              event.recipes.createMilling(Item.of(r.output), r.input).processingTime(60)
            })
          })
        `,
      }),
    )
    feedWheat(1, 'minecraft:rooted_dirt')
    await vi.waitFor(() => expect(millValue('レシピ')?.value).toContain('kubejs:script/recipes/milling/1'))
    expect(millValue('レシピ')?.value).toContain('minecraft:dirt')
    expect(millValue('処理時間')?.source).toBe('modpack')
    const book = await useModpackContentStore().pack!.recipeBook()
    expect(book.recipes.some((r) => r.id === 'create:milling/wheat')).toBe(false)
    wrapper.unmount()
  })

  it('Modpack に小麦のレシピがなければ、レシピがないと出す', async () => {
    const wrapper = await mountApp()
    await selectModpack(modpackFolder({}))
    feedWheat()
    await vi.waitFor(() => expect(millValue('レシピ')?.value).toBe('Modpack にこの物のレシピがない（minecraft:wheat）'))
    wrapper.unmount()
  })
})
