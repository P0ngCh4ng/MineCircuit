import { describe, expect, it } from 'vitest'
import { blueprintFixture } from '../../tests/fixtures/blueprintFixture'
import { BlueprintStats } from './blueprintStats'
import { buildChecklist, checklistProgress } from './buildChecklist'

/** 高さ 4。段 1 に石 3 と木 1、段 2 は空、段 3 にシャフト 2（向きが違う）、段 4 に石 1 */
function sample() {
  return blueprintFixture({ size: [3, 4, 2] })
    .fill([0, 0, 0], [2, 0, 0], 'minecraft:stone')
    .place([0, 0, 1], 'minecraft:oak_planks')
    .place([0, 2, 0], 'create:shaft', { axis: 'x' })
    .place([1, 2, 0], 'create:shaft', { axis: 'y' })
    .place([2, 3, 1], 'minecraft:stone')
    .toBlueprint()
}

describe('buildChecklist', () => {
  it('下の段から順に、段ごとの ID と数と合計を出す。空の段も入れ、向きの違いは同じ ID で数える', () => {
    const layers = buildChecklist(new BlueprintStats(sample()), 4)
    expect(layers).toEqual([
      {
        y: 0,
        total: 4,
        items: [
          { id: 'minecraft:stone', count: 3 },
          { id: 'minecraft:oak_planks', count: 1 },
        ],
      },
      { y: 1, total: 0, items: [] },
      { y: 2, total: 2, items: [{ id: 'create:shaft', count: 2 }] },
      { y: 3, total: 1, items: [{ id: 'minecraft:stone', count: 1 }] },
    ])
  })

  it('高さ 0 なら空', () => {
    expect(buildChecklist(new BlueprintStats(sample()), 0)).toEqual([])
  })
})

describe('checklistProgress', () => {
  const layers = buildChecklist(new BlueprintStats(sample()), 4)

  it('何も建てていなければ、ブロックのある段とブロック数だけを数える', () => {
    expect(checklistProgress(layers, new Set())).toEqual({
      layerCount: 3,
      doneLayerCount: 0,
      blockCount: 7,
      doneBlockCount: 0,
    })
  })

  it('建て終えた段の数とブロック数を足す。空の段と範囲外の段のチェックは数えない', () => {
    expect(checklistProgress(layers, new Set([0, 1, 3, 9]))).toEqual({
      layerCount: 3,
      doneLayerCount: 2,
      blockCount: 7,
      doneBlockCount: 5,
    })
  })
})
