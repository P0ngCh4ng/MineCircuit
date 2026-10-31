import { describe, expect, it } from 'vitest'
import { faceCenter, handleCenter3D, handleCursor2D, handles2D, hitHandle2D, hitHandle3D, moveFaces, rangeSizeLabel } from './rangeHandles'

const BOX = { min: [1, 0, 2], max: [2, 1, 4] } as const
const SIZE = [5, 3, 6] as const

describe('範囲の取っ手（#200）', () => {
  it('面の真ん中と、外へ離した取っ手の位置', () => {
    expect(faceCenter(BOX, { axis: 0, side: 'max' })).toEqual([3, 1, 3.5])
    expect(faceCenter(BOX, { axis: 1, side: 'min' })).toEqual([2, 0, 3.5])
    expect(handleCenter3D(BOX, { axis: 2, side: 'min' })).toEqual([2, 1, 1.6])
  })

  it('レイが当たるいちばん手前の取っ手', () => {
    // 真上から下へ。範囲の真ん中を通ると上の面の取っ手に当たる（下の面の取っ手より手前）
    expect(hitHandle3D({ origin: [2, 10, 3.5], direction: [0, -1, 0] }, BOX)).toEqual({ axis: 1, side: 'max' })
    // 横から：x の大きい側の取っ手
    expect(hitHandle3D({ origin: [10, 1, 3.5], direction: [-1, 0, 0] }, BOX)).toEqual({ axis: 0, side: 'max' })
    // 外れ
    expect(hitHandle3D({ origin: [0, 10, 0], direction: [0, -1, 0] }, BOX)).toBeNull()
  })

  it('2D の取っ手は角4つと辺の真ん中4つ。近いものに当たる', () => {
    const hs = handles2D(BOX)
    expect(hs).toHaveLength(8)
    const layout = { originX: 0, originY: 0, cellSize: 10 }
    const corner = hitHandle2D(30, 50, layout, BOX)
    expect(corner?.faces).toEqual([
      { axis: 0, side: 'max' },
      { axis: 2, side: 'max' },
    ])
    expect(handleCursor2D(corner!)).toBe('nwse-resize')
    const top = hitHandle2D(20, 21, layout, BOX)
    expect(top?.faces).toEqual([{ axis: 2, side: 'min' }])
    expect(handleCursor2D(top!)).toBe('ns-resize')
    expect(hitHandle2D(20, 35, layout, BOX)).toBeNull()
  })

  it('面をいちばん近いマスの境目へ動かす。設計図の中に収め、1マスは残す', () => {
    expect(moveFaces(BOX, [{ axis: 0, side: 'max' }], () => 4.4, SIZE)).toEqual({ min: [1, 0, 2], max: [3, 1, 4] })
    expect(moveFaces(BOX, [{ axis: 0, side: 'max' }], () => 99, SIZE).max[0]).toBe(4)
    expect(moveFaces(BOX, [{ axis: 0, side: 'max' }], () => -5, SIZE).max[0]).toBe(1)
    expect(moveFaces(BOX, [{ axis: 1, side: 'min' }], () => -3, SIZE).min[1]).toBe(0)
    expect(moveFaces(BOX, [{ axis: 2, side: 'min' }], () => 9, SIZE).min[2]).toBe(4)
    expect(rangeSizeLabel(BOX)).toBe('範囲 2 × 2 × 3')
  })
})
