import { describe, expect, it } from 'vitest'
import type { Vec3 } from '../domain/vec3'
import { blueprintFixture } from '../../tests/fixtures/blueprintFixture'
import { countLayers, floodSameState } from './floodSameState'

function sorted(list: readonly Vec3[]): string[] {
  return list.map((p) => p.join(',')).sort()
}

describe('floodSameState', () => {
  it('面で隣り合う同じブロック状態のブロックを集める。先頭は始めのブロック', () => {
    const bp = blueprintFixture({ size: [5, 2, 3] })
      .fill([0, 0, 0], [2, 0, 0], 'create:shaft', { axis: 'x' })
      .place([2, 1, 0], 'create:shaft', { axis: 'x' })
      .toBlueprint()
    const group = floodSameState(bp, [1, 0, 0])
    expect(group[0]).toEqual([1, 0, 0])
    expect(sorted(group)).toEqual(['0,0,0', '1,0,0', '2,0,0', '2,1,0'])
    expect(countLayers(group)).toBe(2)
  })

  it('properties が違うブロックはたどらない', () => {
    const bp = blueprintFixture({ size: [4, 1, 1] })
      .place([0, 0, 0], 'create:shaft', { axis: 'x' })
      .place([1, 0, 0], 'create:shaft', { axis: 'x' })
      .place([2, 0, 0], 'create:shaft', { axis: 'z' })
      .place([3, 0, 0], 'create:shaft', { axis: 'x' })
      .toBlueprint()
    expect(sorted(floodSameState(bp, [0, 0, 0]))).toEqual(['0,0,0', '1,0,0'])
    expect(sorted(floodSameState(bp, [2, 0, 0]))).toEqual(['2,0,0'])
  })

  it('角や辺だけで接するブロックはたどらない', () => {
    const bp = blueprintFixture({ size: [3, 2, 3] })
      .place([0, 0, 0], 'minecraft:stone')
      .place([1, 0, 1], 'minecraft:stone') // 辺で接する（斜め）
      .place([1, 1, 0], 'minecraft:stone') // 辺で接する（斜め上）
      .place([2, 1, 2], 'minecraft:stone') // 角で接する
      .toBlueprint()
    expect(sorted(floodSameState(bp, [0, 0, 0]))).toEqual(['0,0,0'])
  })

  it('空気を挟むとつながらない。ほかのブロックで囲まれた部分は含まない', () => {
    const bp = blueprintFixture({ size: [5, 1, 1] })
      .place([0, 0, 0], 'minecraft:stone')
      .place([1, 0, 0], 'minecraft:stone')
      .place([3, 0, 0], 'minecraft:stone')
      .place([4, 0, 0], 'minecraft:dirt')
      .toBlueprint()
    expect(sorted(floodSameState(bp, [1, 0, 0]))).toEqual(['0,0,0', '1,0,0'])
  })

  it('始めが空気・範囲外なら空', () => {
    const bp = blueprintFixture({ size: [2, 1, 1] }).place([0, 0, 0], 'minecraft:stone').toBlueprint()
    expect(floodSameState(bp, [1, 0, 0])).toEqual([])
    expect(floodSameState(bp, [5, 0, 0])).toEqual([])
    expect(floodSameState(bp, [-1, 0, 0])).toEqual([])
  })

  it('大きなまとまりでも1つずつだけ数える', () => {
    const bp = blueprintFixture({ size: [6, 4, 5] }).fill([0, 0, 0], [5, 3, 4], 'minecraft:stone').toBlueprint()
    const group = floodSameState(bp, [3, 2, 1])
    expect(group).toHaveLength(6 * 4 * 5)
    expect(new Set(sorted(group)).size).toBe(6 * 4 * 5)
    expect(countLayers(group)).toBe(4)
  })
})
