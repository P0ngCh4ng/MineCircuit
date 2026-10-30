import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h, markRaw } from 'vue'
import { blueprintFixture } from '../../../tests/fixtures/blueprintFixture'
import { fakeJar } from '../../../tests/fixtures/fakeJar'
import { createBuiltinRegistry } from '../../calc/builtinPlugins'
import { InlineCalcBackend } from '../../calc/calcScheduler'
import { nbt } from '../../domain/nbt'
import { eraseBlock } from '../../edit/editCommand'
import { scanJar } from '../../io/modpack/jarScanner'
import { Modpack } from '../../io/modpack/modpack'
import { createDocumentSession, provideDocumentSession, type DocumentSession } from '../document/documentSession'
import { useCalcStore } from '../stores/calcStore'
import { setModpackLoadEnvironment, useModpackContentStore } from '../stores/modpackContent'
import { useProbeStore } from '../stores/probeStore'
import { useToolStore } from '../stores/toolStore'
import BlockDetail from './BlockDetail.vue'

function blueprint() {
  return blueprintFixture({ size: [2, 2, 1] })
    .place(
      [0, 0, 0],
      'create:creative_motor',
      { facing: 'up' },
      nbt.compound([
        ['Speed', nbt.int(64)],
        ['Network', nbt.compound({ Id: nbt.long(12n), Stress: nbt.float(Math.fround(0.1)) })],
        ['Items', nbt.list('compound', [nbt.compound({ id: nbt.string('minecraft:stone'), Count: nbt.byte(2) })])],
      ]),
    )
    .place([1, 1, 0], 'minecraft:stone')
    .toBlueprint()
}

function mountWith(session: DocumentSession) {
  const Host = defineComponent({
    setup() {
      provideDocumentSession(session)
      return () => h(BlockDetail)
    },
  })
  return mount(Host)
}

