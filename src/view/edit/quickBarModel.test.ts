import { describe, expect, it } from 'vitest'
import { BlockState } from '../../domain/blockState'
import { ResourceLocation } from '../../domain/resourceLocation'
import {
  DEFAULT_QUICK_ACTIONS,
  moveAction,
  parseQuickBar,
  QUICK_SLOT_COUNT,
  recordUse,
  serializeQuickBar,
  toggleAction,
  togglePin,
  updateState,
  type QuickSlot,
} from './quickBarModel'

const state = (id: string, properties: Record<string, string> = {}) =>
  new BlockState(ResourceLocation.parse(id), properties)

const keys = (slots: readonly QuickSlot[]) => slots.map((s) => `${s.pinned ? '*' : ''}${s.state.key}`)

/** 左から ids の順に並ぶよう、右から足す */
function fill(ids: string[]): QuickSlot[] {
  return ids.reduceRight<QuickSlot[]>((slots, id) => recordUse(slots, state(id)), [])
}

describe('recordUse', () => {
  it('新しいものを左に足し、9 マスを超えたら右端の古いものから消す', () => {
    let slots: QuickSlot[] = []
    for (let i = 1; i <= QUICK_SLOT_COUNT + 1; i++) slots = recordUse(slots, state(`test:b${i}`))
    expect(slots).toHaveLength(QUICK_SLOT_COUNT)
    expect(slots[0]!.state.key).toBe('test:b10')
    expect(keys(slots)).not.toContain('test:b1')
  })

  it('同じ ID は1マスにまとめ、最後の状態で左へ動かす', () => {
    const slots = recordUse(fill(['create:cogwheel', 'create:shaft']), state('create:shaft', { axis: 'x' }))
    expect(keys(slots)).toEqual(['create:shaft[axis=x]', 'create:cogwheel'])
  })

  it('固定したマスは左端に残り、押し出されず、状態も変わらない', () => {
    let slots = togglePin(fill(['create:shaft', 'create:cogwheel']), 1)
    expect(keys(slots)).toEqual(['*create:cogwheel', 'create:shaft'])
    slots = recordUse(slots, state('create:gearbox'))
    expect(keys(slots)).toEqual(['*create:cogwheel', 'create:gearbox', 'create:shaft'])
    slots = recordUse(slots, state('create:cogwheel', { axis: 'x' }))
    expect(keys(slots)).toEqual(['*create:cogwheel', 'create:gearbox', 'create:shaft'])
    for (let i = 0; i < 20; i++) slots = recordUse(slots, state(`test:b${i}`))
    expect(slots[0]!.state.key).toBe('create:cogwheel')
    expect(slots).toHaveLength(QUICK_SLOT_COUNT)
  })
})

describe('updateState', () => {
  it('同じ ID の固定していないマスの状態だけを変え、並びは変えない', () => {
    const slots = updateState(fill(['create:cogwheel', 'create:shaft']), state('create:shaft', { axis: 'z' }))
    expect(keys(slots)).toEqual(['create:cogwheel', 'create:shaft[axis=z]'])
    const pinned = togglePin(fill(['create:shaft']), 0)
    expect(keys(updateState(pinned, state('create:shaft', { axis: 'z' })))).toEqual(['*create:shaft'])
  })
})

describe('togglePin', () => {
  it('固定は固定の並びの最後に、外すと固定していないマスの先頭に置く', () => {
    let slots = fill(['test:a', 'test:b', 'test:c'])
    slots = togglePin(slots, 2)
    slots = togglePin(slots, 2)
    expect(keys(slots)).toEqual(['*test:c', '*test:b', 'test:a'])
    slots = togglePin(slots, 0)
    expect(keys(slots)).toEqual(['*test:b', 'test:c', 'test:a'])
    expect(togglePin(slots, 9)).toEqual(slots)
  })
})

describe('操作の並び', () => {
  it('出し入れ。入れるときは初期の並びでの位置に戻す', () => {
    let actions = toggleAction(DEFAULT_QUICK_ACTIONS, 'redo')
    expect(actions).toEqual(['undo', 'rotate', 'rotateVertical'])
    actions = toggleAction(actions, 'redo')
    expect(actions).toEqual(['undo', 'redo', 'rotate', 'rotateVertical'])
    expect(toggleAction(['rotate'], 'rotateVertical')).toEqual(['rotate', 'rotateVertical'])
  })

  it('並べ替え。端では動かさない', () => {
    expect(moveAction(DEFAULT_QUICK_ACTIONS, 'rotate', -1)).toEqual(['undo', 'rotate', 'redo', 'rotateVertical'])
    expect(moveAction(DEFAULT_QUICK_ACTIONS, 'undo', -1)).toEqual([...DEFAULT_QUICK_ACTIONS])
    expect(moveAction(DEFAULT_QUICK_ACTIONS, 'rotateVertical', 1)).toEqual([...DEFAULT_QUICK_ACTIONS])
  })
})

describe('保存', () => {
  it('書き出して読み直すと、マスの状態・固定・操作の並びが一致する', () => {
    const slots = togglePin(fill(['create:shaft', 'minecraft:stone']), 1)
    const withState = recordUse(slots, state('create:cogwheel', { axis: 'x', waterlogged: 'false' }))
    const actions = moveAction(DEFAULT_QUICK_ACTIONS, 'rotate', -1)
    const back = parseQuickBar(serializeQuickBar({ slots: withState, actions }))
    expect(keys(back.slots)).toEqual(keys(withState))
    expect(back.actions).toEqual(actions)
  })

  it('保存がない・壊れている・形が違うときは初期の並び', () => {
    for (const text of [null, '{', '[]', '{"version":2}']) {
      expect(parseQuickBar(text)).toEqual({ slots: [], actions: [...DEFAULT_QUICK_ACTIONS] })
    }
  })

  it('読めないマスと知らない操作は捨てる', () => {
    const text = JSON.stringify({
      version: 1,
      slots: [{ state: 'create:shaft[axis=y]', pinned: false }, { state: 'bad id!' }, 3, { state: 'create:shaft' }],
      actions: ['redo', 'jump', 'redo', 'undo'],
    })
    const back = parseQuickBar(text)
    expect(keys(back.slots)).toEqual(['create:shaft[axis=y]'])
    expect(back.actions).toEqual(['redo', 'undo'])
  })
})
