import { describe, expect, it } from 'vitest'
import { blueprintFixture } from '../../../tests/fixtures/blueprintFixture'
import type { Vec3 } from '../../domain/vec3'
import type { FluidField } from '../fluidFlow'
import type { Axis } from './kineticBlocks'
import { waterWheelFlow, waterWheelOffsets } from './waterWheel'

/** 決めたマスだけに流れがある液体（広げる計算を通さない） */
function fakeField(flows: Record<string, Vec3>, simulated = false): FluidField {
  return {
    flow: (pos: Vec3) => flows[pos.join()] ?? [0, 0, 0],
    simulated: () => simulated,
  } as unknown as FluidField
}

const bp = blueprintFixture().size([5, 5, 5]).toBlueprint()
const center: Vec3 = [2, 2, 2]

describe('水車の FlowScore（ST-WATER-WHEEL-FLOW）', () => {
  it('[ST-WATER-WHEEL-FLOW] 見るマスは、小さい水車は軸に垂直な4つ、大きい水車は2つ先の12', () => {
    expect(waterWheelOffsets('y', false).map((o) => o.join())).toEqual(['1,0,0', '-1,0,0', '0,0,1', '0,0,-1'])
    const large = waterWheelOffsets('x', true)
    expect(large).toHaveLength(12)
    expect(large.every((o) => o[0] === 0 && Math.max(Math.abs(o[1]), Math.abs(o[2])) === 2)).toBe(true)
  })

  // 羽の進む向き：中心からマスへの向きを軸のまわりに 90° 回したもの
  const cases: [Axis, Vec3, Vec3][] = [
    ['x', [2, 3, 2], [0, 0, 1]],
    ['y', [3, 2, 2], [0, 0, -1]],
    ['z', [2, 3, 2], [-1, 0, 0]],
  ]
  for (const [axis, cell, motion] of cases) {
    it(`[ST-WATER-WHEEL-FLOW] 軸 ${axis}：${cell.join()} で ${motion.join()} に流れれば +1、逆なら −1`, () => {
      expect(waterWheelFlow(bp, fakeField({ [cell.join()]: motion }), center, axis, false).score).toBe(1)
      const back: Vec3 = [-motion[0], -motion[1], -motion[2]]
      expect(waterWheelFlow(bp, fakeField({ [cell.join()]: back }), center, axis, false).score).toBe(-1)
    })
  }

  it('[ST-WATER-WHEEL-FLOW] 軸の向きの流れは数えず、羽の進む向きと 60° 以上ずれた流れも数えない', () => {
    expect(waterWheelFlow(bp, fakeField({ '2,3,2': [0, 0, 1] }), center, 'z', false).score).toBe(0)
    expect(waterWheelFlow(bp, fakeField({ '2,3,2': [-0.5, 0.87, 0] }), center, 'z', false).score).toBe(0)
    expect(waterWheelFlow(bp, fakeField({ '2,3,2': [-0.6, 0.8, 0] }), center, 'z', false).score).toBe(1)
  })

  it('[ST-WATER-WHEEL-FLOW] 広げる計算で決めた流れを数えたことと、設計図の外を見たことを返す', () => {
    const r = waterWheelFlow(bp, fakeField({ '2,3,2': [-1, 0, 0] }, true), center, 'z', false)
    expect(r).toEqual({ score: 1, outside: false, simulated: true })
    expect(waterWheelFlow(bp, fakeField({}), [0, 0, 0], 'z', false).outside).toBe(true)
  })
})
