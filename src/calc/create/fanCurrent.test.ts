import { describe, expect, it } from 'vitest'
import { blueprintFixture, type BlueprintFixture } from '../../../tests/fixtures/blueprintFixture'
import { BlockState } from '../../domain/blockState'
import { ResourceLocation } from '../../domain/resourceLocation'
import type { Vec3 } from '../../domain/vec3'
import { fanAirflowDirection, fanCatalyst, fanMaxDistance, findFanCurrents, type FanCurrents } from './fanCurrent'

/** 回転数の表（"x,y,z" → RPM）で風を求める */
function currents(fx: BlueprintFixture, speeds: Record<string, number>): FanCurrents {
  return findFanCurrents(fx.toBlueprint(), (p) => speeds[p.join(',')] ?? null)
}

/** x = 1.. のマスの種類（風がなければ '-'、何もしない風なら '0'） */
function kindsAlongX(c: FanCurrents, y: number, z: number, n: number): string[] {
  const out: string[] = []
  for (let x = 1; x <= n; x++) {
    const cell = c.cellsAt([x, y, z])[0]
    out.push(cell ? (cell.kind ?? '0') : '-')
  }
  return out
}

const state = (id: string, props: Record<string, string> = {}) => new BlockState(ResourceLocation.parse(id), props)

