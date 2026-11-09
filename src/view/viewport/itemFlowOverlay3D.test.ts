import { describe, expect, it, vi } from 'vitest'
import type { LayerDisplay } from '../layers/layerDisplay'
import { itemDotColor } from './itemDotColor'
import { ItemFlowOverlay3D } from './itemFlowOverlay3D'
import { drawItemDots2D } from './layerRenderer2D'

const dot = (y: number, item = 'minecraft:stone') => ({ pos: [0.5, y, 0.5] as [number, number, number], item })

describe('ItemFlowOverlay3D', () => {
  it('印の数だけ出し、空にすると消える', () => {
    const overlay = new ItemFlowOverlay3D()
    overlay.update([dot(0.5), dot(1.5)])
    expect(overlay.count).toBe(2)
    overlay.update([])
    expect(overlay.count).toBe(0)
    overlay.dispose()
  })

  it('隠した段の印は出さない', () => {
    const overlay = new ItemFlowOverlay3D()
    const only1: LayerDisplay = { layer: 1, mode: 'only', hidden: new Set() }
    overlay.update([dot(0.5), dot(1.5)], only1)
    expect(overlay.count).toBe(1)
    overlay.dispose()
  })
})

describe('drawItemDots2D', () => {
  it('今の段の印だけ、マスの位置に丸で描く', () => {
    const arc = vi.fn()
    const ctx = { fillStyle: '', strokeStyle: '', lineWidth: 0, beginPath: vi.fn(), arc, fill: vi.fn(), stroke: vi.fn() }
    drawItemDots2D(ctx, { originX: 10, originY: 20, cellSize: 16 }, 1, [
      { pos: [0.5, 1.5, 2.5], item: 'minecraft:stone' },
      { pos: [0.5, 0.5, 2.5], item: 'minecraft:stone' },
    ])
    expect(arc).toHaveBeenCalledTimes(1)
    expect(arc.mock.calls[0]!.slice(0, 2)).toEqual([18, 60])
  })
})

describe('itemDotColor', () => {
  it('同じ物は同じ色、違う物は違う色', () => {
    expect(itemDotColor('minecraft:wheat')).toBe(itemDotColor('minecraft:wheat'))
    expect(itemDotColor('minecraft:wheat')).not.toBe(itemDotColor('create:wheat_flour'))
  })
})
