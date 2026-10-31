import { describe, expect, it } from 'vitest'
import { edgeCursor2D, growToward, hitEdge2D, moveFaces, rangeSizeLabel } from './rangeHandles'

const BOX = { min: [1, 0, 2], max: [2, 1, 4] } as const
const SIZE = [5, 3, 6] as const

describe('範囲を広げる・縮める（#200・#205）', () => {
  it('2D の長方形の辺と角に当たる。辺から離れていれば当たらない', () => {
    const layout = { originX: 0, originY: 0, cellSize: 10 }
    // 長方形は x 10〜30、z 20〜50
    expect(hitEdge2D(31, 35, layout, BOX)).toEqual([{ axis: 0, side: 'max' }])
    expect(hitEdge2D(20, 18, layout, BOX)).toEqual([{ axis: 2, side: 'min' }])
    const corner = hitEdge2D(29, 52, layout, BOX)
    expect(corner).toEqual([
      { axis: 0, side: 'max' },
      { axis: 2, side: 'max' },
    ])
    expect(edgeCursor2D(corner!)).toBe('nwse-resize')
    expect(edgeCursor2D([{ axis: 2, side: 'min' }])).toBe('ns-resize')
    expect(hitEdge2D(20, 35, layout, BOX)).toBeNull()
    expect(hitEdge2D(45, 35, layout, BOX)).toBeNull()
  })

  it('面をいちばん近いマスの境目へ動かす。設計図の中に収め、1マスは残す', () => {
    expect(moveFaces(BOX, [{ axis: 0, side: 'max' }], () => 4.4, SIZE)).toEqual({ min: [1, 0, 2], max: [3, 1, 4] })
    expect(moveFaces(BOX, [{ axis: 0, side: 'max' }], () => 99, SIZE).max[0]).toBe(4)
    expect(moveFaces(BOX, [{ axis: 0, side: 'max' }], () => -5, SIZE).max[0]).toBe(1)
    expect(moveFaces(BOX, [{ axis: 1, side: 'min' }], () => -3, SIZE).min[1]).toBe(0)
    expect(moveFaces(BOX, [{ axis: 2, side: 'min' }], () => 9, SIZE).min[2]).toBe(4)
    expect(rangeSizeLabel(BOX)).toBe('範囲 2 × 2 × 3')
  })

  it('矢印の向きの面を1マス広げる・縮める。設計図の端と 1 マスで止まる', () => {
    expect(growToward(BOX, [1, 0, 0], false, SIZE)).toEqual({ min: [1, 0, 2], max: [3, 1, 4] })
    expect(growToward(BOX, [0, 0, -1], false, SIZE)).toEqual({ min: [1, 0, 1], max: [2, 1, 4] })
    expect(growToward(BOX, [1, 0, 0], true, SIZE)).toEqual({ min: [1, 0, 2], max: [1, 1, 4] })
    expect(growToward(BOX, [0, 0, -1], true, SIZE)).toEqual({ min: [1, 0, 3], max: [2, 1, 4] })
    // 端・1マス
    const edge = { min: [0, 0, 0], max: [0, 0, 5] } as const
    expect(growToward(edge, [-1, 0, 0], false, SIZE)).toEqual(edge)
    expect(growToward(edge, [1, 0, 0], true, SIZE)).toEqual(edge)
  })
})
