import { describe, expect, it } from 'vitest'
import { blueprintContents, blueprintFixture, state } from '../../../tests/fixtures/blueprintFixture'
import type { BlockState } from '../../domain/blockState'
import type { Blueprint } from '../../domain/blueprint'
import type { Direction } from '../../domain/direction'
import { createBuiltinRegistry } from '../../calc/builtinPlugins'
import { nbt } from '../../domain/nbt'
import type { Vec3 } from '../../domain/vec3'
import type { EditCommand } from '../../edit/editCommand'
import { EditHistory } from '../../edit/editHistory'
import type { EditToolContext } from './editToolContext'
import { EraseTool } from './eraseTool'
import { PickTool } from './pickTool'
import {
  alignAxis,
  LINE_NOTHING_MESSAGE,
  lineCells,
  lineSkippedMessage,
  NO_BRUSH_MESSAGE,
  OCCUPIED_MESSAGE,
  placeCell,
  PlaceTool,
} from './placeTool'
import type { PickTarget } from './tool'

/** 本物の EditHistory に書き込み、ほかは記録するだけの偽物 */
class FakeContext implements EditToolContext {
  readonly history: EditHistory
  brushState: BlockState | null = null
  message: string | null = null
  hovered: Vec3 | null = null
  ghost: Vec3 | null = null
  ghostBlocked = false
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
  setGhost(pos: Vec3 | null, blocked = false): void {
    this.ghost = pos
    this.ghostBlocked = blocked
  }
  linePreview: { cells: readonly { pos: Vec3; state: BlockState }[] } | null = null
  setLinePreview(preview: { cells: readonly { pos: Vec3; state: BlockState }[] } | null): void {
    this.linePreview = preview
  }
  revealLayer(y: number): void {
    this.revealed.push(y)
  }
  orient(bp: Blueprint, pos: Vec3, s: BlockState, from: Direction | null): BlockState {
    return registry.orientForPlacement(bp, pos, s, from)
  }
  placementProblem(bp: Blueprint, pos: Vec3, s: BlockState): string | null {
    return registry.placementProblem(bp, pos, s)
  }
  placementHelper(bp: Blueprint, hit: { pos: Vec3; face: Direction; point: Vec3 }, s: BlockState) {
    return registry.placementHelper(bp, hit, s)
  }
  stateProblem(s: BlockState): string | null {
    return registry.completeState(s).problem
  }
}

const registry = createBuiltinRegistry()

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
  it('空きマスはそのマス、面のあるブロックは面の隣、Shift なら置き換え', () => {
    expect(placeCell({ pos: [1, 0, 2], empty: true }, NO_SHIFT)).toEqual({ pos: [1, 0, 2], replace: false })
    expect(placeCell(hit([1, 0, 1], 'up'), NO_SHIFT)).toEqual({ pos: [1, 1, 1], replace: false })
    expect(placeCell(hit([1, 0, 1], 'north'), NO_SHIFT)).toEqual({ pos: [1, 0, 0], replace: false })
    expect(placeCell(hit([1, 0, 1], 'east'), NO_SHIFT)).toEqual({ pos: [2, 0, 1], replace: false })
    expect(placeCell(hit([1, 0, 1], 'up'), SHIFT)).toEqual({ pos: [1, 0, 1], replace: true })
    // 2D の埋まったマス：Shift のときだけ置き換え（3D とそろえる。#164）
    expect(placeCell({ pos: [1, 0, 1], empty: false }, NO_SHIFT)).toEqual({ pos: [1, 0, 1], replace: false })
    expect(placeCell({ pos: [1, 0, 1], empty: false }, SHIFT)).toEqual({ pos: [1, 0, 1], replace: true })
  })
})

