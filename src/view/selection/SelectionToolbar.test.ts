import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h, nextTick } from 'vue'
import { blueprintFixture, state } from '../../../tests/fixtures/blueprintFixture'
import { createDocumentSession, provideDocumentSession, type DocumentSession } from '../document/documentSession'
import { useBrushStore } from '../stores/brushStore'
import { setModpackLoadEnvironment } from '../stores/modpackContent'
import { usePasteStore } from '../stores/pasteStore'
import { useToolStore } from '../stores/toolStore'
import SelectionToolbar from './SelectionToolbar.vue'
import { boundingRect, toolbarPosition, TOOLBAR_GAP, type ScreenRect } from './toolbarPosition'

function blueprint() {
  return blueprintFixture({ size: [4, 3, 1] })
    .place([0, 0, 0], 'create:shaft', { axis: 'x' })
    .place([1, 0, 0], 'create:shaft', { axis: 'x' })
    .place([2, 0, 0], 'minecraft:stone')
    .place([0, 1, 0], 'minecraft:dirt')
    .place([3, 2, 0], 'minecraft:stone')
    .toBlueprint()
}

const RECT: ScreenRect = { left: 100, top: 120, right: 200, bottom: 180 }

function mountWith(session: DocumentSession, rect: ScreenRect | null) {
  const Host = defineComponent({
    setup() {
      provideDocumentSession(session)
      return () => h(SelectionToolbar, { rect, viewWidth: 800, viewHeight: 600 })
    },
  })
  return mount(Host)
}

async function setup(rect: ScreenRect | null = RECT) {
  const session = createDocumentSession()
  const doc = session.setBlueprint(blueprint())
  const wrapper = mountWith(session, rect)
  const tools = useToolStore()
  tools.setSelectionBox({ min: [0, 0, 0], max: [2, 1, 0] })
  await nextTick()
  return { session, bp: doc.blueprint, wrapper, tools, brush: useBrushStore() }
}

describe('toolbarPosition', () => {
  it('範囲の上に右端をそろえて置く。上に入らなければ下、横にはみ出せば内側に寄せる', () => {
    const g = TOOLBAR_GAP
    expect(toolbarPosition({ left: 300, top: 200, right: 400, bottom: 260 }, 150, 30, 800, 600)).toEqual({ left: 250, top: 200 - 30 - g })
    // 上に入らない
    expect(toolbarPosition({ left: 300, top: 20, right: 400, bottom: 60 }, 150, 30, 800, 600)).toEqual({ left: 250, top: 60 + g })
    // 左と下にはみ出す
    expect(toolbarPosition({ left: -50, top: 10, right: 40, bottom: 900 }, 150, 30, 800, 600)).toEqual({ left: g, top: 600 - 30 - g })
    // 右にはみ出す
    expect(toolbarPosition({ left: 700, top: 200, right: 1000, bottom: 260 }, 150, 30, 800, 600).left).toBe(800 - 150 - g)
  })

  it('boundingRect は点を囲む。点がなければ null', () => {
    expect(boundingRect([[3, 4], [1, 9], [5, 2]])).toEqual({ left: 1, top: 2, right: 5, bottom: 9 })
    expect(boundingRect([])).toBeNull()
  })
})

