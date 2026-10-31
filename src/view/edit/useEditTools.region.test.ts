// 範囲の選択とキー操作（Delete / F / Ctrl+A）のつなぎ（#130）。
// 範囲の操作の中身（useRegionActions）は別に確かめるので、ここでは偽物にして、どれを呼ぶかだけを見る。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h } from 'vue'
import { blueprintFixture } from '../../../tests/fixtures/blueprintFixture'
import { boxFromCorners } from '../../domain/box'
import { createDocumentSession, DOCUMENT_SESSION_KEY } from '../document/documentSession'
import { useBrushStore } from '../stores/brushStore'
import { useToolStore } from '../stores/toolStore'
import { useViewStore } from '../stores/viewStore'
import type { RegionActions } from './regionActions'
import { useEditTools, type EditKeyActions } from './useEditTools'

const region = vi.hoisted(() => ({
  erase: vi.fn<RegionActions['erase']>(() => true),
  fill: vi.fn<RegionActions['fill']>(() => true),
  replace: vi.fn<RegionActions['replace']>(() => true),
  selectAll: vi.fn<RegionActions['selectAll']>(),
}))

vi.mock('./regionActions', () => ({ useRegionActions: () => region }))

let wrapper: VueWrapper | null = null

function setup() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const session = createDocumentSession()
  session.setBlueprint(
    blueprintFixture({ size: [3, 2, 1] })
      .place([0, 0, 0], 'create:shaft', { axis: 'x' })
      .place([1, 0, 0], 'minecraft:stone')
      .toBlueprint(),
  )
  let edit: EditKeyActions | null = null
  const Host = defineComponent({
    setup() {
      edit = useEditTools()
      return () => h('div')
    },
  })
  wrapper = mount(Host, {
    global: { plugins: [pinia], provide: { [DOCUMENT_SESSION_KEY as symbol]: session } },
  })
  return { session, edit: edit!, tools: useToolStore(), brush: useBrushStore() }
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

describe('範囲の選択と Delete', () => {
  it('2つ以上のマスの範囲なら、範囲の中を消す操作を呼ぶ', () => {
    const { edit, tools } = setup()
    tools.setSelected([0, 0, 0])
    tools.extendSelection([2, 1, 0])
    expect(edit.deleteSelected()).toBe(true)
    expect(region.erase).toHaveBeenCalledOnce()
  })

  it('1マスの範囲なら、今までどおりそのブロックを消して選択を外す', () => {
    const { edit, tools, session } = setup()
    tools.setSelected([1, 0, 0])
    expect(edit.deleteSelected()).toBe(true)
    expect(region.erase).not.toHaveBeenCalled()
    expect(session.current.value!.blueprint.get([1, 0, 0])).toBeNull()
    expect(tools.selectedPos).toBeNull()
    expect(tools.selectionBox).toBeNull()
  })

  it('起点のブロックを消しても、2つ以上のマスの範囲は残す', () => {
    const { tools, session } = setup()
    tools.setSelected([1, 0, 0])
    tools.extendSelection([2, 1, 0])
    const box = tools.selectionBox
    tools.setTool('erase')
    tools.click({ pos: [1, 0, 0], face: 'up', empty: false })
    expect(session.current.value!.blueprint.get([1, 0, 0])).toBeNull()
    expect(tools.selectionBox).toEqual(box)
    expect(tools.selectedPos).toEqual([1, 0, 0])
  })
})

describe('F（範囲を塗る）と Ctrl+A（全体を選ぶ）', () => {
  it('範囲を選んでいれば、空きだけを塗る操作を呼ぶ。1マスでも同じ', () => {
    const { edit, tools, brush, session } = setup()
    brush.setFromBlock(session.current.value!.blueprint.get([1, 0, 0]))
    tools.setSelectionBox(boxFromCorners([0, 0, 0], [2, 1, 0]))
    expect(edit.fillSelection()).toBe(true)
    expect(region.fill).toHaveBeenLastCalledWith(true)
    tools.setSelected([2, 0, 0])
    edit.fillSelection()
    expect(region.fill).toHaveBeenCalledTimes(2)
    expect(region.fill).toHaveBeenLastCalledWith(true)
  })

  it('何も選んでいなければ塗らない', () => {
    const { edit, brush, session } = setup()
    brush.setFromBlock(session.current.value!.blueprint.get([1, 0, 0]))
    expect(edit.fillSelection()).toBe(false)
    expect(region.fill).not.toHaveBeenCalled()
  })

  it('Ctrl+A の処理は、全体を選ぶ操作を呼ぶ', () => {
    const { edit } = setup()
    edit.selectAll()
    expect(region.selectAll).toHaveBeenCalledOnce()
  })

  it('選択の解除（Esc）で範囲も消える', () => {
    const { tools } = setup()
    tools.setSelected([0, 0, 0])
    tools.extendSelection([2, 1, 0])
    tools.setSelected(null)
    expect(tools.selectionBox).toBeNull()
    expect(tools.selectedPos).toBeNull()
  })
})

describe('Shift+矢印で範囲を広げる・縮める（#205）', () => {
  it('2D では右が x の正。1マスの選択から広げ、Ctrl で縮める。設計図の端で止まり、履歴には入れない', () => {
    const { edit, tools, session, brush } = setup()
    useViewStore().setMode('2d')
    tools.setSelected([1, 0, 0])
    expect(edit.growSelection('right', false)).toBe(true)
    expect(tools.selectionBox).toEqual({ min: [1, 0, 0], max: [2, 0, 0] })
    expect(brush.message).toBe('範囲 2 × 1 × 1')
    // 設計図の端（x = 2）より外へは広げない
    expect(edit.growSelection('right', false)).toBe(false)
    expect(edit.growSelection('left', false)).toBe(true)
    expect(tools.selectionBox).toEqual({ min: [0, 0, 0], max: [2, 0, 0] })
    expect(edit.growSelection('left', true)).toBe(true)
    expect(tools.selectionBox).toEqual({ min: [1, 0, 0], max: [2, 0, 0] })
    expect(session.canUndo.value).toBe(false)
  })
})
