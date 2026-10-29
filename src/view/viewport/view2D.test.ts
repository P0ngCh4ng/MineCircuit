import { describe, expect, it } from 'vitest'
import { clampToView, panBy, wheelZoomFactor, ZOOM_MAX_CELL_SIZE, ZOOM_MIN_CELL_SIZE, zoomAt } from './view2D'

describe('wheelZoomFactor', () => {
  it('手前に回すと拡大、奥へ回すと縮小。行やページの単位も px に直す', () => {
    expect(wheelZoomFactor(-100)).toBeCloseTo(1.2)
    expect(wheelZoomFactor(100)).toBeCloseTo(1 / 1.2)
    expect(wheelZoomFactor(0)).toBe(1)
    expect(wheelZoomFactor(-3, 1)).toBeCloseTo(wheelZoomFactor(-99))
    expect(wheelZoomFactor(1, 2)).toBeLessThan(wheelZoomFactor(100))
  })
})

describe('zoomAt', () => {
  const grid = { originX: 100, originY: 50, cellSize: 10 }

  it('マウスの下のマスを動かさずに、マスを大きくする', () => {
    // マス (5, 3) の真ん中
    const px = 100 + 5.5 * 10
    const py = 50 + 3.5 * 10
    const next = zoomAt(grid, px, py, 2)
    expect(next.cellSize).toBe(20)
    expect((px - next.originX) / next.cellSize).toBeCloseTo(5.5)
    expect((py - next.originY) / next.cellSize).toBeCloseTo(3.5)
  })

  it('マスの大きさは整数。倍率が小さくても 1 px は変える', () => {
    expect(zoomAt(grid, 0, 0, 1.01).cellSize).toBe(11)
    expect(zoomAt(grid, 0, 0, 0.99).cellSize).toBe(9)
    expect(zoomAt(grid, 0, 0, 1.33).cellSize).toBe(13)
  })

  it('最小と最大の間に収める。変わらなければ同じものを返す', () => {
    const tiny = { originX: 0, originY: 0, cellSize: ZOOM_MIN_CELL_SIZE }
    expect(zoomAt(tiny, 10, 10, 0.5)).toBe(tiny)
    const huge = { originX: 0, originY: 0, cellSize: ZOOM_MAX_CELL_SIZE }
    expect(zoomAt(huge, 10, 10, 2)).toBe(huge)
    expect(zoomAt(grid, 0, 0, 1000).cellSize).toBe(ZOOM_MAX_CELL_SIZE)
    expect(zoomAt(grid, 0, 0, 1)).toBe(grid)
  })
})

describe('panBy', () => {
  it('位置だけを動かし、整数にそろえる', () => {
    expect(panBy({ originX: 10, originY: 20, cellSize: 8 }, -30.4, 5.6)).toEqual({ originX: -20, originY: 26, cellSize: 8 })
  })
})

describe('clampToView', () => {
  const size: [number, number, number] = [40, 1, 20]

  it('表示の中にあるときは、そのまま返す', () => {
    const grid = { originX: -100, originY: -50, cellSize: 10 }
    expect(clampToView(grid, size, 300, 200)).toBe(grid)
  })

  it('マス目が外へ出きるときは、端の 48 px を表示に残す', () => {
    // 左上へ出すぎ：右下の端が表示の左上から 48 px の所に来る
    expect(clampToView({ originX: -1000, originY: -1000, cellSize: 10 }, size, 300, 200)).toEqual({ originX: 48 - 400, originY: 48 - 200, cellSize: 10 })
    // 右下へ出すぎ：左上の端が表示の右下から 48 px の所に来る
    expect(clampToView({ originX: 1000, originY: 1000, cellSize: 10 }, size, 300, 200)).toEqual({ originX: 300 - 48, originY: 200 - 48, cellSize: 10 })
  })

  it('マス目が 48 px より小さければ、マス目全体を表示に残す', () => {
    expect(clampToView({ originX: 1000, originY: -1000, cellSize: 1 }, size, 300, 200)).toEqual({ originX: 300 - 40, originY: 0, cellSize: 1 })
  })
})
