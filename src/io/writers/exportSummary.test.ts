import { describe, expect, it } from 'vitest'
import { nbt } from '../../domain/nbt'
import { blueprintFixture } from '../../../tests/fixtures/blueprintFixture'
import { exportSummary } from './exportSummary'

const motorNbt = () => nbt.compound({ Speed: nbt.float(64) })

describe('exportSummary', () => {
  const fx = () =>
    blueprintFixture({ size: [5, 1, 1] })
      .place([0, 0, 0], 'create:creative_motor', motorNbt())
      .place([1, 0, 0], 'create:creative_motor')
      .place([2, 0, 0], 'create:creative_motor')
      .place([3, 0, 0], 'create:mechanical_press')
      .place([4, 0, 0], 'minecraft:stone')

  it('同じ ID のブロックが生データを持っていれば、持っていないものを数える', () => {
    expect(exportSummary(fx().toBlueprint())).toEqual({
      blockCount: 5,
      stateCount: 3,
      blockEntityCount: 1,
      missingBlockEntityCount: 2,
      missingBlockEntities: [{ id: 'create:creative_motor', count: 2 }],
    })
  })

  it('hasBlockEntity を渡すと、その ID も数える', () => {
    const summary = exportSummary(fx().toBlueprint(), { hasBlockEntity: (id) => id === 'create:mechanical_press' })
    expect(summary.missingBlockEntityCount).toBe(3)
    expect(summary.missingBlockEntities).toEqual([
      { id: 'create:creative_motor', count: 2 },
      { id: 'create:mechanical_press', count: 1 },
    ])
  })

  it('空気は数えない', () => {
    const summary = exportSummary(blueprintFixture({ size: [1, 1, 1] }).place([0, 0, 0], 'minecraft:air').toBlueprint())
    expect(summary.blockCount).toBe(0)
    expect(summary.stateCount).toBe(0)
  })
})