describe('扇風機の風（#235）', () => {
  it('[TP-FAN] 風の向きは回転数を facing の向きの符号に直して決める。届く距離は lerp(min(|rpm| / 256, 1), 3, 20)', () => {
    expect(fanAirflowDirection(32, 'east')).toBe('east')
    expect(fanAirflowDirection(-32, 'east')).toBe('west')
    expect(fanAirflowDirection(32, 'west')).toBe('east')
    expect(fanAirflowDirection(-32, 'down')).toBe('down')
    expect(fanAirflowDirection(32, 'north')).toBe('south')
    expect(fanAirflowDirection(0, 'east')).toBeNull()
    expect(fanMaxDistance(0)).toBe(3)
    expect(fanMaxDistance(64)).toBe(7.25)
    expect(fanMaxDistance(-128)).toBe(11.5)
    expect(fanMaxDistance(256)).toBe(20)
    expect(fanMaxDistance(512)).toBe(20)
  })

  it('[TP-FAN] 風は facing の側のマスに、届く距離（切り上げ）まで。1ブロック全部のブロックの手前、ベルト・デポのマスで止まり、上向きのファンネルは通す', () => {
    const fx = blueprintFixture({ size: [12, 2, 3] }).place([0, 0, 0], 'create:encased_fan', { facing: 'east' })
    // 64 RPM で 7.25 ブロック → 8 マス
    expect(kindsAlongX(currents(fx, { '0,0,0': 64 }), 0, 0, 10)).toEqual(['0', '0', '0', '0', '0', '0', '0', '0', '-', '-'])
    // 引く風も同じマス
    expect(kindsAlongX(currents(fx, { '0,0,0': -64 }), 0, 0, 10).filter((k) => k !== '-')).toHaveLength(8)
    // 止まっていれば風はない
    expect(kindsAlongX(currents(fx, {}), 0, 0, 3)).toEqual(['-', '-', '-'])

    fx.place([2, 0, 0], 'create:brass_funnel', { facing: 'up', extracting: 'false', powered: 'false' })
      .place([3, 0, 0], 'minecraft:oak_fence')
      .place([4, 0, 0], 'minecraft:stone')
    expect(kindsAlongX(currents(fx, { '0,0,0': 64 }), 0, 0, 6)).toEqual(['0', '0', '0', '-', '-', '-'])
    fx.place([4, 0, 0], 'create:depot')
    expect(kindsAlongX(currents(fx, { '0,0,0': 64 }), 0, 0, 6)).toEqual(['0', '0', '0', '0', '-', '-'])
    // 横向きのファンネルは、そのマスで止める
    fx.place([2, 0, 0], 'create:andesite_funnel', { facing: 'north', extracting: 'false', powered: 'false' })
    expect(kindsAlongX(currents(fx, { '0,0,0': 64 }), 0, 0, 6)).toEqual(['0', '0', '-', '-', '-', '-'])
    // 設計図の外へは出ない
    const edge = blueprintFixture({ size: [3, 1, 1] }).place([0, 0, 0], 'create:encased_fan', { facing: 'east' })
    expect(kindsAlongX(currents(edge, { '0,0,0': 256 }), 0, 0, 2)).toEqual(['0', '0'])
  })

  it('[TP-FAN-CATALYST] 種類は見つけたマスから風の進む向きに続く。押す風は遠い方へ、引く風は扇風機の方へ', () => {
    const fx = blueprintFixture({ size: [10, 1, 1] })
      .place([0, 0, 0], 'create:encased_fan', { facing: 'east' })
      .place([2, 0, 0], 'minecraft:water', { level: '0' })
      .place([5, 0, 0], 'minecraft:lava', { level: '0' })
    // 64 RPM：押す
    expect(kindsAlongX(currents(fx, { '0,0,0': 64 }), 0, 0, 8)).toEqual([
      '0',
      'splashing',
      'splashing',
      'splashing',
      'blasting',
      'blasting',
      'blasting',
      'blasting',
    ])
    // 引く：遠い方から見て、溶岩から扇風機の方へ、水から扇風機の方へ
    expect(kindsAlongX(currents(fx, { '0,0,0': -64 }), 0, 0, 8)).toEqual([
      'splashing',
      'splashing',
      'blasting',
      'blasting',
      'blasting',
      '0',
      '0',
      '0',
    ])
  })

  it('[TP-FAN-CATALYST] マスの種類：水・水浸しのブロック、ソウルファイア、火・焚き火、溶岩、ブレイズバーナーの段階', () => {
    expect(fanCatalyst(null)).toBeNull()
    expect(fanCatalyst(state('minecraft:water', { level: '3' }))).toBe('splashing')
    expect(fanCatalyst(state('minecraft:oak_slab', { waterlogged: 'true' }))).toBe('splashing')
    expect(fanCatalyst(state('minecraft:oak_slab', { waterlogged: 'false' }))).toBeNull()
    expect(fanCatalyst(state('minecraft:soul_fire'))).toBe('haunting')
    expect(fanCatalyst(state('minecraft:soul_campfire', { lit: 'true' }))).toBe('haunting')
    expect(fanCatalyst(state('minecraft:soul_campfire', { lit: 'false' }))).toBeNull()
    expect(fanCatalyst(state('create:lit_blaze_burner', { flame_type: 'soul' }))).toBe('haunting')
    expect(fanCatalyst(state('create:lit_blaze_burner', { flame_type: 'regular' }))).toBe('smoking')
    expect(fanCatalyst(state('minecraft:fire'))).toBe('smoking')
    expect(fanCatalyst(state('minecraft:campfire', { lit: 'true', waterlogged: 'false' }))).toBe('smoking')
    expect(fanCatalyst(state('minecraft:campfire', { lit: 'false', waterlogged: 'false' }))).toBeNull()
    expect(fanCatalyst(state('create:blaze_burner', { blaze: 'none' }))).toBeNull()
    expect(fanCatalyst(state('create:blaze_burner', { blaze: 'smouldering' }))).toBe('smoking')
    for (const blaze of ['fading', 'kindled', 'seething']) expect(fanCatalyst(state('create:blaze_burner', { blaze }))).toBe('blasting')
    expect(fanCatalyst(state('minecraft:lava', { level: '0' }))).toBe('blasting')
    expect(fanCatalyst(state('minecraft:stone'))).toBeNull()
  })

  it('[TP-FAN-ON-BELT] ベルト・デポは、風のマスと、風が水平ならその1段下。縦の風は1段下を見ない', () => {
    const fx = blueprintFixture({ size: [6, 4, 2] })
      .place([0, 1, 0], 'create:encased_fan', { facing: 'east' })
      .place([1, 1, 0], 'minecraft:campfire', { lit: 'true', waterlogged: 'false' })
      .place([2, 0, 0], 'create:depot')
      .place([3, 1, 0], 'create:depot')
      // 縦の風：(5,0,1) から上へ
      .place([5, 0, 1], 'create:encased_fan', { facing: 'up' })
      .place([5, 1, 1], 'minecraft:water', { level: '0' })
      .place([4, 1, 1], 'create:depot')
    const c = currents(fx, { '0,1,0': 64, '5,0,1': 64 })
    const kindAt = (p: Vec3) => c.handlersAt(p).map((h) => h.kind)
    expect(kindAt([2, 0, 0])).toEqual(['smoking'])
    expect(kindAt([3, 1, 0])).toEqual(['smoking'])
    // デポのマスで風は止まる
    expect(c.cellsAt([4, 1, 0])).toEqual([])
    expect(kindAt([4, 0, 0])).toEqual([])
    expect(c.cellsAt([5, 2, 1])[0]?.kind).toBe('splashing')
    expect(kindAt([4, 1, 1])).toEqual([])
  })
})