describe('BlockDetail', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    setModpackLoadEnvironment({ cache: null, scan: null })
  })

  afterEach(() => {
    setModpackLoadEnvironment(null)
  })

  it('選択していないときは案内を出す', () => {
    const session = createDocumentSession()
    session.setBlueprint(blueprint())
    const wrapper = mountWith(session)
    expect(wrapper.text()).toContain('選択ツール（V）でブロックをクリックすると')
    expect(wrapper.find('.clear').exists()).toBe(false)
  })

  /** クリエイティブモーター（16 RPM）→ 軸 → プレス、離れたところに動力源のない軸 */
  function line() {
    return blueprintFixture({ size: [5, 1, 3] })
      .place([0, 0, 0], 'create:creative_motor', { facing: 'east' }, nbt.compound({ ScrollValue: nbt.int(16) }))
      .place([1, 0, 0], 'create:shaft', { axis: 'x' })
      .place([2, 0, 0], 'create:mechanical_press', { facing: 'east' })
      .place([0, 0, 2], 'create:shaft', { axis: 'x' })
      .toBlueprint()
  }

  async function withCalc() {
    const calc = useCalcStore()
    calc.setBackend(new InlineCalcBackend(createBuiltinRegistry()), { delayMs: 0 })
    const session = createDocumentSession()
    const doc = session.setBlueprint(line())
    const wrapper = mountWith(session)
    await calc.attach(doc.blueprint)
    await flushPromises()
    return { wrapper, tools: useToolStore() }
  }

  it('選んだブロックの回転数・応力（出どころつき）・ネットワーク・問題を出す（#158）', async () => {
    const { wrapper, tools } = await withCalc()
    tools.setSelected([2, 0, 0])
    await flushPromises()
    const calc = wrapper.find('[data-testid="block-calc"]')
    expect(calc.text()).toContain('回転数')
    expect(calc.text()).toContain('16 RPM')
    expect(calc.text()).toContain('応力')
    expect(calc.text()).toContain('SU')
    expect(calc.findAll('.source').length).toBeGreaterThan(0)
    expect(calc.find('[data-testid="block-network"] .network-name').text()).toBe('ネットワーク 1')
    await calc.find('[data-action="highlight-network"]').trigger('click')
    expect(useProbeStore().probedPos).toEqual([2, 0, 0])

    // 動力源のない軸は、警告の問題を出す
    tools.setSelected([0, 0, 2])
    await flushPromises()
    const issues = wrapper.findAll('[data-testid="block-calc"] .issues li')
    expect(issues.map((li) => li.attributes('data-severity'))).toEqual(['warning'])
    expect(issues[0]!.text()).toContain('動力源につながっていません')
  })

  it('何も選んでいないときは、設計図全体のまとめと問題の件数を出す（#158）', async () => {
    const { wrapper } = await withCalc()
    const summary = wrapper.find('[data-testid="blueprint-calc"]')
    expect(summary.exists()).toBe(true)
    expect(summary.find('[data-detail="issue-counts"]').text()).toMatch(/エラー 0s*警告 1s*情報 0/)
    expect(summary.text()).toContain('ネットワーク 2／過負荷 0')
    // ネット一覧の行はここには出さない
    expect(summary.text()).not.toContain('ネットワーク 1')
  })

  it('ID・位置（段は1始まり）・ブロック状態・生データのツリーを出す', async () => {
    const session = createDocumentSession()
    session.setBlueprint(blueprint())
    const wrapper = mountWith(session)
    useToolStore().setSelected([0, 0, 0])
    await wrapper.vm.$nextTick()

    expect(wrapper.find('[data-detail="name"]').text()).toBe('create:creative_motor')
    expect(wrapper.find('[data-detail="id"]').exists()).toBe(false)
    expect(wrapper.find('[data-detail="pos"]').text()).toBe('0, 0, 0（段 1）')
    expect(wrapper.find('[data-prop-value="facing"]').text()).toBe('up')
    expect(wrapper.find('[data-detail="region"]').exists()).toBe(false)

    const top = wrapper.findAll('.tree > li')
    expect(top.map((li) => [li.attributes('data-label'), li.attributes('data-type')])).toEqual([
      ['Speed', 'int'],
      ['Network', 'compound'],
      ['Items', 'list'],
    ])
    expect(top[0]?.text()).toContain('64')
    // 一段目の Compound は最初から開き、中の値も型付きで出る
    const network = wrapper.find('li[data-label="Network"]')
    expect(network.find('details').attributes('open')).toBeDefined()
    const id = network.find('li[data-label="Id"]')
    expect(id.find('.t').text()).toBe('long')
    expect(id.find('.v').text()).toBe('12L')
    expect(network.find('li[data-label="Stress"] .v').text()).toBe('0.1f')
    // リストの中の Compound は閉じている（ツリーには入っている）
    const items = wrapper.find('li[data-label="Items"]')
    expect(items.find('summary .t').text()).toBe('list<compound>')
    const first = items.find('li[data-label="[0]"]')
    expect(first.find('details').attributes('open')).toBeUndefined()
    expect(first.find('li[data-label="Count"] .v').text()).toBe('2b')
  })

  it('生データのないブロックでは、ないと出す', async () => {
    const session = createDocumentSession()
    session.setBlueprint(blueprint())
    const wrapper = mountWith(session)
    useToolStore().setSelected([1, 1, 0])
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-detail="pos"]').text()).toBe('1, 1, 0（段 2）')
    expect(wrapper.text()).toContain('このブロックには生データ（nbt）がありません。')
    expect(wrapper.text()).toContain('ブロック状態の項目はありません。')
    expect(wrapper.find('.tree').exists()).toBe(false)
  })

  it('Modpack を読み込むと表示名を出し、ID を添える', async () => {
    const session = createDocumentSession()
    session.setBlueprint(blueprint())
    const wrapper = mountWith(session)
    const jar = fakeJar({
      forgeMods: [{ modId: 'create', displayName: 'Create' }],
      lang: { create: { ja_jp: { 'block.create.creative_motor': 'クリエイティブモーター' } } },
    })
    const content = useModpackContentStore()
    content.pack = markRaw(new Modpack([scanJar('create.jar', jar)], null))
    content.phase = 'loaded'
    useToolStore().setSelected([0, 0, 0])
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-detail="name"]').text()).toBe('クリエイティブモーター')
    expect(wrapper.find('[data-detail="id"]').text()).toBe('create:creative_motor')
  })

  it('選んだブロックを消すと、ブロックがないと出す。元に戻すとまた出る', async () => {
    const session = createDocumentSession()
    const doc = session.setBlueprint(blueprint())
    const wrapper = mountWith(session)
    useToolStore().setSelected([0, 0, 0])
    await wrapper.vm.$nextTick()
    const erase = eraseBlock(doc.blueprint, [0, 0, 0])
    if (!erase) throw new Error('消す操作を作れなかった')
    session.apply(erase)
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('この位置にはブロックがありません。')
    expect(wrapper.find('.tree').exists()).toBe(false)
    session.undo()
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-detail="name"]').text()).toBe('create:creative_motor')
    expect(wrapper.find('.tree').exists()).toBe(true)
  })

  it('「選択の解除」で選択を消す', async () => {
    const session = createDocumentSession()
    session.setBlueprint(blueprint())
    const wrapper = mountWith(session)
    const tools = useToolStore()
    tools.setSelected([0, 0, 0])
    await wrapper.vm.$nextTick()
    await wrapper.find('.clear').trigger('click')
    expect(tools.selectedPos).toBeNull()
    expect(wrapper.text()).toContain('選択ツール（V）でブロックをクリックすると')
  })
  it('計算に使う設定（モーターの回転数）を変えると、元に戻せる操作として生データに書く', async () => {
    const session = createDocumentSession()
    const doc = session.setBlueprint(blueprint())
    const wrapper = mountWith(session)
    useToolStore().setSelected([0, 0, 0])
    await wrapper.vm.$nextTick()

    const input = wrapper.find('input[data-setting="ScrollValue"]')
    expect((input.element as HTMLInputElement).value).toBe('16')
    expect(wrapper.find('[data-testid="block-settings"] .source').text()).toBe('内蔵の初期値')

    // 範囲の外はエラーを出し、操作を作らない
    await input.setValue('300')
    await input.trigger('change')
    expect(wrapper.find('[data-testid="block-settings"] .error').text()).toBe('回転数は -256〜256 の範囲で入れてください。')
    expect(session.canUndo.value).toBe(false)

    await input.setValue('64')
    await input.trigger('change')
    await wrapper.vm.$nextTick()
    expect(doc.blueprint.blockEntityAt([0, 0, 0])?.value.get('ScrollValue')).toEqual(nbt.int(64))
    expect(wrapper.find('[data-testid="block-settings"] .source').text()).toBe('設計図')
    expect(wrapper.find('[data-testid="block-settings"] .error').exists()).toBe(false)
    expect(session.nextUndoLabel.value).toBe('creative_motor の回転数を 64 RPM にする')
    expect(wrapper.find('li[data-label="ScrollValue"]').exists()).toBe(true)

    session.undo()
    await wrapper.vm.$nextTick()
    expect(doc.blueprint.blockEntityAt([0, 0, 0])?.value.has('ScrollValue')).toBe(false)
    expect((wrapper.find('input[data-setting="ScrollValue"]').element as HTMLInputElement).value).toBe('16')
  })

  it('設定のないブロックでは、設定の欄を出さない', async () => {
    const session = createDocumentSession()
    session.setBlueprint(blueprint())
    const wrapper = mountWith(session)
    useToolStore().setSelected([1, 1, 0])
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="block-settings"]').exists()).toBe(false)
  })
})
