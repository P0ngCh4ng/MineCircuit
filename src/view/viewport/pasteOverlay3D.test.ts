import { describe, expect, it } from 'vitest'
import { state } from '../../../tests/fixtures/blueprintFixture'
import { PasteOverlay3D } from './pasteOverlay3D'

describe('PasteOverlay3D', () => {
  it('見本のマスと範囲の線を出し、空なら消す', () => {
    const overlay = new PasteOverlay3D()
    const cells = [
      { pos: [0, 0, 1] as const, state: state('minecraft:stone') },
      { pos: [1, 0, 1] as const, state: state('create:shaft') },
    ]
    overlay.update(cells, { min: [0, 0, 1], max: [1, 0, 1] }, false)
    expect(overlay.count()).toBe(2)
    expect(overlay.outlineVisible).toBe(true)
    expect(overlay.group.getObjectByName('paste-cells')).toBeDefined()

    overlay.update([], null, false)
    expect(overlay.count()).toBe(0)
    expect(overlay.outlineVisible).toBe(false)
    expect(overlay.group.getObjectByName('paste-cells')).toBeUndefined()
    overlay.dispose()
  })
})
