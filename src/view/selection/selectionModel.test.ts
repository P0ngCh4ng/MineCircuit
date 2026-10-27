import { describe, expect, it } from 'vitest'
import { blueprintFixture, state } from '../../../tests/fixtures/blueprintFixture'
import { BlockVolume } from '../../domain/blockVolume'
import { Blueprint } from '../../domain/blueprint'
import { displayCoordinate, editBoxCoordinate, selectionStats } from './selectionModel'

function sample() {
  return blueprintFixture({ size: [4, 2, 2] })
    .place([0, 0, 0], 'minecraft:stone')
    .place([1, 0, 0], 'minecraft:stone')
    .place([2, 0, 0], 'create:shaft', { axis: 'x' })
    .place([3, 0, 0], 'create:shaft', { axis: 'z' })
    .place([0, 1, 0], 'create:shaft', { axis: 'x' })
    .place([0, 0, 1], 'minecraft:dirt')
    .toBlueprint()
}

describe('selectionStats', () => {
  it('ブロックの数、種類（ID）ごとの数、状態ごとの数を多い順に出す', () => {
    const stats = selectionStats(sample(), { min: [0, 0, 0], max: [3, 1, 1] })
    expect(stats.blockCount).toBe(6)
    expect(stats.kinds).toEqual([
      { id: 'create:shaft', count: 3 },
      { id: 'minecraft:stone', count: 2 },
      { id: 'minecraft:dirt', count: 1 },
    ])
    expect(stats.states.map((s) => [s.state.key, s.count])).toEqual([
      ['create:shaft[axis=x]', 2],
      ['minecraft:stone', 2],
      ['create:shaft[axis=z]', 1],
      ['minecraft:dirt', 1],
    ])
  })

  it('範囲の中だけを数え、設計図からはみ出す分は切り詰める', () => {
    const bp = sample()
    expect(selectionStats(bp, { min: [1, 0, 0], max: [2, 0, 0] }).blockCount).toBe(2)
    expect(selectionStats(bp, { min: [-5, -5, -5], max: [100, 100, 100] }).blockCount).toBe(6)
    expect(selectionStats(bp, { min: [10, 0, 0], max: [12, 0, 0] })).toEqual({ blockCount: 0, kinds: [], states: [] })
  })

  it('リージョンが重なる位置は先のリージョンだけを数える', () => {
    const stone = state('minecraft:stone')
    const dirt = state('minecraft:dirt')
    const a = new BlockVolume({ name: 'a', size: [2, 1, 1], palette: [stone], cells: new Int32Array([0, 0]) })
    const b = new BlockVolume({ name: 'b', offset: [1, 0, 0], size: [2, 1, 1], palette: [dirt], cells: new Int32Array([0, 0]) })
    const bp = new Blueprint('two.litematic', 'litematic', 2975, [a, b])
    const stats = selectionStats(bp, { min: [0, 0, 0], max: [2, 0, 0] })
    expect(stats.blockCount).toBe(3)
    expect(stats.kinds).toEqual([
      { id: 'minecraft:stone', count: 2 },
      { id: 'minecraft:dirt', count: 1 },
    ])
  })
})

describe('座標の欄', () => {
  const box = { min: [1, 0, 1], max: [3, 2, 3] } as const
  const size = [5, 5, 5] as const

  it('段（y）は1始まりで出し、打った段を y に直す', () => {
    expect(displayCoordinate(box.min, 1)).toBe(1)
    expect(displayCoordinate(box.max, 0)).toBe(3)
    expect(editBoxCoordinate(box, 'max', 1, 4, [...size])).toEqual({ min: [1, 0, 1], max: [3, 3, 3] })
  })

  it('最小が最大を越えたら入れ替え、設計図の大きさに切り詰める', () => {
    expect(editBoxCoordinate(box, 'min', 0, 4, [...size])).toEqual({ min: [3, 0, 1], max: [4, 2, 3] })
    expect(editBoxCoordinate(box, 'max', 2, 99, [...size])).toEqual({ min: [1, 0, 1], max: [3, 2, 4] })
  })

  it('数でないときと、設計図と重ならないときは null', () => {
    expect(editBoxCoordinate(box, 'min', 0, Number.NaN, [...size])).toBeNull()
    expect(editBoxCoordinate({ min: [6, 0, 0], max: [6, 0, 0] }, 'max', 0, 9, [...size])).toBeNull()
  })
})
