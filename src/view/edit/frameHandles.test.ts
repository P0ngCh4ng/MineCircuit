import { describe, expect, it } from 'vitest'
import {
  frameGrow,
  frameHandleCenter3D,
  frameHandlePoint2D,
  frameSizeLabel,
  grownFrameBox,
  hitFrameHandle2D,
  hitFrameHandle3D,
  isNoGrow,
} from './frameHandles'

const SIZE = [11, 1, 4] as const

describe('設計図の枠の取っ手（#201）', () => {
  it('3D の取っ手は枠の面の外側。レイが当たる取っ手', () => {
    expect(frameHandleCenter3D(SIZE, { axis: 0, side: 'max' })).toEqual([12.2, 0.5, 2])
    expect(frameHandleCenter3D(SIZE, { axis: 2, side: 'min' })).toEqual([5.5, 0.5, -1.2])
    expect(hitFrameHandle3D({ origin: [12.2, 10, 2], direction: [0, -1, 0] }, SIZE)).toEqual({ axis: 0, side: 'max' })
    expect(hitFrameHandle3D({ origin: [5.5, 10, 2], direction: [0, -1, 0] }, SIZE)).toEqual({ axis: 1, side: 'max' })
    expect(hitFrameHandle3D({ origin: [3, 10, 3], direction: [0, -1, 0] }, SIZE)).toBeNull()
  })

  it('2D の取っ手はマス目の辺の真ん中の外側', () => {
    const layout = { originX: 100, originY: 50, cellSize: 10 }
    expect(frameHandlePoint2D(SIZE, layout, { axis: 0, side: 'max' })).toEqual([226, 70])
    expect(frameHandlePoint2D(SIZE, layout, { axis: 2, side: 'min' })).toEqual([155, 34])
    expect(hitFrameHandle2D(224, 72, layout, SIZE)).toEqual({ axis: 0, side: 'max' })
    expect(hitFrameHandle2D(210, 70, layout, SIZE)).toBeNull()
  })

  it('面を動かす先の境目から、足すマス数を出す。各辺は 1〜512', () => {
    expect(frameGrow(SIZE, { axis: 0, side: 'max' }, 13.4)).toEqual({ min: [0, 0, 0], max: [2, 0, 0] })
    expect(frameGrow(SIZE, { axis: 2, side: 'min' }, -2.2)).toEqual({ min: [0, 0, 2], max: [0, 0, 0] })
    expect(frameGrow(SIZE, { axis: 2, side: 'min' }, 99)).toEqual({ min: [0, 0, -3], max: [0, 0, 0] })
    expect(frameGrow(SIZE, { axis: 0, side: 'max' }, 9999).max[0]).toBe(501)
    expect(isNoGrow(frameGrow(SIZE, { axis: 1, side: 'max' }, 1.2))).toBe(true)
  })

  it('変えたあとの枠と、状態表示の文', () => {
    const grow = { min: [0, 0, 1], max: [2, 0, 0] } as const
    expect(grownFrameBox(SIZE, grow)).toEqual({ min: [0, 0, -1], max: [12, 0, 3] })
    expect(frameSizeLabel(SIZE, grow, 0)).toBe('11 × 1 × 4 → 13 × 1 × 5')
    expect(frameSizeLabel(SIZE, { min: [0, 0, 0], max: [-2, 0, 0] }, 3)).toBe('11 × 1 × 4 → 9 × 1 × 4。ブロック 3 個が消えます')
  })
})
