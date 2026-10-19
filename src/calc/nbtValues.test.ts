import { describe, expect, it } from 'vitest'
import { nbt } from '../domain/nbt'
import { nbtBoolean, nbtCompound, nbtNumber, nbtPos, nbtString } from './nbtValues'

const data = nbt.compound({
  ScrollValue: nbt.int(64),
  EnginePower: nbt.float(0.5),
  Big: nbt.long(5n),
  Backwards: nbt.byte(1),
  EngineType: nbt.string('create:steam_engine'),
  Network: nbt.compound({ Size: nbt.int(3) }),
  NewPos: nbt.intArray([1, 2, 3]),
  OldPos: nbt.compound({ X: nbt.int(-1), Y: nbt.int(64), Z: nbt.int(7) }),
})

describe('nbt から値を読む', () => {
  it('数・文字列・真偽・compound', () => {
    expect(nbtNumber(data, 'ScrollValue')).toBe(64)
    expect(nbtNumber(data, 'EnginePower')).toBe(0.5)
    expect(nbtNumber(data, 'Big')).toBe(5)
    expect(nbtBoolean(data, 'Backwards')).toBe(true)
    expect(nbtString(data, 'EngineType')).toBe('create:steam_engine')
    expect(nbtNumber(nbtCompound(data, 'Network'), 'Size')).toBe(3)
  })

  it('ないとき・型が違うとき・生データがないときは null', () => {
    expect(nbtNumber(data, 'Missing')).toBeNull()
    expect(nbtNumber(data, 'EngineType')).toBeNull()
    expect(nbtString(data, 'ScrollValue')).toBeNull()
    expect(nbtNumber(null, 'ScrollValue')).toBeNull()
    expect(nbtCompound(data, 'ScrollValue')).toBeNull()
  })

  it('位置は int 配列と {X, Y, Z} の両方を読む', () => {
    expect(nbtPos(data, 'NewPos')).toEqual([1, 2, 3])
    expect(nbtPos(data, 'OldPos')).toEqual([-1, 64, 7])
    expect(nbtPos(data, 'ScrollValue')).toBeNull()
  })
})
