import { describe, it, expect } from 'vitest'
import { BlockState, blockStateKey } from './blockState'
import { ResourceLocation } from './resourceLocation'

const shaft = ResourceLocation.parse('create:shaft')

describe('BlockState', () => {
  it('properties がなければ key は ID だけ', () => {
    const state = new BlockState(ResourceLocation.parse('stone'))
    expect(state.key).toBe('minecraft:stone')
    expect(state.properties).toEqual({})
  })

  it('key は properties を名前順に並べる', () => {
    const a = new BlockState(shaft, { waterlogged: 'false', axis: 'y' })
    const b = new BlockState(shaft, { axis: 'y', waterlogged: 'false' })
    expect(a.key).toBe('create:shaft[axis=y,waterlogged=false]')
    expect(blockStateKey(b)).toBe(a.key)
    expect(a.equals(b)).toBe(true)
  })

  it('値や ID が違えば別の状態', () => {
    const y = new BlockState(shaft, { axis: 'y' })
    expect(y.equals(new BlockState(shaft, { axis: 'x' }))).toBe(false)
    expect(y.equals(new BlockState(ResourceLocation.parse('create:cogwheel'), { axis: 'y' }))).toBe(false)
    expect(y.equals(new BlockState(shaft))).toBe(false)
  })

  it('渡した properties をあとで書き換えても影響しない', () => {
    const props: Record<string, string> = { axis: 'y' }
    const state = new BlockState(shaft, props)
    props.axis = 'x'
    expect(state.properties.axis).toBe('y')
    expect(Object.isFrozen(state.properties)).toBe(true)
  })
})
