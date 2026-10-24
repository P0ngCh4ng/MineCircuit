import { describe, expect, it } from 'vitest'
import { axisRotation, composeRotations, IDENTITY_ROTATION, rotateVector } from './rotation3'

describe('rotation3', () => {
  it('右手系で 90 度単位に回す', () => {
    // y のまわりに 90 度：東（+x）が北（-z）へ
    expect(rotateVector(axisRotation('y', 90), [1, 0, 0])).toEqual([0, 0, -1])
    // x のまわりに 90 度：上（+y）が南（+z）へ
    expect(rotateVector(axisRotation('x', 90), [0, 1, 0])).toEqual([0, 0, 1])
    // z のまわりに 90 度：東（+x）が上（+y）へ
    expect(rotateVector(axisRotation('z', 90), [1, 0, 0])).toEqual([0, 1, 0])
    expect(axisRotation('y', -90)).toEqual(axisRotation('y', 270))
    expect(axisRotation('x', 360)).toEqual(IDENTITY_ROTATION)
  })

  it('composeRotations は後ろに書いたものから当てる', () => {
    const m = composeRotations(axisRotation('y', 90), axisRotation('z', 90))
    // まず z で東 → 上、次に y では上は動かない
    expect(rotateVector(m, [1, 0, 0])).toEqual([0, 1, 0])
    // まず z で上 → 西、次に y で西 → 南
    expect(rotateVector(m, [0, 1, 0])).toEqual([0, 0, 1])
  })
})
