import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h, markRaw } from 'vue'
import { blueprintFixture } from '../../../tests/fixtures/blueprintFixture'
import { fakeJar } from '../../../tests/fixtures/fakeJar'
import { placeBlock } from '../../edit/editCommand'
import { scanJar } from '../../io/modpack/jarScanner'
import { Modpack } from '../../io/modpack/modpack'
import { BlockState } from '../../domain/blockState'
import { ResourceLocation } from '../../domain/resourceLocation'
import { createDocumentSession, provideDocumentSession, type DocumentSession } from '../document/documentSession'
import { setModpackLoadEnvironment, useModpackContentStore } from '../stores/modpackContent'
import UsedMods from './UsedMods.vue'
import { missingModsNotice, useMissingMods } from './useMissingMods'

function createOnlyPack(): Modpack {
  const jar = fakeJar({
    forgeMods: [{ modId: 'create', displayName: 'Create' }],
    lang: { create: { en_us: { 'block.create.shaft': 'Shaft' } } },
  })
  return new Modpack([scanJar('create.jar', jar)], null)
}

function blueprint() {
  return blueprintFixture({ size: [3, 1, 2] })
    .place([0, 0, 0], 'minecraft:stone')
    .place([1, 0, 0], 'create:shaft[axis=x]')
    .place([2, 0, 0], 'pipez:item_pipe')
    .place([2, 0, 1], 'pipez:item_pipe')
    .toBlueprint()
}

/** session を provide して UsedMods を出す */
function mountWith(session: DocumentSession) {
  const Host = defineComponent({
    setup() {
      provideDocumentSession(session)
      return () => h(UsedMods)
    },
  })
  return mount(Host)
}

function setPack(pack: Modpack | null) {
  const content = useModpackContentStore()
  content.pack = pack ? markRaw(pack) : null
  content.phase = pack ? 'loaded' : 'idle'
}

describe('UsedMods', () => {
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
    expect(wrapper.text()).toContain('設計図を開くと、使っている Mod が出ます。')
    expect(wrapper.findAll('li')).toHaveLength(0)
  })

  it('Modpack がないときは namespace とブロック数だけ出し、警告しない', () => {
    const session = createDocumentSession()
    session.setBlueprint(blueprint())
    const wrapper = mountWith(session)
    const rows = wrapper.findAll('li').map((li) => li.text())
    expect(rows).toEqual(['pipez2', 'create1', 'minecraft1'])
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Modpack を選ぶと、足りない Mod を調べます。')
  })

  it('Modpack にない Mod を警告し、先頭に出す', async () => {
    const session = createDocumentSession()
    session.setBlueprint(blueprint())
    const wrapper = mountWith(session)
    setPack(createOnlyPack())
    await wrapper.vm.$nextTick()

    expect(wrapper.find('[role="alert"]').text()).toContain('Modpack にない Mod が 1 個あります')
    const missing = wrapper.findAll('li.missing')
    expect(missing.map((li) => li.attributes('data-namespace'))).toEqual(['pipez'])
    expect(missing[0]!.text()).toContain('足りない')
  })

  it('編集で足りない Mod のブロックがなくなると、警告が消える', async () => {
    const session = createDocumentSession()
    const doc = session.setBlueprint(
      blueprintFixture({ size: [1, 1, 1] }).place([0, 0, 0], 'pipez:item_pipe').toBlueprint(),
    )
    setPack(createOnlyPack())
    const wrapper = mountWith(session)
    expect(wrapper.find('[role="alert"]').exists()).toBe(true)

    const shaft = new BlockState(ResourceLocation.parse('create:shaft'), {})
    session.apply(placeBlock(doc.blueprint, [0, 0, 0], shaft, true))
    await wrapper.vm.$nextTick()

    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('すべて Modpack に入っています。')
  })
})

describe('useMissingMods', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    setModpackLoadEnvironment({ cache: null, scan: null })
  })

  afterEach(() => {
    setModpackLoadEnvironment(null)
  })

  it('足りない namespace と、書き出しの前のお知らせを返す', () => {
    const session = createDocumentSession()
    session.setBlueprint(blueprint())
    setPack(createOnlyPack())
    let result: ReturnType<typeof useMissingMods> | null = null
    mount(
      defineComponent({
        setup() {
          provideDocumentSession(session)
          return () => h(defineComponent({ setup() { result = useMissingMods(); return () => null } }))
        },
      }),
    )
    expect(result!.missingNamespaces.value).toEqual(['pipez'])
    expect(result!.exportNotice.value).toBe(
      'Modpack にない Mod のブロックがあります：pipez（2 個）。この Modpack のゲームに読み込むと、これらのブロックは置かれません。',
    )
  })

  it('足りないものがなければお知らせは null', () => {
    expect(missingModsNotice([])).toBeNull()
  })
})
