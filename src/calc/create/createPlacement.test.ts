import { describe, expect, it } from 'vitest'
import { blueprintFixture, state } from '../../../tests/fixtures/blueprintFixture'
import { LARGE_COG_NEXT_TO_SMALL, NEXT_TO_LARGE_COG, orientForPlacement, placementProblem } from './createPlacement'

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

describe('placementProblem（Create の歯車）', () => {
  const large = (axis: string) => state('create:large_cogwheel', { axis })
  const small = (axis: string) => state('create:cogwheel', { axis })

  it('大きい歯車の、軸に垂直な横には歯車を置けない。軸の両端と斜めは置ける', () => {
    const bp = blueprintFixture({ size: [3, 3, 3] }).place([1, 1, 1], 'create:large_cogwheel', { axis: 'y' }).toBlueprint()
    expect(placementProblem(bp, [2, 1, 1], small('y'))).toBe(NEXT_TO_LARGE_COG)
    expect(placementProblem(bp, [1, 1, 2], large('y'))).toBe(NEXT_TO_LARGE_COG)
    // 軸の端（上）
    expect(placementProblem(bp, [1, 2, 1], small('y'))).toBeNull()
    // 斜め
    expect(placementProblem(bp, [2, 2, 1], small('y'))).toBeNull()
    // 自分の軸がその向きなら、その向きの隣は調べない
    expect(placementProblem(bp, [2, 1, 1], small('x'))).toBeNull()
  })

  it('大きい歯車は小さい歯車の横に置けない。隣の軸がこちらを向いていれば置ける', () => {
    const bp = blueprintFixture({ size: [3, 1, 3] })
      .place([0, 0, 0], 'create:cogwheel', { axis: 'y' })
      .place([2, 0, 0], 'create:cogwheel', { axis: 'x' })
      .toBlueprint()
    expect(placementProblem(bp, [0, 0, 1], large('y'))).toBe(LARGE_COG_NEXT_TO_SMALL)
    // [2,0,0] の小さい歯車は軸が x。[1,0,0] から見て東（x 軸の向き）なので例外
    expect(placementProblem(bp, [1, 0, 1], large('y'))).toBeNull()
    // 小さい歯車どうしは横に並べられる
    expect(placementProblem(bp, [1, 0, 0], small('y'))).toBeNull()
  })

  it('ケース入りの歯車も同じ。歯車でないブロックは調べない', () => {
    const bp = blueprintFixture({ size: [2, 1, 1] }).place([0, 0, 0], 'create:andesite_encased_large_cogwheel', { axis: 'y' }).toBlueprint()
    expect(placementProblem(bp, [1, 0, 0], state('create:brass_encased_cogwheel', { axis: 'y' }))).toBe(NEXT_TO_LARGE_COG)
    expect(placementProblem(bp, [1, 0, 0], state('create:shaft', { axis: 'y' }))).toBeNull()
  })

  it('向きを自動で合わせるとき、置けない向きは選ばない', () => {
    // 小さい歯車 [0,0,0] axis=y の東に、大きい歯車 [2,0,0] axis=y。[1,0,0] に置く小さい歯車
    const bp = blueprintFixture({ size: [3, 1, 1] })
      .place([0, 0, 0], 'create:cogwheel', { axis: 'y' })
      .place([2, 0, 0], 'create:large_cogwheel', { axis: 'y' })
      .toBlueprint()
    // 噛み合う axis=y は大きい歯車の横なので置けない。x なら東西の隣は調べないので置けるが、つながらないので変えない
    expect(orientForPlacement(bp, [1, 0, 0], small('z'), null)).toBeNull()
  })
})
