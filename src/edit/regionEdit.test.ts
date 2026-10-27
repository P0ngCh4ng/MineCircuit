import { describe, expect, it } from 'vitest'
import { blueprintContents, blueprintFixture, state } from '../../tests/fixtures/blueprintFixture'
import { BlockVolume } from '../domain/blockVolume'
import { Blueprint } from '../domain/blueprint'
import { boxFromCorners, singleCellBox } from '../domain/box'
import { nbt } from '../domain/nbt'
import type { Vec3 } from '../domain/vec3'
import type { EditCommand } from './editCommand'
import { EditHistory } from './editHistory'
import { eraseRegion, fillRegion, replaceInRegion } from './regionEdit'

const motorNbt = () => nbt.compound({ id: nbt.string('create:creative_motor'), Speed: nbt.int(64) })

// 3×2×3。下の段に shaft・motor（生データ付き）・stone、上の段は空き
function sample() {
  return blueprintFixture({ size: [3, 2, 3] })
    .place([0, 0, 0], 'create:shaft[axis=x]')
    .place([1, 0, 0], 'create:shaft[axis=z]')
    .place([2, 0, 0], 'create:creative_motor[facing=up]', motorNbt())
    .place([0, 0, 1], 'minecraft:stone')
    .toBlueprint()
}

/** 操作を当てて、元に戻す・やり直すで中身がそろうかを確かめる */
function checkUndoRedo(bp: Blueprint, make: (bp: Blueprint) => EditCommand | null): Blueprint {
  const original = blueprintContents(bp)
  const cmd = make(bp)
  expect(cmd).not.toBeNull()
  const history = new EditHistory(bp)
  history.apply(cmd!)
  const edited = blueprintContents(bp)
  expect(edited).not.toEqual(original)
  history.undo()
  expect(blueprintContents(bp)).toEqual(original)
  history.redo()
  expect(blueprintContents(bp)).toEqual(edited)
  return bp
}

describe('eraseRegion', () => {
  it('範囲の中のブロックだけを消す', () => {
    const bp = sample()
    const cmd = eraseRegion(bp, boxFromCorners([0, 0, 0], [1, 1, 0]))!
    expect(cmd.label).toBe('範囲を消す（2 個）')
    expect(cmd.changes.map((c) => c.pos)).toEqual([
      [0, 0, 0],
      [1, 0, 0],
    ])
    for (const c of cmd.changes) expect(c.after).toEqual({ state: null, blockEntity: null })
    new EditHistory(bp).apply(cmd)
    expect(bp.get([0, 0, 0])).toBeNull()
    expect(bp.get([2, 0, 0])?.key).toBe('create:creative_motor[facing=up]')
    expect(bp.get([0, 0, 1])?.key).toBe('minecraft:stone')
  })

  it('消すブロックがなければ null', () => {
    const bp = sample()
    expect(eraseRegion(bp, boxFromCorners([0, 1, 0], [2, 1, 2]))).toBeNull()
  })

  it('元に戻すと状態と生データが元どおり。やり直しも同じ', () => {
    const bp = checkUndoRedo(sample(), (b) => eraseRegion(b, boxFromCorners([0, 0, 0], [2, 1, 2])))
    expect(bp.blockEntityAt([2, 0, 0])).toBeNull()
  })

  it('設計図からはみ出す箱は、重なる部分だけを使う', () => {
    const bp = sample()
    const cmd = eraseRegion(bp, boxFromCorners([-5, -5, -5], [0, 10, 0]))!
    expect(cmd.changes.map((c) => c.pos)).toEqual([[0, 0, 0]])
    expect(eraseRegion(bp, boxFromCorners([5, 0, 0], [8, 1, 1]))).toBeNull()
  })
})

describe('fillRegion', () => {
  it('空きだけを塗る', () => {
    const bp = sample()
    const cmd = fillRegion(bp, boxFromCorners([0, 0, 0], [2, 0, 1]), state('minecraft:stone'), true)!
    expect(cmd.label).toBe('stone で塗る（2 個）')
    expect(cmd.changes.map((c) => c.pos)).toEqual([
      [1, 0, 1],
      [2, 0, 1],
    ])
    for (const c of cmd.changes) expect(c.after.blockEntity).toBeNull()
  })

  it('空きだけでなければ、ほかのブロックも塗り、生データは消える。同じ状態で生データのないマスは飛ばす', () => {
    const bp = sample()
    const cmd = fillRegion(bp, boxFromCorners([0, 0, 0], [2, 0, 1]), state('minecraft:stone'), false)!
    expect(cmd.label).toBe('stone で塗る（5 個）')
    expect(cmd.changes.some((c) => c.pos.join() === '0,0,1')).toBe(false)
    new EditHistory(bp).apply(cmd)
    expect(bp.get([2, 0, 0])?.key).toBe('minecraft:stone')
    expect(bp.blockEntityAt([2, 0, 0])).toBeNull()
  })

  it('同じ状態でも生データがあれば塗り直す', () => {
    const bp = blueprintFixture({ size: [1, 1, 1] }).place([0, 0, 0], 'minecraft:chest', nbt.compound()).toBlueprint()
    const cmd = fillRegion(bp, singleCellBox([0, 0, 0]), state('minecraft:chest'), false)!
    expect(cmd.changes).toHaveLength(1)
    expect(cmd.changes[0].after.blockEntity).toBeNull()
  })

  it('変わるマスがなければ null', () => {
    const bp = sample()
    expect(fillRegion(bp, boxFromCorners([0, 0, 0], [1, 0, 0]), state('minecraft:stone'), true)).toBeNull()
    expect(fillRegion(bp, singleCellBox([0, 0, 1]), state('minecraft:stone'), false)).toBeNull()
  })

  it('元に戻すと状態と生データが元どおり。やり直しも同じ', () => {
    checkUndoRedo(sample(), (b) => fillRegion(b, boxFromCorners([0, 0, 0], [2, 1, 2]), state('minecraft:dirt'), false))
  })

  it('設計図からはみ出す箱は、重なる部分だけを塗る', () => {
    const bp = sample()
    const cmd = fillRegion(bp, boxFromCorners([-3, 1, -3], [10, 9, 10]), state('minecraft:glass'), true)!
    expect(cmd.changes).toHaveLength(9)
    for (const c of cmd.changes) expect(c.pos[1]).toBe(1)
  })
})

