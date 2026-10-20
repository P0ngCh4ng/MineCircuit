import { describe, expect, it } from 'vitest'
import { measure } from './measure'

describe('measure', () => {
  it('差は b - a、直線距離・軸に沿った距離・囲む範囲を求める', () => {
    const m = measure([1, 2, 3], [4, 0, 7])
    expect(m.a).toEqual([1, 2, 3])
    expect(m.b).toEqual([4, 0, 7])
    expect(m.delta).toEqual([3, -2, 4])
    expect(m.euclidean).toBeCloseTo(Math.sqrt(9 + 4 + 16))
    expect(m.manhattan).toBe(9)
    expect(m.boundingSize).toEqual([4, 3, 5])
  })

  it('同じブロックなら距離は 0、囲む範囲は 1×1×1', () => {
    const m = measure([5, 5, 5], [5, 5, 5])
    expect(m.delta).toEqual([0, 0, 0])
    expect(m.euclidean).toBe(0)
    expect(m.manhattan).toBe(0)
    expect(m.boundingSize).toEqual([1, 1, 1])
  })

  it('1つの軸に沿って並ぶときは、直線距離と軸に沿った距離が同じ', () => {
    const m = measure([0, 0, 0], [0, 0, -6])
    expect(m.delta).toEqual([0, 0, -6])
    expect(m.euclidean).toBe(6)
    expect(m.manhattan).toBe(6)
    expect(m.boundingSize).toEqual([1, 1, 7])
  })

  it('向きを逆にすると差だけ符号が変わる', () => {
    const ab = measure([0, 1, 2], [3, 5, 2])
    const ba = measure([3, 5, 2], [0, 1, 2])
    expect(ba.delta).toEqual([-3, -4, 0])
    expect(ba.euclidean).toBe(ab.euclidean)
    expect(ba.euclidean).toBe(5)
    expect(ba.manhattan).toBe(ab.manhattan)
    expect(ba.boundingSize).toEqual(ab.boundingSize)
  })
})
