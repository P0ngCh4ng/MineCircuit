import { describe, expect, it } from 'vitest'
import { blueprintFixture, state } from '../../../tests/fixtures/blueprintFixture'
import { orientForPlacement } from './createPlacement'

describe('orientForPlacement（Create）', () => {
  it('シャフトの端に置くシャフトは、同じ軸にする。つながる相手がなければ変えない', () => {
    const bp = blueprintFixture({ size: [3, 3, 3] }).place([1, 1, 1], 'create:shaft', { axis: 'y' }).toBlueprint()
    // 上の端（[1,2,1]）
    expect(orientForPlacement(bp, [1, 2, 1], state('create:shaft', { axis: 'x' }), null)?.key).toBe('create:shaft[axis=y]')
    // 横（[2,1,1]）はシャフトの口ではないのでつながらない
    expect(orientForPlacement(bp, [2, 1, 1], state('create:shaft', { axis: 'x' }), null)).toBeNull()
    // すでにつながる向きなら変えない
    expect(orientForPlacement(bp, [1, 0, 1], state('create:shaft', { axis: 'y' }), null)).toBeNull()
  })

  it('歯車の横に置く歯車は、噛み合う軸にする', () => {
    const bp = blueprintFixture({ size: [3, 1, 3] }).place([1, 0, 1], 'create:cogwheel', { axis: 'y' }).toBlueprint()
    expect(orientForPlacement(bp, [2, 0, 1], state('create:cogwheel', { axis: 'x' }), null)?.key).toBe('create:cogwheel[axis=y]')
  })

  it('モーターは軸（facing）を隣のシャフトへ向ける', () => {
    const bp = blueprintFixture({ size: [3, 1, 1] }).place([1, 0, 0], 'create:shaft', { axis: 'x' }).toBlueprint()
    expect(orientForPlacement(bp, [0, 0, 0], state('create:creative_motor', { facing: 'north' }), null)?.key).toBe(
      'create:creative_motor[facing=east]',
    )
  })

  it('両側につながる相手があれば、クリックした面の側を優先する', () => {
    const bp = blueprintFixture({ size: [3, 3, 1] })
      .place([0, 1, 0], 'create:shaft', { axis: 'x' })
      .place([1, 0, 0], 'create:shaft', { axis: 'y' })
      .toBlueprint()
    const shaft = state('create:shaft', { axis: 'z' })
    expect(orientForPlacement(bp, [1, 1, 0], shaft, 'west')?.key).toBe('create:shaft[axis=x]')
    expect(orientForPlacement(bp, [1, 1, 0], shaft, 'down')?.key).toBe('create:shaft[axis=y]')
  })

  it('Create 以外のブロックと、向きを持たないブロックは変えない', () => {
    const bp = blueprintFixture({ size: [3, 1, 1] }).place([1, 0, 0], 'create:shaft', { axis: 'x' }).toBlueprint()
    expect(orientForPlacement(bp, [0, 0, 0], state('minecraft:oak_log', { axis: 'y' }), null)).toBeNull()
    expect(orientForPlacement(bp, [0, 0, 0], state('create:mechanical_press'), null)).toBeNull()
  })
})
