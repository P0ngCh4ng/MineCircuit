import { describe, expect, it } from 'vitest'
import { state } from '../../tests/fixtures/blueprintFixture'
import type { BlockTransform, MirrorAxis, QuarterTurns } from '../domain/blockTransform'
import { transformVanillaState } from './stateTransform'

const turn = (quarterTurns: QuarterTurns): BlockTransform => ({ translate: [0, 0, 0], quarterTurns, mirror: 'none', pivot: [0, 0, 0] })
const mirror = (axis: MirrorAxis): BlockTransform => ({ translate: [0, 0, 0], quarterTurns: 0, mirror: axis, pivot: [0, 0, 0] })

function key(id: string, props: Record<string, string>, t: BlockTransform): string {
  return transformVanillaState(state(id, props), t).key
}

describe('transformVanillaState', () => {
  it('axis は 90° の奇数回で x ↔ z。反転では変えない', () => {
    expect(key('create:shaft', { axis: 'x' }, turn(1))).toBe('create:shaft[axis=z]')
    expect(key('create:shaft', { axis: 'x' }, turn(2))).toBe('create:shaft[axis=x]')
    expect(key('create:shaft', { axis: 'y' }, turn(1))).toBe('create:shaft[axis=y]')
    expect(key('create:shaft', { axis: 'x' }, mirror('x'))).toBe('create:shaft[axis=x]')
  })

  it('facing・horizontal_facing は水平の向きを回し・反転する。上下は変えない', () => {
    expect(key('minecraft:hopper', { facing: 'north' }, turn(1))).toBe('minecraft:hopper[facing=east]')
    expect(key('minecraft:hopper', { facing: 'down' }, turn(1))).toBe('minecraft:hopper[facing=down]')
    expect(key('create:funnel', { horizontal_facing: 'west' }, turn(3))).toBe('create:funnel[horizontal_facing=south]')
    expect(key('minecraft:furnace', { facing: 'east' }, mirror('x'))).toBe('minecraft:furnace[facing=west]')
    expect(key('minecraft:furnace', { facing: 'east' }, mirror('z'))).toBe('minecraft:furnace[facing=east]')
  })

  it('rotation（0〜15）は回転で +4、x の反転で 16 − r、z の反転で 8 − r', () => {
    expect(key('minecraft:oak_sign', { rotation: '14' }, turn(1))).toBe('minecraft:oak_sign[rotation=2]')
    // 4 は west。x の反転で east（12）、z の反転では west のまま
    expect(key('minecraft:oak_sign', { rotation: '4' }, mirror('x'))).toBe('minecraft:oak_sign[rotation=12]')
    expect(key('minecraft:oak_sign', { rotation: '4' }, mirror('z'))).toBe('minecraft:oak_sign[rotation=4]')
    // 0 は south。z の反転で north（8）
    expect(key('minecraft:oak_sign', { rotation: '0' }, mirror('z'))).toBe('minecraft:oak_sign[rotation=8]')
  })

  it('柵・壁の接続は、値をその向きの行き先へ移す', () => {
    const fence = { north: 'true', east: 'false', south: 'false', west: 'false', waterlogged: 'false' }
    expect(transformVanillaState(state('minecraft:oak_fence', fence), turn(1)).properties).toEqual({
      ...fence,
      north: 'false',
      east: 'true',
    })
    const wall = { north: 'tall', east: 'low', south: 'none', west: 'none', up: 'true', waterlogged: 'false' }
    expect(transformVanillaState(state('minecraft:cobblestone_wall', wall), mirror('x')).properties).toEqual({
      ...wall,
      east: 'none',
      west: 'low',
    })
  })

  it('階段は反転で left ↔ right、向きも反転する。回転では shape を変えない', () => {
    const stairs = { facing: 'north', half: 'bottom', shape: 'inner_left', waterlogged: 'false' }
    expect(transformVanillaState(state('minecraft:oak_stairs', stairs), mirror('z')).properties).toMatchObject({
      facing: 'south',
      shape: 'inner_right',
    })
    expect(transformVanillaState(state('minecraft:oak_stairs', stairs), mirror('x')).properties).toMatchObject({
      facing: 'north',
      shape: 'inner_right',
    })
    expect(transformVanillaState(state('minecraft:oak_stairs', stairs), turn(1)).properties).toMatchObject({
      facing: 'east',
      shape: 'inner_left',
    })
  })

  it('レールの shape は向きの語を変え、north / south を先に並べる', () => {
    expect(key('minecraft:rail', { shape: 'north_south' }, turn(1))).toBe('minecraft:rail[shape=east_west]')
    expect(key('minecraft:rail', { shape: 'south_east' }, turn(1))).toBe('minecraft:rail[shape=south_west]')
    expect(key('minecraft:rail', { shape: 'north_east' }, turn(1))).toBe('minecraft:rail[shape=south_east]')
    expect(key('minecraft:rail', { shape: 'ascending_north' }, turn(1))).toBe('minecraft:rail[shape=ascending_east]')
    expect(key('minecraft:rail', { shape: 'south_east' }, mirror('x'))).toBe('minecraft:rail[shape=south_west]')
  })

  it('扉の hinge とチェストの type は反転で left ↔ right。ハーフブロックの type は変えない', () => {
    expect(key('minecraft:oak_door', { facing: 'north', hinge: 'left', half: 'lower' }, mirror('x'))).toBe(
      'minecraft:oak_door[facing=north,half=lower,hinge=right]',
    )
    expect(key('minecraft:chest', { facing: 'north', type: 'left' }, mirror('z'))).toBe('minecraft:chest[facing=south,type=right]')
    expect(key('minecraft:oak_slab', { type: 'top' }, mirror('z'))).toBe('minecraft:oak_slab[type=top]')
    expect(key('minecraft:oak_door', { facing: 'north', hinge: 'left', half: 'lower' }, turn(1))).toBe(
      'minecraft:oak_door[facing=east,half=lower,hinge=left]',
    )
  })

  it('orientation（ジグソー）の向きの語を変える', () => {
    expect(key('minecraft:jigsaw', { orientation: 'up_north' }, turn(1))).toBe('minecraft:jigsaw[orientation=up_east]')
    expect(key('minecraft:jigsaw', { orientation: 'east_up' }, mirror('x'))).toBe('minecraft:jigsaw[orientation=west_up]')
  })

  it('向きのないブロックは同じ状態を返す', () => {
    const stone = state('minecraft:stone')
    expect(transformVanillaState(stone, turn(1))).toBe(stone)
  })

  it('4回回すと元に戻り、同じ反転を2回すると元に戻る', () => {
    const samples = [
      state('minecraft:oak_stairs', { facing: 'west', half: 'top', shape: 'outer_right' }),
      state('minecraft:rail', { shape: 'north_west' }),
      state('minecraft:oak_sign', { rotation: '7' }),
      state('minecraft:oak_fence', { north: 'true', east: 'false', south: 'true', west: 'false' }),
    ]
    for (const s of samples) {
      let r = s
      for (let i = 0; i < 4; i++) r = transformVanillaState(r, turn(1))
      expect(r.key).toBe(s.key)
      for (const axis of ['x', 'z'] as const) {
        expect(transformVanillaState(transformVanillaState(s, mirror(axis)), mirror(axis)).key).toBe(s.key)
      }
    }
  })
})
