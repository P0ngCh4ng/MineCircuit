import { describe, expect, it } from 'vitest'
import { BlockState } from '../../domain/blockState'
import { ResourceLocation } from '../../domain/resourceLocation'
import { rotateVector } from '../../domain/rotation3'
import { partialModelsFor } from './partialModels'

const state = (id: string, properties: Record<string, string>) => new BlockState(ResourceLocation.parse(id), properties)
const belt = (facing: string, slope: string, part: string) => state('create:belt', { casing: 'false', facing, part, slope, waterlogged: 'false' })

describe('partialModelsFor：ベルト', () => {
  it('平らなベルトは上と下の部品を重ね、端にはプーリーを足す', () => {
    expect(partialModelsFor(belt('south', 'horizontal', 'middle')).map((p) => p.model)).toEqual([
      'create:block/belt/middle',
      'create:block/belt/middle_bottom',
    ])
    expect(partialModelsFor(belt('south', 'horizontal', 'start')).map((p) => p.model)).toEqual([
      'create:block/belt/start',
      'create:block/belt/start_bottom',
      'create:block/belt_pulley',
    ])
    expect(partialModelsFor(belt('south', 'horizontal', 'pulley')).map((p) => p.model)).toEqual([
      'create:block/belt/middle',
      'create:block/belt/middle_bottom',
      'create:block/belt_pulley',
    ])
  })

  it('坂は斜めの部品1つ。下り坂は始まりと終わりを入れ替える', () => {
    expect(partialModelsFor(belt('north', 'upward', 'start')).map((p) => p.model)).toEqual([
      'create:block/belt/diagonal_start',
      'create:block/belt_pulley',
    ])
    expect(partialModelsFor(belt('north', 'downward', 'start'))[0]!.model).toBe('create:block/belt/diagonal_end')
    // 正の向き（南・東）の縦のベルトも入れ替える
    expect(partialModelsFor(belt('south', 'vertical', 'end'))[0]!.model).toBe('create:block/belt/start')
    expect(partialModelsFor(belt('north', 'vertical', 'end'))[0]!.model).toBe('create:block/belt/end')
  })

  it('向きは Create の描画と同じ順で回す', () => {
    // 南向きの平らなベルトは回さない。東向きは y に 90 度（右手系）
    expect(rotateVector(partialModelsFor(belt('south', 'horizontal', 'middle'))[0]!.matrix, [0, 0, 1])).toEqual([0, 0, 1])
    expect(rotateVector(partialModelsFor(belt('east', 'horizontal', 'middle'))[0]!.matrix, [0, 0, 1])).toEqual([1, 0, 0])
    // 縦のベルトは x に 90 度で立てる：部品の上（+y）が南（+z）を向き、北向きならさらに y に 180 度で北
    expect(rotateVector(partialModelsFor(belt('north', 'vertical', 'middle'))[0]!.matrix, [0, 1, 0])).toEqual([0, 0, -1])
    // 横向きのベルトは z にも回すので、部品の上が水平になる
    const side = partialModelsFor(belt('south', 'sideways', 'middle'))[0]!.matrix
    expect(rotateVector(side, [0, 1, 0])[1]).toBe(0)
  })

  it('プーリーの軸は進む向きに直角、横向きのベルトなら上下', () => {
    // belt_pulley の部品は y 軸の柱。南向きのベルトなら軸は東西（x）
    const axisOf = (facing: string, slope: string) => rotateVector(partialModelsFor(belt(facing, slope, 'start')).at(-1)!.matrix, [0, 1, 0]).map(Math.abs)
    expect(axisOf('south', 'horizontal')).toEqual([1, 0, 0])
    expect(axisOf('east', 'horizontal')).toEqual([0, 0, 1])
    expect(axisOf('south', 'sideways')).toEqual([0, 1, 0])
  })
})

describe('partialModelsFor：ブレイズバーナー', () => {
  const burner = (blaze: string) => partialModelsFor(state('create:blaze_burner', { blaze, facing: 'south' })).map((p) => p.model)

  it('熱の段階で頭と棒を選ぶ。空なら何も重ねない', () => {
    expect(burner('none')).toEqual([])
    expect(burner('smouldering')).toEqual(['create:block/blaze_burner/blaze/inert'])
    expect(burner('kindled')).toEqual([
      'create:block/blaze_burner/blaze/idle',
      'create:block/blaze_burner/rods_small',
      'create:block/blaze_burner/rods_large',
    ])
    expect(burner('seething')[0]).toBe('create:block/blaze_burner/blaze/super')
  })

  it('表にないブロックには何も重ねない', () => {
    expect(partialModelsFor(state('create:shaft', { axis: 'y' }))).toEqual([])
  })
})
