import { describe, it, expect } from 'vitest'
import { BlockState } from '../domain/blockState'
import { ResourceLocation } from '../domain/resourceLocation'
import { BlockBrush } from './blockBrush'

function state(id: string, properties: Record<string, string> = {}): BlockState {
  return new BlockState(ResourceLocation.parse(id), properties)
}

describe('BlockBrush', () => {
  it('fromBlock はクリックしたブロックの状態をそのまま持つ', () => {
    const cog = state('create:cogwheel', { axis: 'z' })
    const brush = BlockBrush.fromBlock(cog)
    expect(brush.state).toBe(cog)
    expect(brush.options).toBeNull()
  })

  it('rotate(false) で水平に回し、true を返す', () => {
    const brush = BlockBrush.fromBlock(state('create:shaft', { axis: 'x' }))
    expect(brush.rotate(false)).toBe(true)
    expect(brush.state.key).toBe('create:shaft[axis=z]')
  })

  it('rotate(true) で縦にする', () => {
    const brush = BlockBrush.fromBlock(state('create:creative_motor', { facing: 'east' }))
    expect(brush.rotate(true)).toBe(true)
    expect(brush.state.properties.facing).toBe('up')
    expect(brush.rotate(true)).toBe(true)
    expect(brush.state.properties.facing).toBe('down')
  })

  it('回せる向きがなければ false を返し、状態を変えない', () => {
    const stone = state('minecraft:stone')
    const brush = BlockBrush.fromBlock(stone)
    expect(brush.rotate(false)).toBe(false)
    expect(brush.rotate(true)).toBe(false)
    expect(brush.state).toBe(stone)
  })

  it('取りうる値の一覧があれば、その範囲で回す', () => {
    const brush = BlockBrush.fromBlock(state('create:test', { facing: 'north' }), {
      facing: ['north', 'east', 'south', 'west'],
    })
    expect(brush.rotate(true)).toBe(false)
    expect(brush.state.properties.facing).toBe('north')
  })
})
