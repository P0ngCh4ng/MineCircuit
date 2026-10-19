import { describe, it, expect } from 'vitest'
import { ResourceLocation } from './resourceLocation'

describe('ResourceLocation', () => {
  it('namespace と path に分ける', () => {
    const id = ResourceLocation.parse('create:shaft')
    expect(id.namespace).toBe('create')
    expect(id.path).toBe('shaft')
  })

  it('namespace がなければ minecraft とみなす', () => {
    expect(ResourceLocation.parse('stone').toString()).toBe('minecraft:stone')
    expect(ResourceLocation.parse(':stone').toString()).toBe('minecraft:stone')
  })

  it('path の "/" や "." はそのまま持つ', () => {
    const id = ResourceLocation.parse('create:block/shaft.v2')
    expect(id.path).toBe('block/shaft.v2')
  })

  it('parse と toString で元に戻る', () => {
    for (const s of ['minecraft:air', 'create:mechanical_press', 'railways:track_acacia']) {
      expect(ResourceLocation.parse(s).toString()).toBe(s)
    }
  })

  it('path が空や ":" が2つ以上ならエラーにする', () => {
    expect(() => ResourceLocation.parse('')).toThrow()
    expect(() => ResourceLocation.parse('create:')).toThrow()
    expect(() => ResourceLocation.parse('a:b:c')).toThrow()
  })

  it('equals は namespace と path で比べる', () => {
    expect(ResourceLocation.parse('stone').equals(new ResourceLocation('minecraft', 'stone'))).toBe(true)
    expect(ResourceLocation.parse('create:stone').equals(ResourceLocation.parse('stone'))).toBe(false)
  })
})
