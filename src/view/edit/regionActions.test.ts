import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import { blueprintFixture, state } from '../../../tests/fixtures/blueprintFixture'
import { createDocumentSession, provideDocumentSession, type DocumentSession } from '../document/documentSession'
import { useBrushStore } from '../stores/brushStore'
import { useToolStore } from '../stores/toolStore'
import { REGION_MESSAGES, useRegionActions, type RegionActions } from './regionActions'

function withActions(session: DocumentSession): RegionActions {
  let actions: RegionActions | null = null
  mount(
    defineComponent({
      setup() {
        provideDocumentSession(session)
        return () => h(defineComponent({ setup: () => ((actions = useRegionActions()), () => null) }))
      },
    }),
  )
  if (!actions) throw new Error('useRegionActions を呼べなかった')
  return actions
}

function setup(open = true) {
  const session = createDocumentSession()
  if (open) {
    session.setBlueprint(
      blueprintFixture({ size: [3, 2, 2] })
        .place([0, 0, 0], 'minecraft:stone')
        .place([1, 0, 0], 'create:shaft', { axis: 'x' })
        .toBlueprint(),
    )
  }
  return { session, actions: withActions(session), tools: useToolStore(), brush: useBrushStore() }
}

describe('useRegionActions', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('Ctrl+A の全体選択は、設計図全体（0〜大きさ−1）を範囲にする', () => {
    const { actions, tools } = setup()
    actions.selectAll()
    expect(tools.selectionBox).toEqual({ min: [0, 0, 0], max: [2, 1, 1] })
  })

  it('設計図がない・範囲がないときは何もせず、知らせを出す', () => {
    const none = setup(false)
    expect(none.actions.erase()).toBe(false)
    expect(none.brush.message).toBe(REGION_MESSAGES.noBlueprint)
    none.actions.selectAll()
    expect(none.tools.selectionBox).toBeNull()

    const { actions, brush } = setup()
    expect(actions.erase()).toBe(false)
    expect(brush.message).toBe(REGION_MESSAGES.noSelection)
  })

  it('消すと範囲は残り、選択中の起点を消しても選択は外れない', () => {
    const { session, actions, tools } = setup()
    tools.setSelectionBox({ min: [0, 0, 0], max: [1, 0, 0] })
    expect(actions.erase()).toBe(true)
    const bp = session.current.value!.blueprint
    expect(bp.get([0, 0, 0])).toBeNull()
    expect(bp.get([1, 0, 0])).toBeNull()
    expect(tools.selectionBox).toEqual({ min: [0, 0, 0], max: [1, 0, 0] })
    expect(session.nextUndoLabel.value).toContain('2')
    // もう消すものはない
    expect(actions.erase()).toBe(false)
    expect(useBrushStore().message).toBe(REGION_MESSAGES.nothingToErase)
  })

  it('塗る：置くブロックがなければ知らせ、空きがなければそう出す。成功すると知らせを消す', () => {
    const { session, actions, tools, brush } = setup()
    tools.setSelectionBox({ min: [0, 0, 0], max: [1, 0, 0] })
    expect(actions.fill(true)).toBe(false)
    expect(brush.message).toBe(REGION_MESSAGES.noBrush)

    brush.setFromBlock(state('minecraft:glass'))
    expect(actions.fill(true)).toBe(false)
    expect(brush.message).toBe(REGION_MESSAGES.noEmptyCell)

    expect(actions.fill(false)).toBe(true)
    expect(brush.message).toBeNull()
    expect(session.current.value!.blueprint.get([1, 0, 0])?.key).toBe('minecraft:glass')
    expect(actions.fill(false)).toBe(false)
    expect(brush.message).toBe(REGION_MESSAGES.nothingToFill)
  })

  it('置き換え：範囲の中の from を置くブロックにし、向きを引き継げる', () => {
    const { session, actions, tools, brush } = setup()
    tools.setSelectionBox({ min: [0, 0, 0], max: [2, 1, 1] })
    brush.setFromBlock(state('create:cogwheel', { axis: 'y' }))
    expect(actions.replace(state('create:shaft', { axis: 'x' }), true)).toBe(true)
    expect(session.current.value!.blueprint.get([1, 0, 0])?.key).toBe('create:cogwheel[axis=x]')
    expect(actions.replace(state('minecraft:dirt'), true)).toBe(false)
    expect(brush.message).toBe(REGION_MESSAGES.nothingToReplace)
  })
})
