import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h, markRaw } from 'vue'
import { blueprintFixture } from '../../../tests/fixtures/blueprintFixture'
import { fakeJar } from '../../../tests/fixtures/fakeJar'
import { placeBlock } from '../../edit/editCommand'
import { scanJar } from '../../io/modpack/jarScanner'
import { Modpack } from '../../io/modpack/modpack'
import { state } from '../../../tests/fixtures/blueprintFixture'
import { setModpackLoadEnvironment, useModpackContentStore } from '../stores/modpackContent'
import { createDocumentSession, provideDocumentSession, type DocumentSession } from './documentSession'
import NewBlueprintButton from './NewBlueprintButton.vue'

function mountWith(session: DocumentSession) {
  const Host = defineComponent({
    setup() {
      provideDocumentSession(session)
      return () => h(NewBlueprintButton)
    },
  })
  return mount(Host)
}

function setPack(jarName: string) {
  const pack = new Modpack([scanJar(jarName, fakeJar({ forgeMods: [{ modId: 'create', displayName: 'Create' }] }))], null)
  const content = useModpackContentStore()
  content.pack = markRaw(pack)
  content.phase = 'loaded'
}

describe('NewBlueprintButton', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    setModpackLoadEnvironment({ cache: null, scan: null })
  })

  afterEach(() => {
    setModpackLoadEnvironment(null)
  })

  it('大きさとバージョンを選んで空の設計図を開く', async () => {
    const session = createDocumentSession()
    const wrapper = mountWith(session)
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)

    await wrapper.find('[data-action="new-blueprint"]').trigger('click')
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true)
    // Modpack がなければバージョンは選んでもらう
    expect((wrapper.find('select').element as HTMLSelectElement).value).toBe('')
    expect(wrapper.text()).toContain('Modpack を選んでいないので')

    await wrapper.find('input[name="name"]').setValue('水車')
    await wrapper.find('input[name="width"]').setValue('5')
    await wrapper.find('input[name="height"]').setValue('3')
    await wrapper.find('input[name="depth"]').setValue('7')
    await wrapper.find('form').trigger('submit')
    // バージョンを選ぶまでは作らない
    expect(wrapper.find('[role="alert"]').text()).toContain('Minecraft のバージョンを選んでください。')
    expect(session.current.value).toBeNull()

    await wrapper.find('select').setValue('1.18.2')
    await wrapper.find('form').trigger('submit')
    const doc = session.current.value
    expect(doc?.fileName).toBe('水車.nbt')
    expect(doc?.blueprint.size).toEqual([5, 3, 7])
    expect(doc?.blueprint.dataVersion).toBe(2975)
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
  })

  it('Modpack があれば推定したバージョンを最初に選ぶ', async () => {
    setPack('create-1.20.1-0.5.1.f.jar')
    const wrapper = mountWith(createDocumentSession())
    await wrapper.find('[data-action="new-blueprint"]').trigger('click')
    expect((wrapper.find('select').element as HTMLSelectElement).value).toBe('1.20.1')
    expect(wrapper.text()).toContain('1.20.1 と推定しました')
  })

  it('開いている設計図に書き出していない変更があれば、なくなることを知らせる', async () => {
    const session = createDocumentSession()
    const doc = session.setBlueprint(blueprintFixture({ size: [1, 1, 1] }).toBlueprint())
    session.apply(placeBlock(doc.blueprint, [0, 0, 0], state('minecraft:stone'), false))
    const wrapper = mountWith(session)
    await wrapper.find('[data-action="new-blueprint"]').trigger('click')
    expect(wrapper.text()).toContain('書き出していない変更（1 回）はなくなります。')
  })

  it('やめると何も変えない', async () => {
    const session = createDocumentSession()
    const wrapper = mountWith(session)
    await wrapper.find('[data-action="new-blueprint"]').trigger('click')
    await wrapper.find('[role="dialog"]').trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    expect(session.current.value).toBeNull()
  })
})