describe('PlaceTool（2D）', () => {
  it('埋まったマスはクリックでは置き換えず、Shift+クリックで置き換える（#164）', () => {
    const bp = sample()
    const ctx = new FakeContext(bp)
    ctx.brushState = state('minecraft:glass')
    const tool = new PlaceTool(ctx)
    tool.onClick({ pos: [0, 0, 0], empty: false }, NO_SHIFT)
    expect(ctx.message).toBe(OCCUPIED_MESSAGE)
    expect(bp.get([0, 0, 0])?.key).toBe('minecraft:stone')
    expect(ctx.history.count).toBe(0)

    tool.onClick({ pos: [0, 0, 0], empty: false }, SHIFT)
    expect(bp.get([0, 0, 0])?.key).toBe('minecraft:glass')
    expect(ctx.history.count).toBe(1)
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

  it('Shift+クリックは置き換える', () => {
    const bp = sample()
    const ctx = new FakeContext(bp)
    ctx.brushState = state('minecraft:glass')
    const tool = new PlaceTool(ctx)
    tool.onClick(hit([1, 0, 1], 'up'), SHIFT)
    expect(bp.get([1, 0, 1])?.key).toBe('minecraft:glass')
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

describe('PlaceTool：足りない状態（#149）', () => {
  it('回転軸が決まらないブロックは置いたうえで、計算から外れることを知らせる', () => {
    const bp = sample()
    const ctx = new FakeContext(bp)
    ctx.brushState = state('create:shaft', { axis: 'w' })
    const tool = new PlaceTool(ctx)
    tool.onClick({ pos: [2, 0, 2], empty: true }, { shift: false, alt: true })
    expect(bp.get([2, 0, 2])?.key).toBe('create:shaft[axis=w]')
    expect(ctx.message).toContain('計算から外れます')

    ctx.brushState = state('create:shaft', { axis: 'x' })
    tool.onClick({ pos: [0, 0, 2], empty: true }, { shift: false, alt: true })
    expect(ctx.message).toBeNull()
  })
})

describe('PlaceTool：隣とつながる向き（#119）', () => {
  it('シャフトの端の面に置くと、置くブロックの欄の向きによらず同じ軸になる。Alt なら欄の向きのまま', () => {
    const bp = blueprintFixture({ size: [3, 1, 1] }).place([0, 0, 0], 'create:shaft', { axis: 'x' }).toBlueprint()
    const ctx = new FakeContext(bp)
    ctx.brushState = state('create:shaft', { axis: 'y' })
    const tool = new PlaceTool(ctx)
    // [0,0,0] の東の面をクリックして [1,0,0] に置く
    tool.onClick({ pos: [0, 0, 0], face: 'east', empty: false } as PickTarget, NO_SHIFT)
    expect(bp.get([1, 0, 0])?.key).toBe('create:shaft[axis=x]')
    tool.onClick({ pos: [1, 0, 0], face: 'east', empty: false } as PickTarget, { shift: false, alt: true })
    expect(bp.get([2, 0, 0])?.key).toBe('create:shaft[axis=y]')
  })
})

describe('PlaceTool：設置の規則（#121）', () => {
  it('大きい歯車の横には歯車を置かず、理由を出す。見本は赤くする。斜めには置ける', () => {
    const bp = blueprintFixture({ size: [3, 3, 1] }).place([0, 0, 0], 'create:large_cogwheel', { axis: 'z' }).toBlueprint()
    const ctx = new FakeContext(bp)
    ctx.brushState = state('create:cogwheel', { axis: 'z' })
    const tool = new PlaceTool(ctx)
    // 東の隣（軸に垂直）
    const east = { pos: [1, 0, 0], empty: true } as PickTarget
    tool.onHover(east)
    expect(ctx.ghost).toEqual([1, 0, 0])
    expect(ctx.ghostBlocked).toBe(true)
    tool.onClick(east, { shift: false, alt: true })
    expect(bp.get([1, 0, 0])).toBeNull()
    expect(ctx.message).toContain('大きい歯車の横には歯車を置けません')
    // 斜め
    const diagonal = { pos: [1, 1, 0], empty: true } as PickTarget
    tool.onHover(diagonal)
    expect(ctx.ghostBlocked).toBe(false)
    tool.onClick(diagonal, NO_SHIFT)
    expect(bp.get([1, 1, 0])?.key).toBe('create:cogwheel[axis=z]')
  })
})

describe('PlaceTool：置き方の補助（#123）', () => {
  it('小さい歯車で大きい歯車の面をクリックすると、噛み合う斜めに置く。見本もそこに出す。Alt なら補助を使わない', () => {
    const bp = blueprintFixture({ size: [4, 1, 4] }).place([1, 0, 1], 'create:large_cogwheel', { axis: 'y' }).toBlueprint()
    const ctx = new FakeContext(bp)
    ctx.brushState = state('create:cogwheel', { axis: 'x' })
    const tool = new PlaceTool(ctx)
    // 上の面の、東南寄りの所をクリック
    const target = { pos: [1, 0, 1], face: 'up', point: [1.9, 1, 1.7], empty: false } as PickTarget
    tool.onHover(target)
    expect(ctx.ghost).toEqual([2, 0, 2])
    expect(ctx.ghostBlocked).toBe(false)
    tool.onClick(target, NO_SHIFT)
    expect(bp.get([2, 0, 2])?.key).toBe('create:cogwheel[axis=y]')
    // Alt：補助を使わず面の隣（上）に、欄の向きのまま
    tool.onClick(target, { shift: false, alt: true })
    expect(bp.get([1, 1, 1])).toBeNull()
  })
})

describe('一直線に置く（#161）', () => {
  it('lineCells：差が一番大きい軸に沿って、始点から終点の位置まで', () => {
    expect(lineCells([1, 0, 1], [4, 0, 2])).toEqual({ cells: [[1, 0, 1], [2, 0, 1], [3, 0, 1], [4, 0, 1]], axis: 'x' })
    expect(lineCells([2, 0, 3], [2, 0, 1])).toEqual({ cells: [[2, 0, 3], [2, 0, 2], [2, 0, 1]], axis: 'z' })
    expect(lineCells([0, 0, 0], [0, 2, 1])).toEqual({ cells: [[0, 0, 0], [0, 1, 0], [0, 2, 0]], axis: 'y' })
    expect(lineCells([1, 1, 1], [1, 1, 1])).toEqual({ cells: [[1, 1, 1]], axis: null })
  })

  it('alignAxis：axis を持つブロックだけ、線の向きにそろえる', () => {
    expect(alignAxis(state('create:shaft', { axis: 'y' }), 'z').properties).toEqual({ axis: 'z' })
    expect(alignAxis(state('minecraft:stone'), 'z').properties).toEqual({})
    const fan = state('create:encased_fan', { facing: 'north' })
    expect(alignAxis(fan, 'x')).toBe(fan)
  })

  it('10マスのシャフトを1回のドラッグで置き、軸を引いた向きにする。元に戻すと全部消える', () => {
    const bp = blueprintFixture({ size: [12, 2, 3] }).toBlueprint()
    const before = blueprintContents(bp)
    const ctx = new FakeContext(bp)
    ctx.brushState = state('create:shaft', { axis: 'y' })
    const tool = new PlaceTool(ctx)
    expect(tool.dragStart({ pos: [1, 0, 1], empty: true })).toBe(true)
    tool.dragMove({ pos: [6, 0, 1], empty: true })
    // ドラッグ中は見本だけで、設計図は変えない
    expect(ctx.linePreview?.cells.length).toBe(6)
    expect(ctx.history.count).toBe(0)
    tool.dragEnd({ pos: [10, 0, 2], empty: true })
    expect(ctx.linePreview).toBeNull()
    expect(ctx.history.count).toBe(1)
    for (let x = 1; x <= 10; x++) expect(bp.get([x, 0, 1])?.key).toBe('create:shaft[axis=x]')
    expect(bp.get([0, 0, 1])).toBeNull()
    expect(bp.get([10, 0, 2])).toBeNull()

    ctx.history.undo()
    expect(blueprintContents(bp)).toEqual(before)
    ctx.history.redo()
    expect(bp.get([5, 0, 1])?.key).toBe('create:shaft[axis=x]')
  })

  it('3D：面を押して引くと、面の隣から線を引く。z の向きならシャフトの軸は z', () => {
    const bp = sample()
    const ctx = new FakeContext(bp)
    ctx.brushState = state('create:shaft', { axis: 'x' })
    const tool = new PlaceTool(ctx)
    // [1,0,1] のシャフトの南の面を押して、[1,0,2] の南の面まで。始点は [1,0,2]、終点 [1,0,3] は範囲の外なので飛ばす
    expect(tool.dragStart(hit([1, 0, 1], 'south'))).toBe(true)
    tool.dragEnd(hit([1, 0, 2], 'south'))
    expect(bp.get([1, 0, 2])?.key).toBe('create:shaft[axis=z]')
    expect(ctx.message).toBe(lineSkippedMessage(1))
  })

  it('埋まったマスは飛ばして知らせる。置けるマスがなければ置かない。置くブロックがなければ受け取らない', () => {
    const bp = sample()
    const ctx = new FakeContext(bp)
    const tool = new PlaceTool(ctx)
    expect(tool.dragStart({ pos: [0, 0, 1], empty: true })).toBe(false)
    expect(ctx.message).toBe(NO_BRUSH_MESSAGE)

    ctx.brushState = state('minecraft:glass')
    expect(tool.dragStart({ pos: [0, 0, 1], empty: true })).toBe(true)
    tool.dragEnd({ pos: [2, 0, 1], empty: true })
    expect(bp.get([0, 0, 1])?.key).toBe('minecraft:glass')
    expect(bp.get([1, 0, 1])?.key).toBe('create:shaft[axis=y]')
    expect(bp.get([2, 0, 1])?.key).toBe('minecraft:glass')
    expect(ctx.message).toBe(lineSkippedMessage(1))

    expect(tool.dragStart({ pos: [0, 0, 1], empty: false })).toBe(true)
    tool.dragEnd({ pos: [2, 0, 1], empty: false })
    expect(ctx.message).toBe(LINE_NOTHING_MESSAGE)
    expect(ctx.history.count).toBe(1)
  })

  it('ドラッグをやめると見本を消し、何も置かない', () => {
    const bp = sample()
    const ctx = new FakeContext(bp)
    ctx.brushState = state('minecraft:glass')
    const tool = new PlaceTool(ctx)
    tool.dragStart({ pos: [0, 0, 1], empty: true })
    tool.dragMove({ pos: [0, 0, 2], empty: true })
    expect(ctx.linePreview).not.toBeNull()
    tool.dragCancel()
    expect(ctx.linePreview).toBeNull()
    expect(ctx.history.count).toBe(0)
  })
})
