import { describe, it, expect } from 'vitest'
import {
  DIRECTIONS,
  HORIZONTAL_DIRECTIONS,
  directionVector,
  isDirection,
  oppositeDirection,
} from './direction'
import { addVec3, equalsVec3, subVec3 } from './vec3'

describe('Direction', () => {
  it('向きのベクトルは Minecraft と同じ', () => {
    expect(directionVector('north')).toEqual([0, 0, -1])
    expect(directionVector('south')).toEqual([0, 0, 1])
    expect(directionVector('east')).toEqual([1, 0, 0])
    expect(directionVector('west')).toEqual([-1, 0, 0])
    expect(directionVector('up')).toEqual([0, 1, 0])
    expect(directionVector('down')).toEqual([0, -1, 0])
  })

  it('6方向がそろっていて、水平は4方向', () => {
    expect(new Set(DIRECTIONS).size).toBe(6)
    expect(HORIZONTAL_DIRECTIONS).toEqual(['north', 'east', 'south', 'west'])
    for (const dir of HORIZONTAL_DIRECTIONS) expect(directionVector(dir)[1]).toBe(0)
  })

  it('反対の向きのベクトルを足すと0になる', () => {
    for (const dir of DIRECTIONS) {
      const opposite = oppositeDirection(dir)
      expect(oppositeDirection(opposite)).toBe(dir)
      expect(addVec3(directionVector(dir), directionVector(opposite))).toEqual([0, 0, 0])
    }
  })

  it('isDirection は向きの名前だけを受け付ける', () => {
    expect(isDirection('north')).toBe(true)
    expect(isDirection('up')).toBe(true)
    expect(isDirection('North')).toBe(false)
    expect(isDirection('toString')).toBe(false)
  })
})

describe('Vec3', () => {
  it('足し算・引き算・比較', () => {
    expect(addVec3([1, 2, 3], [4, 5, 6])).toEqual([5, 7, 9])
    expect(subVec3([4, 5, 6], [1, 2, 3])).toEqual([3, 3, 3])
    expect(equalsVec3([1, 2, 3], [1, 2, 3])).toBe(true)
    expect(equalsVec3([1, 2, 3], [1, 2, 4])).toBe(false)
  })
})