describe('SelectionToolbar', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    setModpackLoadEnvironment({ cache: null, scan: null })
  })

  afterEach(() => {
    setModpackLoadEnvironment(null)
  })

  it('2つ以上のマスの範囲を選んでいるときに、ブロックの数と操作のボタンを出す', async () => {
    const { wrapper, tools } = await setup()
    expect(wrapper.get('[data-selection="count"]').text()).toBe('4 個')
    expect(wrapper.findAll('[data-action]').map((b) => b.attributes('data-action'))).toEqual([
      'erase',
      'fill',
      'replace-open',
      'rotate-right',
      'rotate-left',
      'mirror-x',
      'mirror-z',
      'copy',
      'cut',
      'duplicate',
      'paste',
      'fit-content',
      'full-height',
      'select-all',
    ])
    expect(wrapper.get('[data-action="mirror-x"]').text()).toBe('x 軸で反転')
    expect(wrapper.get('[data-action="mirror-z"]').text()).toBe('z 軸で反転')

    // 1つのブロックだけのとき、何も選んでいないときは出さない
    tools.setSelected([0, 0, 0])
    await nextTick()
    expect(wrapper.find('[data-testid="selection-toolbar"]').exists()).toBe(false)
    tools.setSelected(null)
    await nextTick()
    expect(wrapper.find('[data-testid="selection-toolbar"]').exists()).toBe(false)
  })

  it('範囲が見えないとき（rect が null）と、貼り付けの見本を出している間は出さない', async () => {
    const hidden = await setup(null)
    expect(hidden.wrapper.find('[data-testid="selection-toolbar"]').exists()).toBe(false)
    hidden.wrapper.unmount()

    const { wrapper } = await setup()
    await wrapper.get('[data-action="copy"]').trigger('click')
    await wrapper.get('[data-action="paste"]').trigger('click')
    expect(usePasteStore().active).toBe(true)
    expect(wrapper.find('[data-testid="selection-toolbar"]').exists()).toBe(false)
  })

  it('「貼り付け」は切り抜きがないと押せない。「全体を選ぶ」は設計図全体を選ぶ', async () => {
    const { wrapper, tools } = await setup()
    expect(wrapper.get('[data-action="paste"]').attributes('disabled')).toBeDefined()
    await wrapper.get('[data-action="copy"]').trigger('click')
    expect(wrapper.get('[data-action="paste"]').attributes('disabled')).toBeUndefined()

    await wrapper.get('[data-action="select-all"]').trigger('click')
    expect(tools.selectionBox).toEqual({ min: [0, 0, 0], max: [3, 2, 0] })
    expect(wrapper.get('[data-selection="count"]').text()).toBe('5 個')
  })

  it('「消す」で範囲の中を消し、範囲は残す。1回で元に戻る', async () => {
    const { wrapper, session, bp, tools } = await setup()
    await wrapper.get('[data-action="erase"]').trigger('click')
    expect(bp.get([0, 0, 0])).toBeNull()
    expect(bp.get([0, 1, 0])).toBeNull()
    expect(bp.get([3, 2, 0])?.key).toBe('minecraft:stone')
    expect(tools.selectionBox).toEqual({ min: [0, 0, 0], max: [2, 1, 0] })
    expect(wrapper.get('[data-selection="count"]').text()).toBe('0 個')
    session.undo()
    expect(bp.get([0, 0, 0])?.key).toBe('create:shaft[axis=x]')
    expect(bp.get([0, 1, 0])?.key).toBe('minecraft:dirt')
  })

  it('「x 軸で反転」は範囲の中で写し、「右に回す」ははみ出せば設計図を広げる。どちらも1回で元に戻る', async () => {
    const { wrapper, session, bp, brush } = await setup()
    await wrapper.get('[data-action="mirror-x"]').trigger('click')
    expect(bp.get([0, 0, 0])?.key).toBe('minecraft:stone')
    expect(bp.get([2, 0, 0])?.key).toBe('create:shaft[axis=x]')
    expect(bp.get([2, 1, 0])?.key).toBe('minecraft:dirt')
    session.undo()
    expect(bp.get([0, 0, 0])?.key).toBe('create:shaft[axis=x]')

    await wrapper.get('[data-action="rotate-right"]').trigger('click')
    // 中心 [1,0,0] のまわりで x 0〜2 が z −1〜1 になるので、z が +1 ずれ、奥行きが 3 になる
    expect(session.current.value!.blueprint.size).toEqual([4, 3, 3])
    expect(bp.get([1, 0, 0])?.key).toBe('create:shaft[axis=z]')
    expect(bp.get([1, 0, 2])?.key).toBe('minecraft:stone')
    expect(brush.message).toBe('設計図を負の向きに広げたので、座標が z +1 ずれました')
    session.undo()
    expect(bp.size).toEqual([4, 3, 1])
    expect(bp.get([0, 0, 0])?.key).toBe('create:shaft[axis=x]')
  })

  it('「塗る」は初期値で空きだけを塗る。外すと全部を塗る', async () => {
    const { wrapper, bp, brush } = await setup()
    await wrapper.get('[data-action="fill"]').trigger('click')
    expect(brush.message).toBe('置くブロックを選んでください（左パネルの棚か、スポイト）')

    brush.setFromBlock(state('minecraft:glass'))
    await nextTick()
    expect((wrapper.get('[data-option="only-empty"]').element as HTMLInputElement).checked).toBe(true)
    await wrapper.get('[data-action="fill"]').trigger('click')
    expect(bp.get([1, 1, 0])?.key).toBe('minecraft:glass')
    expect(bp.get([0, 0, 0])?.key).toBe('create:shaft[axis=x]')

    await wrapper.get('[data-option="only-empty"]').setValue(false)
    await wrapper.get('[data-action="fill"]').trigger('click')
    expect(bp.get([0, 0, 0])?.key).toBe('minecraft:glass')
    expect(bp.get([3, 2, 0])?.key).toBe('minecraft:stone')
  })

  it('置き換え：「置き換え…」でフォームを開き、範囲の中の状態から選んで置くブロックにする。向きは初期値で引き継ぐ', async () => {
    const { wrapper, bp, brush } = await setup()
    expect(wrapper.find('[data-testid="replace-form"]').exists()).toBe(false)
    await wrapper.get('[data-action="replace-open"]').trigger('click')
    const select = wrapper.get('[data-option="replace-from"]')
    expect(select.findAll('option').map((o) => o.attributes('value'))).toEqual([
      'create:shaft[axis=x]',
      'minecraft:dirt',
      'minecraft:stone',
    ])
    brush.setFromBlock(state('create:cogwheel', { axis: 'y' }))
    await nextTick()
    expect(wrapper.get('[data-selection="replace-to"]').text()).toBe('create:cogwheel[axis=y]')
    expect((wrapper.get('[data-option="keep-orientation"]').element as HTMLInputElement).checked).toBe(true)

    await wrapper.get('[data-action="replace"]').trigger('click')
    expect(bp.get([0, 0, 0])?.key).toBe('create:cogwheel[axis=x]')
    expect(bp.get([1, 0, 0])?.key).toBe('create:cogwheel[axis=x]')
    expect(bp.get([2, 0, 0])?.key).toBe('minecraft:stone')
    // 置き換えたらフォームを閉じる
    expect(wrapper.find('[data-testid="replace-form"]').exists()).toBe(false)

    // 石を選び、向きを引き継がずに置き換える
    await wrapper.get('[data-action="replace-open"]').trigger('click')
    await wrapper.get('[data-option="replace-from"]').setValue('minecraft:stone')
    await wrapper.get('[data-option="keep-orientation"]').setValue(false)
    await wrapper.get('[data-action="replace"]').trigger('click')
    expect(bp.get([2, 0, 0])?.key).toBe('create:cogwheel[axis=y]')
    expect(bp.get([3, 2, 0])?.key).toBe('minecraft:stone')
  })

  it('「中身に合わせる」は中のブロックが入る箱に、「上下すべての段」は一番下から一番上の段までに選び直す。同じなら押せない（#205）', async () => {
    const { wrapper, tools, session } = await setup()
    // 今の範囲はもう中身に合っている
    expect(wrapper.get('[data-action="fit-content"]').attributes('disabled')).toBeDefined()
    tools.setSelectionBox({ min: [0, 0, 0], max: [3, 1, 0] })
    await nextTick()
    await wrapper.get('[data-action="fit-content"]').trigger('click')
    expect(tools.selectionBox).toEqual({ min: [0, 0, 0], max: [2, 1, 0] })
    await wrapper.get('[data-action="full-height"]').trigger('click')
    expect(tools.selectionBox).toEqual({ min: [0, 0, 0], max: [2, 2, 0] })
    expect(wrapper.get('[data-action="full-height"]').attributes('disabled')).toBeDefined()
    expect(useBrushStore().message).toBe('範囲 3 × 3 × 1')
    expect(session.canUndo.value).toBe(false)
  })
})
