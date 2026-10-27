import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { blueprintFixture } from '../../../tests/fixtures/blueprintFixture'
import { MOVE_MESSAGES } from '../../edit/regionTransform'
import { createDocumentSession, provideDocumentSession } from '../document/documentSession'
import { useBrushStore } from '../stores/brushStore'
import { usePortStore } from '../stores/portStore'
import { useToolStore } from '../stores/toolStore'
import { useRegionActions, type RegionActions } from './regionActions'
import { useRelocationSync } from './relocationSync'

function setup() {
  const session = createDocumentSession()
  session.setBlueprint(
    blueprintFixture({ size: [3, 1, 2] })
      .place([0, 0, 0], 'create:shaft[axis=x]')
      .place([2, 0, 1], 'minecraft:stone')
      .toBlueprint(),
  )
  let actions: RegionActions | null = null
  mount(
    defineComponent({
      setup() {
        provideDocumentSession(session)
        return () =>
          h(
            defineComponent({
              setup() {
                actions = useRegionActions()
                useRelocationSync()
                return () => null
              },
            }),
          )
      },
    }),
  )
  return { session, actions: actions!, tools: useToolStore(), ports: usePortStore(), brush: useBrushStore() }
}

describe('範囲を動かす（画面）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('選択範囲と、範囲の中の仮の入出力が一緒に動き、元に戻す・やり直すでも付いてくる', () => {
    const { session, actions, tools, ports } = setup()
    ports.place([0, 0, 0], 'west')
    ports.place([2, 0, 1], 'east')
    tools.setSelected([0, 0, 0])

    expect(actions.move([0, 0, 1], false)).toBe(true)
    const bp = session.current.value!.blueprint
    expect(bp.get([0, 0, 1])?.key).toBe('create:shaft[axis=x]')
    expect(tools.selectionBox).toEqual({ min: [0, 0, 1], max: [0, 0, 1] })
    expect(tools.selectedPos).toEqual([0, 0, 1])
    expect(ports.ports.map((p) => p.pos)).toEqual([
      [0, 0, 1],
      [2, 0, 1],
    ])

    session.undo()
    expect(tools.selectionBox).toEqual({ min: [0, 0, 0], max: [0, 0, 0] })
    expect(ports.ports[0]!.pos).toEqual([0, 0, 0])
    session.redo()
    expect(tools.selectionBox).toEqual({ min: [0, 0, 1], max: [0, 0, 1] })
    expect(ports.ports[0]!.pos).toEqual([0, 0, 1])
  })

  it('負の向きに広げると、範囲の外の仮の入出力も全体と一緒にずれ、座標のずれを知らせる', async () => {
    const { session, actions, tools, ports, brush } = setup()
    ports.place([2, 0, 1], 'east')
    tools.setSelected([0, 0, 0])
    expect(actions.move([-1, 0, 0], false)).toBe(true)
    expect(session.current.value!.blueprint.size).toEqual([4, 1, 2])
    expect(tools.selectionBox).toEqual({ min: [0, 0, 0], max: [0, 0, 0] })
    expect(ports.ports[0]!.pos).toEqual([3, 0, 1])
    await nextTick()
    expect(brush.message).toContain('座標')
  })

  it('行き先にブロックがあれば動かさず、理由を出す', () => {
    const { actions, tools, brush } = setup()
    tools.setSelected([0, 0, 0])
    expect(actions.move([2, 0, 1], false)).toBe(false)
    expect(brush.message).toBe(MOVE_MESSAGES.blocked(1))
    expect(tools.selectionBox).toEqual({ min: [0, 0, 0], max: [0, 0, 0] })
  })
})
