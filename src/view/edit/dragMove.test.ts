import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { blueprintFixture } from '../../../tests/fixtures/blueprintFixture'
import { copyRegion } from '../../edit/regionClip'
import { useDocumentSession } from '../document/documentSession'
import { useBrushStore } from '../stores/brushStore'
import { useDragMoveStore } from '../stores/dragMoveStore'
import { useToolStore } from '../stores/toolStore'
import { axisParam, DRAG_MOVE_MESSAGES, offsetLabel, planeHit, previewMove } from './dragMove'
import { useDragMove } from './useDragMove'
import { useRelocationSync } from './relocationSync'
import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'

// 5×1×3。範囲 (0..1, 0, 0) に石2つ、(3, 0, 0) にガラス
function sample() {
  return blueprintFixture({ size: [5, 1, 3] })
    .place([0, 0, 0], 'minecraft:stone')
    .place([1, 0, 0], 'minecraft:stone')
    .place([3, 0, 0], 'minecraft:glass')
    .toBlueprint()
}
const BOX = { min: [0, 0, 0], max: [1, 0, 0] } as const

describe('dragMove の計算', () => {
  it('見本は行き先のマス。動かすときは元の範囲とは重ならない、写すときは重なる', () => {
    const bp = sample()
    const clip = copyRegion(bp, BOX)
    const moved = previewMove(bp, clip, BOX, [1, 0, 0], false)
    expect(moved.cells.map((c) => c.pos)).toEqual([
      [1, 0, 0],
      [2, 0, 0],
    ])
    expect(moved.box).toEqual({ min: [1, 0, 0], max: [2, 0, 0] })
    expect(moved.blocked).toBe(0)
    expect(previewMove(bp, clip, BOX, [1, 0, 0], true).blocked).toBe(1)
    // ガラス (3,0,0) に重なる
    expect(previewMove(bp, clip, BOX, [2, 0, 0], false).blocked).toBe(1)
  })

  it('ずれの文', () => {
    expect(offsetLabel([3, 0, -1])).toBe('x +3・z −1')
    expect(offsetLabel([0, 2, 0])).toBe('y +2')
    expect(offsetLabel([0, 0, 0])).toBe('動かない')
  })

  it('水平な面との交点と、軸に沿った直線の上で一番近い点', () => {
    // 真上から下向き
    expect(planeHit({ origin: [2.5, 10, 1.5], direction: [0, -1, 0] }, 0.5)).toEqual([2.5, 1.5])
    expect(planeHit({ origin: [0, 10, 0], direction: [1, 0, 0] }, 0.5)).toBeNull()
    // 横から見て、y = 3 の高さを通るレイ → 点 (0.5, 0.5, 0.5) を通る縦の線の上では +2.5
    expect(axisParam({ origin: [-5, 3, 0.5], direction: [1, 0, 0] }, [0.5, 0.5, 0.5], 1)).toBeCloseTo(2.5)
    // 線と平行なら null
    expect(axisParam({ origin: [0, 0, 0], direction: [0, 1, 0] }, [0.5, 0.5, 0.5], 1)).toBeNull()
  })
})

describe('useDragMove（#199）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useDocumentSession().close()
  })

  function setup() {
    const session = useDocumentSession()
    session.setBlueprint(sample(), 'sample.nbt')
    let drag: ReturnType<typeof useDragMove> | null = null
    // 選択範囲と仮の入出力を一緒に動かす（App と同じ）
    mount(
      defineComponent({
        setup() {
          useRelocationSync()
          drag = useDragMove()
          return () => h('div')
        },
      }),
    )
    const tools = useToolStore()
    tools.setSelectionBox(BOX)
    return { session, drag: drag!, tools, bp: session.current.value!.blueprint }
  }

  it('つかんで動かすと見本とずれを出し、離すと動かす。範囲もついてくる。元に戻すと戻る', () => {
    const { session, drag, tools, bp } = setup()
    expect(drag.begin()).toBe(true)
    drag.update([0, 0, 2], { shift: false })
    expect(useDragMoveStore().preview?.box).toEqual({ min: [0, 0, 2], max: [1, 0, 2] })
    expect(useBrushStore().message).toBe(DRAG_MOVE_MESSAGES.moving([0, 0, 2], false))
    expect(drag.finish([0, 0, 2], { shift: false })).toBe(true)
    expect(useDragMoveStore().preview).toBeNull()
    expect(bp.get([0, 0, 2])?.key).toBe('minecraft:stone')
    expect(bp.get([0, 0, 0])).toBeNull()
    expect(tools.selectionBox).toEqual({ min: [0, 0, 2], max: [1, 0, 2] })
    session.undo()
    expect(bp.get([0, 0, 0])?.key).toBe('minecraft:stone')
    expect(bp.get([0, 0, 2])).toBeNull()
  })

  it('重なるときは赤の見本と理由を出し、離しても動かさない。Ctrl なら上書き', () => {
    const { drag, bp } = setup()
    drag.begin()
    drag.update([2, 0, 0], { shift: false })
    expect(useDragMoveStore().preview?.blocked).toBe(1)
    expect(useBrushStore().message).toBe(DRAG_MOVE_MESSAGES.blocked(1, false))
    expect(drag.finish([2, 0, 0], { shift: false })).toBe(false)
    expect(bp.get([3, 0, 0])?.key).toBe('minecraft:glass')
    drag.begin()
    expect(drag.finish([2, 0, 0], { shift: false, ctrl: true })).toBe(true)
    expect(bp.get([3, 0, 0])?.key).toBe('minecraft:stone')
  })

  it('Alt で離すと写す。元は残り、写した所が範囲になる。1回で元に戻る', () => {
    const { session, drag, tools, bp } = setup()
    drag.begin()
    drag.update([0, 0, 1], { shift: false, alt: true })
    expect(useBrushStore().message).toBe(DRAG_MOVE_MESSAGES.moving([0, 0, 1], true))
    expect(drag.finish([0, 0, 1], { shift: false, alt: true })).toBe(true)
    expect(bp.get([0, 0, 0])?.key).toBe('minecraft:stone')
    expect(bp.get([1, 0, 1])?.key).toBe('minecraft:stone')
    expect(tools.selectionBox).toEqual({ min: [0, 0, 1], max: [1, 0, 1] })
    session.undo()
    expect(bp.get([1, 0, 1])).toBeNull()
  })

  it('ずれがなければやめるだけ。範囲がなければつかめない', () => {
    const { drag, tools, bp } = setup()
    drag.begin()
    expect(drag.finish([0, 0, 0], { shift: false })).toBe(false)
    expect(drag.active).toBe(false)
    expect(bp.get([0, 0, 0])?.key).toBe('minecraft:stone')
    tools.setSelectionBox(null)
    expect(drag.begin()).toBe(false)
  })
})
