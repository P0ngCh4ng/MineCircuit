import { describe, expect, it } from 'vitest'
import { fluidHeight, fluidModel, isFluidTexture } from './fluidModel'

describe('fluidModel', () => {
  it('still のテクスチャを液体とみなす', () => {
    expect(isFluidTexture('minecraft:block/water_still')).toBe(true)
    expect(isFluidTexture('create:fluid/honey_still')).toBe(true)
    expect(isFluidTexture('create:block/belt')).toBe(false)
  })

  it('高さは level で決める（Minecraft と同じ）', () => {
    expect(fluidHeight(undefined)).toBeCloseTo((8 / 9) * 16)
    expect(fluidHeight('0')).toBeCloseTo((8 / 9) * 16)
    expect(fluidHeight('4')).toBeCloseTo((4 / 9) * 16)
    expect(fluidHeight('7')).toBeCloseTo((1 / 9) * 16)
    expect(fluidHeight('8')).toBe(16)
    expect(fluidHeight('15')).toBe(16)
    expect(fluidHeight('x')).toBeCloseTo((8 / 9) * 16)
  })

  it('高さのある箱。水には水の色を掛け、上の面は 1 ブロックの高さのときだけ隠す', () => {
    const water = fluidModel('minecraft:water', 'minecraft:block/water_still', '0')
    const e = water.elements[0]!
    expect(e.to[1]).toBeCloseTo((8 / 9) * 16)
    expect(e.faces.up!.texture).toBe('minecraft:block/water_still#tint=3f76e4')
    expect(e.faces.up!.cullface).toBeNull()
    expect(e.faces.north!.cullface).toBe('north')
    expect(e.faces.north!.uv[1]).toBeCloseTo(16 - (8 / 9) * 16)

    const falling = fluidModel('minecraft:water', 'minecraft:block/water_still', '8').elements[0]!
    expect(falling.faces.up!.cullface).toBe('up')

    const lava = fluidModel('minecraft:lava', 'minecraft:block/lava_still', '0').elements[0]!
    expect(lava.faces.up!.texture).toBe('minecraft:block/lava_still')
  })
})
