import { describe, expect, it } from 'vitest'
import { blueprintFixture } from '../../../tests/fixtures/blueprintFixture'
import { pick2D } from '../tools/picker'
import { axisLabelStep, blockAbbreviation, DEFAULT_GRID_PADDING, layerCells, layoutGrid2D, MAX_CELL_SIZE, MIN_CELL_SIZE } from './layerGrid2D'

describe('layoutGrid2D', () => {
  it('段（x × z）が余白の内側に入る一番大きなマスにし、真ん中に置く', () => {
    const pad = DEFAULT_GRID_PADDING
    // 内側は 400 × 200。幅 10・奥行き 5 なら 1マス 40 で、ちょうど入る
    const grid = layoutGrid2D(400 + pad.left + pad.right, 200 + pad.top + pad.bottom, [10, 3, 5])
    expect(grid).toEqual({ originX: pad.left, originY: pad.top, cellSize: 40 })

    // 横に余るときは横の真ん中
    const wide = layoutGrid2D(600 + pad.left + pad.right, 200 + pad.top + pad.bottom, [10, 1, 5])
    expect(wide.cellSize).toBe(40)
    expect(wide.originX).toBe(pad.left + 100)
    expect(wide.originY).toBe(pad.top)
  })

  it('マスの大きさは最小と最大の間に収める', () => {
    expect(layoutGrid2D(2000, 2000, [1, 1, 1]).cellSize).toBe(MAX_CELL_SIZE)
    expect(layoutGrid2D(100, 100, [500, 1, 500]).cellSize).toBe(MIN_CELL_SIZE)
  })

  it('pick2D と組み合わせると、マスの真ん中がそのマスになる', () => {
    const bp = blueprintFixture({ size: [4, 2, 3] }).place([2, 1, 1], 'minecraft:stone').toBlueprint()
    const grid = layoutGrid2D(300, 300, bp.size)
    const center = (x: number, z: number): [number, number] => [
      grid.originX + (x + 0.5) * grid.cellSize,
      grid.originY + (z + 0.5) * grid.cellSize,
    ]
    const scene = { size: bp.size, layer: 1, isFilled: (p: readonly [number, number, number]) => bp.get(p) !== null }
    expect(pick2D(...center(2, 1), grid, scene)).toEqual({ pos: [2, 1, 1], empty: false })
    expect(pick2D(...center(0, 0), grid, scene)).toEqual({ pos: [0, 1, 0], empty: true })
    expect(pick2D(grid.originX - 1, grid.originY, grid, scene)).toBeNull()
  })
})

describe('axisLabelStep', () => {
  it('マスが大きければ毎マス、小さければきりのよい間隔にする', () => {
    expect(axisLabelStep(30)).toBe(1)
    expect(axisLabelStep(11)).toBe(2)
    expect(axisLabelStep(8)).toBe(5)
    expect(axisLabelStep(4)).toBe(10)
    expect(axisLabelStep(1)).toBe(50)
  })
})

describe('blockAbbreviation', () => {
  it('namespace を除いた名前から2文字を作る', () => {
    expect(blockAbbreviation('create:mechanical_press')).toBe('MP')
    expect(blockAbbreviation('minecraft:stone')).toBe('ST')
    expect(blockAbbreviation('create:shaft')).toBe('SH')
    expect(blockAbbreviation('x')).toBe('X')
    expect(blockAbbreviation('mod:')).toBe('?')
  })
})

describe('layerCells', () => {
  it('段 y のブロックだけを返す。空気と範囲の外の段は除く', () => {
    const bp = blueprintFixture({ size: [3, 2, 2] })
      .place([0, 0, 0], 'create:shaft', { axis: 'x' })
      .place([1, 0, 1], 'minecraft:air')
      .place([2, 1, 1], 'minecraft:stone')
      .toBlueprint()
    expect(layerCells(bp, 0).map((c) => [c.x, c.z, c.id])).toEqual([[0, 0, 'create:shaft']])
    expect(layerCells(bp, 1).map((c) => [c.x, c.z, c.id])).toEqual([[2, 1, 'minecraft:stone']])
    expect(layerCells(bp, 2)).toEqual([])
    expect(layerCells(bp, -1)).toEqual([])
  })
})
