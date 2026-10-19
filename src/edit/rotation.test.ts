import { describe, it, expect } from 'vitest'
import { BlockState } from '../domain/blockState'
import { ResourceLocation } from '../domain/resourceLocation'
import { canRotate, rotateState } from './rotation'

function state(id: string, properties: Record<string, string> = {}): BlockState {
  return new BlockState(ResourceLocation.parse(id), properties)
}

/** 指定の property を1回回した値 */
function turn(name: string, value: string, vertical: boolean): string | undefined {
  return rotateState(state('create:test', { [name]: value }), vertical).properties[name]
}

describe('rotateState: axis', () => {
  it('R で x と z を入れ替える', () => {
    expect(turn('axis', 'x', false)).toBe('z')
    expect(turn('axis', 'z', false)).toBe('x')
  })

  it('R で y は変えない', () => {
    const shaft = state('create:shaft', { axis: 'y' })
    expect(rotateState(shaft, false)).toBe(shaft)
    expect(canRotate(shaft, false)).toBe(false)
  })

  it('Shift+R で y にし、y なら x に戻す', () => {
    expect(turn('axis', 'x', true)).toBe('y')
    expect(turn('axis', 'z', true)).toBe('y')
    expect(turn('axis', 'y', true)).toBe('x')
  })
})

describe('rotateState: facing', () => {
  it('R で north → east → south → west → north', () => {
    expect(turn('facing', 'north', false)).toBe('east')
    expect(turn('facing', 'east', false)).toBe('south')
    expect(turn('facing', 'south', false)).toBe('west')
    expect(turn('facing', 'west', false)).toBe('north')
  })

  it('R で up / down は変えない', () => {
    expect(turn('facing', 'up', false)).toBe('up')
    expect(turn('facing', 'down', false)).toBe('down')
  })

  it('Shift+R で up → down → north、水平の向きは up にする', () => {
    expect(turn('facing', 'up', true)).toBe('down')
    expect(turn('facing', 'down', true)).toBe('north')
    for (const dir of ['north', 'east', 'south', 'west']) {
      expect(turn('facing', dir, true)).toBe('up')
    }
  })
})

describe('rotateState: horizontal_facing', () => {
  it('R で north → east → south → west → north', () => {
    expect(turn('horizontal_facing', 'north', false)).toBe('east')
    expect(turn('horizontal_facing', 'east', false)).toBe('south')
    expect(turn('horizontal_facing', 'south', false)).toBe('west')
    expect(turn('horizontal_facing', 'west', false)).toBe('north')
  })

  it('Shift+R では変えない', () => {
    const press = state('create:mechanical_press', { horizontal_facing: 'north' })
    expect(rotateState(press, true)).toBe(press)
    expect(canRotate(press, true)).toBe(false)
  })
})

describe('rotateState: そのほか', () => {
  it('回す property がなければ元の状態をそのまま返す', () => {
    const stone = state('minecraft:stone')
    expect(rotateState(stone, false)).toBe(stone)
    expect(rotateState(stone, true)).toBe(stone)
    expect(canRotate(stone, false)).toBe(false)
  })

  it('ほかの property と ID はそのまま残し、元の状態は変えない', () => {
    const belt = state('create:belt', { facing: 'east', slope: 'horizontal', part: 'start' })
    const rotated = rotateState(belt, false)
    expect(rotated.id.toString()).toBe('create:belt')
    expect(rotated.properties).toEqual({ facing: 'south', slope: 'horizontal', part: 'start' })
    expect(belt.properties.facing).toBe('east')
  })

  it('知らない値は変えない', () => {
    expect(turn('facing', 'sideways', false)).toBe('sideways')
    expect(turn('facing', 'sideways', true)).toBe('sideways')
    expect(turn('axis', 'w', false)).toBe('w')
    expect(turn('axis', 'w', true)).toBe('w')
  })

  it('R を4回で元に戻る', () => {
    const motor = state('create:creative_motor', { facing: 'north' })
    let s = motor
    for (let i = 0; i < 4; i++) s = rotateState(s, false)
    expect(s.equals(motor)).toBe(true)
  })
})

describe('rotateState: 取りうる値の一覧', () => {
  it('一覧にない値は飛ばす', () => {
    // 水平の向きしか取らない facing
    const options = { facing: ['north', 'east', 'south', 'west'] }
    const s = state('create:test', { facing: 'north' })
    expect(rotateState(s, true, options)).toBe(s)
    expect(canRotate(s, true, options)).toBe(false)
    expect(rotateState(s, false, options).properties.facing).toBe('east')
  })

  it('一覧の範囲で次の値に進む', () => {
    const options = { facing: ['north', 'south'] }
    const s = state('create:test', { facing: 'north' })
    expect(rotateState(s, false, options).properties.facing).toBe('south')
  })

  it('axis が x と y だけなら、Shift+R で x ↔ y', () => {
    const options = { axis: ['x', 'y'] }
    expect(rotateState(state('create:test', { axis: 'x' }), true, options).properties.axis).toBe('y')
    expect(rotateState(state('create:test', { axis: 'y' }), true, options).properties.axis).toBe('x')
    // R の x → z は一覧にないので変えない
    expect(canRotate(state('create:test', { axis: 'x' }), false, options)).toBe(false)
  })

  it('一覧にない property は規則のとおりに回す', () => {
    const options = { axis: ['x', 'y', 'z'] }
    expect(rotateState(state('create:test', { facing: 'north' }), false, options).properties.facing).toBe('east')
  })
})
