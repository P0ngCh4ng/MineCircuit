import { describe, expect, it } from 'vitest'
import { blueprintContents, blueprintFixture } from '../../tests/fixtures/blueprintFixture'
import { nbt } from '../domain/nbt'
import { setBlockProperty } from './editCommand'
import { EditHistory } from './editHistory'

function setup() {
  const blockEntity = nbt.compound({ id: nbt.string('create:gearbox'), Speed: nbt.float(16) })
  const bp = blueprintFixture({ size: [3, 1, 1] })
    .place([0, 0, 0], 'create:shaft', { axis: 'x', waterlogged: 'false' }, blockEntity)
    .place([1, 0, 0], 'minecraft:stone')
    .toBlueprint()
  return { bp, blockEntity }
}

describe('setBlockProperty（ブロック状態の項目を直す操作。#165）', () => {
  it('項目を直し、生データとほかの項目は残す。元に戻すと完全に元の状態、やり直しも同じ', () => {
    const { bp, blockEntity } = setup()
    const original = blueprintContents(bp)
    const history = new EditHistory(bp)
    const cmd = setBlockProperty(bp, [0, 0, 0], 'axis', 'y')
    expect(cmd?.label).toBe('shaft の axis を y にする')
    history.apply(cmd!)
    expect(bp.get([0, 0, 0])?.key).toBe('create:shaft[axis=y,waterlogged=false]')
    expect(bp.blockEntityAt([0, 0, 0])).toEqual(blockEntity)
    const changed = blueprintContents(bp)

    history.undo()
    expect(blueprintContents(bp)).toEqual(original)
    history.redo()
    expect(blueprintContents(bp)).toEqual(changed)
  })

  it('項目がなければ足す', () => {
    const { bp } = setup()
    const cmd = setBlockProperty(bp, [1, 0, 0], 'snowy', 'true')
    expect(cmd?.changes[0]?.after.state?.key).toBe('minecraft:stone[snowy=true]')
  })

  it('同じ値・空の値・空き・範囲の外では操作を作らない', () => {
    const { bp } = setup()
    expect(setBlockProperty(bp, [0, 0, 0], 'axis', 'x')).toBeNull()
    expect(setBlockProperty(bp, [0, 0, 0], 'axis', '')).toBeNull()
    expect(setBlockProperty(bp, [0, 0, 0], '', 'y')).toBeNull()
    expect(setBlockProperty(bp, [2, 0, 0], 'axis', 'y')).toBeNull()
    expect(setBlockProperty(bp, [9, 0, 0], 'axis', 'y')).toBeNull()
  })
})
