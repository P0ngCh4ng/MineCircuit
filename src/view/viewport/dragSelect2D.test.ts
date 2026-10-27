import { describe, expect, it } from 'vitest'
import { clampedCell2D, dragSelectionBox, insideGrid2D, isDrag2D } from './dragSelect2D'

const grid = { originX: 100, originY: 50, cellSize: 10 }
const size = [4, 3, 5] as const

describe('clampedCell2D', () => {
  it('位置をマスに直す。マス目の外なら端のマスにする', () => {
    expect(clampedCell2D(125, 75, grid, size)).toEqual([2, 2])
    expect(clampedCell2D(0, 0, grid, size)).toEqual([0, 0])
    expect(clampedCell2D(1000, 1000, grid, size)).toEqual([3, 4])
  })
})

describe('insideGrid2D', () => {
  it('マス目の中かどうか', () => {
    expect(insideGrid2D(100, 50, grid, size)).toBe(true)
    expect(insideGrid2D(139.9, 99.9, grid, size)).toBe(true)
    expect(insideGrid2D(140, 60, grid, size)).toBe(false)
    expect(insideGrid2D(99, 60, grid, size)).toBe(false)
  })
})

describe('isDrag2D', () => {
  it('別のマスへ動いたときだけドラッグにする', () => {
    expect(isDrag2D([1, 1], [1, 1])).toBe(false)
    expect(isDrag2D([1, 1], [2, 1])).toBe(true)
    expect(isDrag2D([1, 1], [1, 0])).toBe(true)
  })
})

describe('dragSelectionBox', () => {
  it('今の段の長方形にする。角の順は問わない', () => {
    expect(dragSelectionBox([3, 0], [1, 2], 1)).toEqual({ min: [1, 1, 0], max: [3, 1, 2] })
  })

  it('起点の段を渡すと（Shift+ドラッグ）、その段から今の段までの高さにする', () => {
    expect(dragSelectionBox([0, 0], [2, 2], 1, 3)).toEqual({ min: [0, 1, 0], max: [2, 3, 2] })
    expect(dragSelectionBox([0, 0], [2, 2], 2, 0)).toEqual({ min: [0, 0, 0], max: [2, 2, 2] })
  })
})
