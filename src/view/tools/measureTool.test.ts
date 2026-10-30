import { describe, expect, it } from 'vitest'
import type { Vec3 } from '../../domain/vec3'
import { MeasureTool } from './measureTool'
import { NetworkTool } from './networkTool'
import { SameBlockTool } from './sameBlockTool'
import type { PickTarget } from './tool'
import { ToolController } from './toolController'

const NO_MODS = { shift: false }

function block(pos: Vec3): PickTarget {
  return { pos, empty: false }
}

describe('MeasureTool', () => {
  it('1つ目・2つ目と点を足し、3つ目で新しい1つ目からやり直す', () => {
    const seen: (readonly Vec3[])[] = []
    const tool = new MeasureTool({ setMeasurePoints: (p) => seen.push(p) })
    tool.onClick(block([0, 0, 0]), NO_MODS)
    tool.onClick({ pos: [3, 0, 4], empty: true }, NO_MODS)
    tool.onClick(block([1, 1, 1]), NO_MODS)
    expect(seen).toEqual([[[0, 0, 0]], [[0, 0, 0], [3, 0, 4]], [[1, 1, 1]]])
  })

  it('ツールを切り替えると途中の点を消す', () => {
    let points: readonly Vec3[] = []
    const controller = new ToolController()
    controller.register({ id: 'select', onHover: () => {}, onClick: () => {} })
    controller.register(new MeasureTool({ setMeasurePoints: (p) => (points = p) }))
    controller.setActive('measure')
    controller.click(block([2, 0, 2]))
    expect(points).toEqual([[2, 0, 2]])
    controller.setActive('select')
    expect(points).toEqual([])
  })
})

describe('SameBlockTool', () => {
  it('ブロックをクリックしたら始めの位置を渡し、空きマスや切り替えでは消す', () => {
    const seen: (Vec3 | null)[] = []
    const tool = new SameBlockTool({ setSameBlockStart: (p) => seen.push(p) })
    tool.activate()
    tool.onClick(block([1, 2, 3]), NO_MODS)
    tool.onClick({ pos: [0, 0, 0], empty: true }, NO_MODS)
    tool.onClick(block([1, 2, 3]), NO_MODS)
    tool.deactivate()
    expect(seen).toEqual([null, [1, 2, 3], null, [1, 2, 3], null])
  })
})

describe('NetworkTool', () => {
  it('ブロックをクリックしたらその位置を、空きマスなら null を渡す。切り替えても強調を残す', () => {
    const seen: (Vec3 | null)[] = []
    const controller = new ToolController()
    controller.register({ id: 'select', onHover: () => {}, onClick: () => {} })
    controller.register(new NetworkTool({ setProbed: (p) => seen.push(p) }))
    controller.setActive('network')
    controller.click(block([1, 0, 2]))
    controller.click({ pos: [0, 0, 0], empty: true })
    controller.click(block([3, 0, 0]))
    controller.setActive('select')
    expect(seen).toEqual([[1, 0, 2], null, [3, 0, 0]])
  })
})
