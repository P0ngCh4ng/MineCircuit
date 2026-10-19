import { describe, expect, it } from 'vitest'
import { blueprintContents, blueprintFixture, state } from '../../../tests/fixtures/blueprintFixture'
import type { BlockState } from '../../domain/blockState'
import type { Blueprint } from '../../domain/blueprint'
import { nbt } from '../../domain/nbt'
import type { Vec3 } from '../../domain/vec3'
import type { EditCommand } from '../../edit/editCommand'
import { EditHistory } from '../../edit/editHistory'
import type { EditToolContext } from './editToolContext'
import { EraseTool } from './eraseTool'
import { PickTool } from './pickTool'
import { NO_BRUSH_MESSAGE, OCCUPIED_MESSAGE, placeCell, PlaceTool } from './placeTool'
import type { PickTarget } from './tool'

/** 本物の EditHistory に書き込み、ほかは記録するだけの偽物 */
class FakeContext implements EditToolContext {
  readonly history: EditHistory
  brushState: BlockState | null = null
  message: string | null = null
  hovered: Vec3 | null = null
  ghost: Vec3 | null = null
  readonly revealed: number[] = []

  constructor(readonly bp: Blueprint) {
    this.history = new EditHistory(bp)
  }
  blueprint(): Blueprint | null {
    return this.bp
  }
  apply(cmd: EditCommand | null): boolean {
    if (!cmd) return false
    this.history.apply(cmd)
    return true
  }
  brush(): BlockState | null {
    return this.brushState
  }
  setBrush(s: BlockState): void {
    this.brushState = s
  }
  notify(message: string | null): void {
    this.message = message
  }
  setHovered(pos: Vec3 | null): void {
    this.hovered = pos
  }
  setGhost(pos: Vec3 | null): void {
    this.ghost = pos
  }
  revealLayer(y: number): void {
    this.revealed.push(y)
  }
}

const NO_SHIFT = { shift: false }
const SHIFT = { shift: true }

function sample(): Blueprint {
  return blueprintFixture({ size: [3, 3, 3] })
    .place([1, 0, 1], 'create:shaft', { axis: 'y' })
    .place([0, 0, 0], 'minecraft:stone')
    .toBlueprint()
}

const hit = (pos: Vec3, face: PickTarget['face']): PickTarget => ({ pos, face, empty: false })

describe('placeCell', () => {
  it('空きマスはそのマス、面のあるブロックは面の隣、Shift と面なしは置き換え', () => {
    expect(placeCell({ pos: [1, 0, 2], empty: true }, NO_SHIFT)).toEqual({ pos: [1, 0, 2], replace: false })
    expect(placeCell(hit([1, 0, 1], 'up'), NO_SHIFT)).toEqual({ pos: [1, 1, 1], replace: false })
    expect(placeCell(hit([1, 0, 1], 'north'), NO_SHIFT)).toEqual({ pos: [1, 0, 0], replace: false })
    expect(placeCell(hit([1, 0, 1], 'east'), NO_SHIFT)).toEqual({ pos: [2, 0, 1], replace: false })
    expect(placeCell(hit([1, 0, 1], 'up'), SHIFT)).toEqual({ pos: [1, 0, 1], replace: true })
    // 2D の埋まったマス
    expect(placeCell({ pos: [1, 0, 1], empty: false }, NO_SHIFT)).toEqual({ pos: [1, 0, 1], replace: true })
  })
})

