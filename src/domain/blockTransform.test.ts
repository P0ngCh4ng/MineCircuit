import { describe, expect, it } from 'vitest'
import {
  boxPivot,
  inverseTransformDirection,
  inverseTransformPos,
  mirrorWithin,
  rotationAbout,
  transformBox,
  transformDirection,
  transformPoint,
  transformPos,
  type BlockTransform,
} from './blockTransform'
import { boxFromCorners } from './box'
import { HORIZONTAL_DIRECTIONS } from './direction'
import type { Vec3 } from './vec3'

describe('blockTransform', () => {
  const box = boxFromCorners([0, 0, 0], [3, 1, 1]) // 4×2×2

  it('中心のマスは、中心が2つのマスの間なら小さい側', () => {
    expect(boxPivot(box)).toEqual([1, 0, 0])
    expect(boxPivot(boxFromCorners([0, 0, 0], [2, 2, 2]))).toEqual([1, 1, 1])
  })

  it('右回りの 90° で north は east に、範囲の x と z の大きさが入れ替わる', () => {
    const t = rotationAbout(box, 1)
    expect(transformDirection(t, 'north')).toBe('east')
    expect(transformDirection(t, 'up')).toBe('up')
    // 中心のマスは動かない
    expect(transformPos(t, [1, 0, 0])).toEqual([1, 0, 0])
    // 東（+x）にあったマスは南（+z）へ
    expect(transformPos(t, [2, 0, 0])).toEqual([1, 0, 1])
    const rotated = transformBox(t, box)
    expect(rotated).toEqual(boxFromCorners([0, 0, -1], [1, 1, 2]))
  })

  it('4回回すと元の範囲に戻る', () => {
    let b = box
    for (let i = 0; i < 4; i++) b = transformBox(rotationAbout(box, 1), b)
    expect(b).toEqual(box)
  })

  it('範囲の中での反転は、幅が偶数でも範囲を動かさない', () => {
    const t = mirrorWithin(box, 'x')
    expect(transformBox(t, box)).toEqual(box)
    expect(transformPos(t, [0, 1, 1])).toEqual([3, 1, 1])
    expect(transformDirection(t, 'east')).toBe('west')
    expect(transformDirection(t, 'north')).toBe('north')
    expect(transformDirection(mirrorWithin(box, 'z'), 'north')).toBe('south')
  })

  it('マスの中心は、連続な位置の変換でも中心に移る', () => {
    const t = rotationAbout(box, 1)
    expect(transformPoint(t, [2.5, 0.5, 0.5])).toEqual([1.5, 0.5, 1.5])
  })

  it('逆の変換で元に戻る（反転と回転を組み合わせても）', () => {
    const t: BlockTransform = { translate: [3, -1, 2], quarterTurns: 3, mirror: 'z', pivot: [1, 0, 2] }
    const p: Vec3 = [5, 2, -4]
    expect(inverseTransformPos(t, transformPos(t, p))).toEqual(p)
    for (const d of HORIZONTAL_DIRECTIONS) expect(inverseTransformDirection(t, transformDirection(t, d))).toBe(d)
  })
})
