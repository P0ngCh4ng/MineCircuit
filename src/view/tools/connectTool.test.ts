import { describe, expect, it } from 'vitest'
import { blueprintContents, blueprintFixture } from '../../../tests/fixtures/blueprintFixture'
import type { BlockState } from '../../domain/blockState'
import type { Blueprint } from '../../domain/blueprint'
import type { Vec3 } from '../../domain/vec3'
import type { EditCommand } from '../../edit/editCommand'
import { EditHistory } from '../../edit/editHistory'
import { connectTools } from '../edit/placementRules'
import { ConnectTool } from './connectTool'
import type { EditToolContext } from './editToolContext'
import type { PickTarget } from './tool'

/** 本物の EditHistory に書き込み、知らせと見本を記録する偽物。ベルトのツールが使わないものは何もしない */
function fakeContext(bp: Blueprint) {
  const history = new EditHistory(bp)
  const state = {
    history,
    message: null as string | null,
    preview: null as { cells: readonly { pos: Vec3; state: BlockState }[] } | null,
    revealed: [] as number[],
  }
  const ctx: EditToolContext = {
    blueprint: () => bp,
    apply(cmd: EditCommand | null) {
      if (!cmd) return false
      history.apply(cmd)
      return true
    },
    brush: () => null,
    setBrush: () => {},
    notify: (m) => {
      state.message = m
    },
    setHovered: () => {},
    setGhost: () => {},
    setLinePreview: (p) => {
      state.preview = p
    },
    revealLayer: (y) => {
      state.revealed.push(y)
    },
    orient: (_bp, _pos, s) => s,
    placementProblem: () => null,
    stateProblem: () => null,
    placementHelper: () => null,
  }
  return { ctx, state }
}

const at = (pos: Vec3): PickTarget => ({ pos, empty: false })
const NO_SHIFT = { shift: false }

// 計算プラグインの一覧から取った、Create のベルトのつなぐツール
const BELT = connectTools().find((t) => t.id === 'belt')!
const BELT_PICK_SHAFT_MESSAGE = BELT.messages.pickStart
const BELT_CANCELLED_MESSAGE = BELT.messages.cancelled
const beltFirstMessage = BELT.messages.first
const beltDoneMessage = BELT.messages.done

function sample(): Blueprint {
  return blueprintFixture({ size: [5, 2, 1] })
    .place([0, 0, 0], 'create:shaft', { axis: 'z' })
    .place([3, 0, 0], 'create:shaft', { axis: 'z' })
    .place([4, 0, 0], 'create:shaft', { axis: 'x' })
    .place([0, 1, 0], 'minecraft:stone')
    .toBlueprint()
}

describe('ベルトのツール（#248）', () => {
  it('シャフトを2本クリックするとベルトを敷き、元に戻すと元どおり', () => {
    const bp = sample()
    const before = blueprintContents(bp)
    const { ctx, state } = fakeContext(bp)
    const tool = new ConnectTool(BELT, ctx)
    tool.onClick(at([0, 0, 0]), NO_SHIFT)
    expect(state.message).toBe(beltFirstMessage([0, 0, 0]))
    expect(tool.firstPos).toEqual([0, 0, 0])
    // 2本目を指すと、敷くベルトを見本で出す
    tool.onHover(at([3, 0, 0]))
    expect(state.preview?.cells.map((c) => c.pos)).toEqual([[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0]])
    tool.onClick(at([3, 0, 0]), NO_SHIFT)
    expect(state.message).toBe(beltDoneMessage(4))
    expect(state.preview).toBeNull()
    expect(tool.firstPos).toBeNull()
    expect(bp.get([1, 0, 0])?.key).toBe('create:belt[casing=false,facing=east,part=middle,slope=horizontal,waterlogged=false]')
    expect(state.history.nextUndo?.label).toBe('ベルトをつなぐ（4 区間）')
    state.history.undo()
    expect(blueprintContents(bp)).toEqual(before)
  })

  it('シャフトでないものは選べない。つなげない組み合わせは理由を出し、1本目は残す', () => {
    const { ctx, state } = fakeContext(sample())
    const tool = new ConnectTool(BELT, ctx)
    tool.onClick(at([0, 1, 0]), NO_SHIFT)
    expect(state.message).toBe(BELT_PICK_SHAFT_MESSAGE)
    tool.onClick({ pos: [1, 0, 0], empty: true }, NO_SHIFT)
    expect(state.message).toBe(BELT_PICK_SHAFT_MESSAGE)
    tool.onClick(at([0, 0, 0]), NO_SHIFT)
    tool.onHover(at([4, 0, 0]))
    expect(state.preview?.cells).toEqual([])
    tool.onClick(at([4, 0, 0]), NO_SHIFT)
    expect(state.message).toContain('軸の向きが違います')
    expect(tool.firstPos).toEqual([0, 0, 0])
    expect(state.history.canUndo).toBe(false)
  })

  it('逆向きに回るシャフトどうしはつながない（最後の計算の回転数）', () => {
    const { ctx, state } = fakeContext(sample())
    const tool = new ConnectTool(BELT, ctx, (pos) => (pos[0] === 0 ? 16 : -16))
    tool.onClick(at([0, 0, 0]), NO_SHIFT)
    tool.onClick(at([3, 0, 0]), NO_SHIFT)
    expect(state.message).toContain('逆向き')
    expect(state.history.canUndo).toBe(false)
  })

  it('Shift+クリック・同じシャフト・ツールの切り替えで、1本目の選択をやめる', () => {
    const { ctx, state } = fakeContext(sample())
    const tool = new ConnectTool(BELT, ctx)
    tool.onClick(at([0, 0, 0]), NO_SHIFT)
    tool.onClick(at([3, 0, 0]), { shift: true })
    expect(state.message).toBe(BELT_CANCELLED_MESSAGE)
    expect(tool.firstPos).toBeNull()
    tool.onClick(at([0, 0, 0]), NO_SHIFT)
    tool.onClick(at([0, 0, 0]), NO_SHIFT)
    expect(state.message).toBe(BELT_CANCELLED_MESSAGE)
    expect(tool.firstPos).toBeNull()
    tool.onClick(at([0, 0, 0]), NO_SHIFT)
    tool.deactivate()
    expect(tool.firstPos).toBeNull()
    expect(state.preview).toBeNull()
  })
})