describe('replaceInRegion', () => {
  it('ID とプロパティが同じものだけを置き換える', () => {
    const bp = sample()
    const cmd = replaceInRegion(bp, boxFromCorners([0, 0, 0], [2, 1, 2]), state('create:shaft[axis=x]'), state('create:cogwheel[axis=y]'), false)!
    expect(cmd.label).toBe('shaft を cogwheel に置き換える（1 個）')
    expect(cmd.changes).toHaveLength(1)
    expect(cmd.changes[0].pos).toEqual([0, 0, 0])
    expect(cmd.changes[0].after.state?.key).toBe('create:cogwheel[axis=y]')
  })

  it('向きを引き継ぐなら、to が持つ向きのプロパティを元の値にする', () => {
    const bp = sample()
    const cmd = replaceInRegion(bp, boxFromCorners([0, 0, 0], [2, 0, 0]), state('create:shaft[axis=z]'), state('create:cogwheel[axis=y]'), true)!
    expect(cmd.changes.map((c) => c.after.state?.key)).toEqual(['create:cogwheel[axis=z]'])
  })

  it('to が持たない向きのプロパティは足さない', () => {
    const bp = blueprintFixture({ size: [1, 1, 1] }).place([0, 0, 0], 'create:creative_motor[facing=up]').toBlueprint()
    const cmd = replaceInRegion(bp, singleCellBox([0, 0, 0]), state('create:creative_motor[facing=up]'), state('minecraft:stone'), true)!
    expect(cmd.changes[0].after.state?.key).toBe('minecraft:stone')
  })

  it('生データは消える', () => {
    const bp = sample()
    const cmd = replaceInRegion(
      bp,
      boxFromCorners([0, 0, 0], [2, 0, 0]),
      state('create:creative_motor[facing=up]'),
      state('create:creative_motor[facing=down]'),
      false,
    )!
    expect(cmd.changes[0].before.blockEntity).not.toBeNull()
    expect(cmd.changes[0].after).toEqual({ state: state('create:creative_motor[facing=down]'), blockEntity: null })
  })

  it('変わるマスがなければ null', () => {
    const bp = sample()
    // from が範囲にない
    expect(replaceInRegion(bp, boxFromCorners([0, 0, 0], [2, 1, 2]), state('create:shaft[axis=y]'), state('minecraft:stone'), false)).toBeNull()
    // 向きを引き継いだ結果が元と同じ
    expect(replaceInRegion(bp, singleCellBox([0, 0, 0]), state('create:shaft[axis=x]'), state('create:shaft[axis=y]'), true)).toBeNull()
  })

  it('元に戻すと状態と生データが元どおり。やり直しも同じ', () => {
    checkUndoRedo(sample(), (b) =>
      replaceInRegion(b, boxFromCorners([0, 0, 0], [2, 1, 2]), state('create:creative_motor[facing=up]'), state('minecraft:stone'), false),
    )
  })
})

describe('リージョンが複数ある設計図', () => {
  const stone = state('minecraft:stone')

  /** 全部 stone のリージョン */
  function solid(name: string, size: Vec3, offset: Vec3): BlockVolume {
    return new BlockVolume({ name, size, offset, palette: [stone], cells: new Int32Array(size[0] * size[1] * size[2]).fill(0) })
  }

  // x = 0..1 と x = 3..4 にリージョン。x = 2 はどのリージョンにもないすき間
  function gapped(): Blueprint {
    return new Blueprint('gap.litematic', 'litematic', 2975, [solid('a', [2, 1, 1], [0, 0, 0]), solid('b', [2, 1, 1], [3, 0, 0])])
  }

  it('すき間の位置は飛ばす', () => {
    const bp = gapped()
    const box = boxFromCorners([0, 0, 0], [4, 0, 0])
    const erase = eraseRegion(bp, box)!
    expect(erase.changes.map((c) => c.pos[0])).toEqual([0, 1, 3, 4])
    const fill = fillRegion(bp, box, state('minecraft:dirt'), false)!
    expect(fill.changes.map((c) => c.pos[0])).toEqual([0, 1, 3, 4])
    const replace = replaceInRegion(bp, box, stone, state('minecraft:dirt'), false)!
    expect(replace.changes.map((c) => c.pos[0])).toEqual([0, 1, 3, 4])
  })

  it('元に戻すと、どのリージョンも元どおり', () => {
    checkUndoRedo(gapped(), (b) => fillRegion(b, boxFromCorners([0, 0, 0], [4, 0, 0]), state('minecraft:dirt'), false))
  })
})
