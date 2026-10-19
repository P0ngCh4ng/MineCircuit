import { describe, expect, it } from 'vitest'
import { nbt } from '../../domain/nbt'
import { nbtEquals } from './nbtEquals'

describe('nbtEquals', () => {
  const sample = () =>
    nbt.compound({
      b: nbt.byte(1),
      s: nbt.short(2),
      i: nbt.int(3),
      l: nbt.long(4n),
      f: nbt.float(0.1),
      d: nbt.double(Number.NaN),
      ba: nbt.byteArray([1, 2]),
      str: nbt.string('あ'),
      list: nbt.list('int', [nbt.int(1)]),
      empty: nbt.list('end'),
      ia: nbt.intArray([5]),
      la: nbt.longArray([6n]),
    })

  it('全タグ型で、同じ内容なら true', () => {
    expect(nbtEquals(sample(), sample())).toBe(true)
  })

  it('項目の並びは比べない', () => {
    expect(nbtEquals(nbt.compound({ a: nbt.int(1), b: nbt.int(2) }), nbt.compound({ b: nbt.int(2), a: nbt.int(1) }))).toBe(true)
  })

  it('float は 32 ビットに丸めて比べる', () => {
    expect(nbtEquals(nbt.float(0.1), nbt.float(Math.fround(0.1)))).toBe(true)
    expect(nbtEquals(nbt.double(0.1), nbt.double(Math.fround(0.1)))).toBe(false)
  })

  it('型・値・要素型・項目の違いを見つける', () => {
    expect(nbtEquals(nbt.int(1), nbt.short(1))).toBe(false)
    expect(nbtEquals(nbt.long(1n), nbt.long(2n))).toBe(false)
    expect(nbtEquals(nbt.intArray([1, 2]), nbt.intArray([1, 3]))).toBe(false)
    expect(nbtEquals(nbt.list('end'), nbt.list('compound'))).toBe(false)
    expect(nbtEquals(nbt.list('int', [nbt.int(1)]), nbt.list('int', [nbt.int(1), nbt.int(2)]))).toBe(false)
    expect(nbtEquals(nbt.compound({ a: nbt.int(1) }), nbt.compound({ b: nbt.int(1) }))).toBe(false)
    expect(nbtEquals(nbt.compound({ a: nbt.int(1) }), nbt.compound({ a: nbt.int(1), b: nbt.int(1) }))).toBe(false)
  })
})