describe('PlaceTool', () => {
  it('当たった面の隣に置き、元に戻すと完全に元に戻る', () => {
    const bp = sample()
    const before = blueprintContents(bp)
    const ctx = new FakeContext(bp)
    ctx.brushState = state('create:cogwheel', { axis: 'y' })
    const tool = new PlaceTool(ctx)

    tool.onClick(hit([1, 0, 1], 'up'), NO_SHIFT)
    expect(bp.get([1, 1, 1])?.key).toBe('create:cogwheel[axis=y]')
    expect(bp.get([1, 0, 1])?.key).toBe('create:shaft[axis=y]')
    expect(ctx.revealed).toEqual([1])
    expect(ctx.message).toBeNull()

    ctx.history.undo()
    expect(blueprintContents(bp)).toEqual(before)
    ctx.history.redo()
    expect(bp.get([1, 1, 1])?.key).toBe('create:cogwheel[axis=y]')
  })

  it('何もない所は今の段の床（空きマス）に置く', () => {
    const bp = sample()
    const ctx = new FakeContext(bp)
    ctx.brushState = state('minecraft:glass')
    new PlaceTool(ctx).onClick({ pos: [2, 0, 2], empty: true }, NO_SHIFT)
    expect(bp.get([2, 0, 2])?.key).toBe('minecraft:glass')
  })

  it('Shift+クリックと2Dの埋まったマスは置き換える', () => {
    const bp = sample()
    const ctx = new FakeContext(bp)
    ctx.brushState = state('minecraft:glass')
    const tool = new PlaceTool(ctx)
    tool.onClick(hit([1, 0, 1], 'up'), SHIFT)
    expect(bp.get([1, 0, 1])?.key).toBe('minecraft:glass')
    tool.onClick({ pos: [0, 0, 0], empty: false }, NO_SHIFT)
    expect(bp.get([0, 0, 0])?.key).toBe('minecraft:glass')
    expect(bp.get([1, 1, 1])).toBeNull()
  })

  it('範囲の外には置かず、理由を知らせる', () => {
    const bp = sample()
    const ctx = new FakeContext(bp)
    ctx.brushState = state('minecraft:glass')
    new PlaceTool(ctx).onClick(hit([0, 0, 0], 'west'), NO_SHIFT)
    expect(ctx.history.count).toBe(0)
    expect(ctx.message).toContain('範囲の外には置けません')
    expect(ctx.message).toContain('3×3×3')
  })

  it('置くブロックがなければ知らせる。隣が埋まっていれば置かずに知らせる', () => {
    const bp = blueprintFixture({ size: [2, 1, 1] }).place([0, 0, 0], 'minecraft:stone').place([1, 0, 0], 'minecraft:dirt').toBlueprint()
    const ctx = new FakeContext(bp)
    const tool = new PlaceTool(ctx)
    tool.onClick(hit([0, 0, 0], 'east'), NO_SHIFT)
    expect(ctx.message).toBe(NO_BRUSH_MESSAGE)

    ctx.brushState = state('minecraft:glass')
    tool.onClick(hit([0, 0, 0], 'east'), NO_SHIFT)
    expect(ctx.message).toBe(OCCUPIED_MESSAGE)
    expect(bp.get([1, 0, 0])?.key).toBe('minecraft:dirt')
  })

  it('同じブロックの置き換えは変化なしで、履歴に積まない', () => {
    const bp = sample()
    const ctx = new FakeContext(bp)
    ctx.brushState = state('minecraft:stone')
    new PlaceTool(ctx).onClick(hit([0, 0, 0], 'up'), SHIFT)
    expect(ctx.history.count).toBe(0)
    expect(ctx.revealed).toEqual([])
  })

  it('マウスの下の置ける所に見本を出し、置けない所と切り替えで消す', () => {
    const bp = sample()
    const ctx = new FakeContext(bp)
    const tool = new PlaceTool(ctx)
    tool.onHover(hit([1, 0, 1], 'up'))
    expect(ctx.ghost).toBeNull() // 置くブロックがない

    ctx.brushState = state('minecraft:glass')
    tool.onHover(hit([1, 0, 1], 'up'))
    expect(ctx.ghost).toEqual([1, 1, 1])
    tool.onHover(hit([0, 0, 0], 'west'))
    expect(ctx.ghost).toBeNull() // 範囲の外
    tool.onHover({ pos: [2, 0, 2], empty: true })
    expect(ctx.ghost).toEqual([2, 0, 2])
    tool.deactivate()
    expect(ctx.ghost).toBeNull()
  })
})

describe('EraseTool', () => {
  it('クリックしたブロックを消し、元に戻すと生データも戻る', () => {
    const bp = blueprintFixture({ size: [2, 1, 1] })
      .place([0, 0, 0], 'create:creative_motor', { facing: 'east' }, nbt.compound({ Speed: nbt.int(64) }))
      .toBlueprint()
    const before = blueprintContents(bp)
    const ctx = new FakeContext(bp)
    const tool = new EraseTool(ctx)
    tool.onHover(hit([0, 0, 0], 'up'))
    expect(ctx.hovered).toEqual([0, 0, 0])
    tool.onClick(hit([0, 0, 0], 'up'), NO_SHIFT)
    expect(bp.get([0, 0, 0])).toBeNull()
    tool.onClick({ pos: [1, 0, 0], empty: true }, NO_SHIFT)
    expect(ctx.history.count).toBe(1)
    ctx.history.undo()
    expect(blueprintContents(bp)).toEqual(before)
  })
})

describe('PickTool', () => {
  it('クリックしたブロックの状態を置くブロックにする。空きマスでは変えない', () => {
    const bp = sample()
    const ctx = new FakeContext(bp)
    const tool = new PickTool(ctx)
    tool.onClick(hit([1, 0, 1], 'up'), NO_SHIFT)
    expect(ctx.brushState?.key).toBe('create:shaft[axis=y]')
    expect(ctx.message).toContain('create:shaft[axis=y]')
    tool.onClick({ pos: [2, 0, 2], empty: true }, NO_SHIFT)
    expect(ctx.brushState?.key).toBe('create:shaft[axis=y]')
    expect(ctx.history.count).toBe(0)
  })
})
