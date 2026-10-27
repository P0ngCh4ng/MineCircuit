import { describe, expect, it } from 'vitest'
import type { Vec3 } from './vec3'
import {
  boxContains,
  boxEquals,
  boxFromCorners,
  boxSize,
  boxVolume,
  clampBox,
  forEachInBox,
  isSingleCell,
  singleCellBox,
} from './box'

describe('Box', () => {
  it('2つの角から、順を問わず最小と最大の角を作る', () => {
    expect(boxFromCorners([3, 0, 1], [1, 2, 0])).toEqual({ min: [1, 0, 0], max: [3, 2, 1] })
  })

  it('大きさ・マスの数・1マスか', () => {
    const box = boxFromCorners([0, 0, 0], [2, 1, 0])
    expect(boxSize(box)).toEqual([3, 2, 1])
    expect(boxVolume(box)).toBe(6)
    expect(isSingleCell(box)).toBe(false)
    expect(isSingleCell(singleCellBox([4, 5, 6]))).toBe(true)
  })

  it('両端の角を含む', () => {
    const box = boxFromCorners([0, 0, 0], [1, 1, 1])
    expect(boxContains(box, [1, 1, 1])).toBe(true)
    expect(boxContains(box, [2, 1, 1])).toBe(false)
    expect(boxEquals(box, { min: [0, 0, 0], max: [1, 1, 1] })).toBe(true)
  })

  it('設計図の大きさに収める。重ならなければ null', () => {
    expect(clampBox(boxFromCorners([-2, 0, 1], [5, 1, 1]), [4, 3, 3])).toEqual({ min: [0, 0, 1], max: [3, 1, 1] })
    expect(clampBox(boxFromCorners([5, 0, 0], [6, 0, 0]), [4, 3, 3])).toBeNull()
  })

  it('中のマスを y → z → x の順にたどる', () => {
    const seen: Vec3[] = []
    forEachInBox(boxFromCorners([0, 0, 0], [1, 1, 0]), (p) => seen.push(p))
    expect(seen).toEqual([
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
      [1, 1, 0],
    ])
  })
})
