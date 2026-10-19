import { describe, expect, it } from 'vitest'
import { nbt } from '../../domain/nbt'
import { ARRAY_PREVIEW_LIMIT, nbtTreeNode, nbtValueText } from './nbtTree'

describe('nbtValueText', () => {
  it('数値は型が分かる接尾辞を付ける', () => {
    expect(nbtValueText(nbt.byte(1))).toBe('1b')
    expect(nbtValueText(nbt.short(-2))).toBe('-2s')
    expect(nbtValueText(nbt.int(3))).toBe('3')
    expect(nbtValueText(nbt.long(9007199254740993n))).toBe('9007199254740993L')
    expect(nbtValueText(nbt.double(0.1))).toBe('0.1d')
  })

  it('float は 32bit の値を短く書く', () => {
    expect(nbtValueText(nbt.float(Math.fround(0.1)))).toBe('0.1f')
    expect(nbtValueText(nbt.float(Math.fround(12.5)))).toBe('12.5f')
    expect(nbtValueText(nbt.float(Math.fround(1 / 3)))).toBe('0.33333334f')
    expect(nbtValueText(nbt.float(Number.NaN))).toBe('NaNf')
  })

  it('文字列は引用符で囲み、エスケープする', () => {
    expect(nbtValueText(nbt.string('a"b'))).toBe('"a\\"b"')
    expect(nbtValueText(nbt.string(''))).toBe('""')
  })

  it('配列は種類と値を出し、多いときは残りの数を書く', () => {
    expect(nbtValueText(nbt.byteArray([1, -1]))).toBe('[B; 1b, -1b]')
    expect(nbtValueText(nbt.intArray([1, 2, 3]))).toBe('[I; 1, 2, 3]')
    expect(nbtValueText(nbt.longArray([5n]))).toBe('[L; 5L]')
    expect(nbtValueText(nbt.intArray([]))).toBe('[I; ]')
    const many = nbtValueText(nbt.intArray(Array.from({ length: ARRAY_PREVIEW_LIMIT + 5 }, (_, i) => i)))
    expect(many.endsWith(`${ARRAY_PREVIEW_LIMIT - 1}, …ほか 5 個]`)).toBe(true)
  })
})

describe('nbtTreeNode', () => {
  it('Compound とリストの中身を、順番と型を保って並べる', () => {
    const root = nbt.compound([
      ['Speed', nbt.float(64)],
      ['Network', nbt.compound({ Id: nbt.long(7n), Size: nbt.int(3) })],
      ['Items', nbt.list('compound', [nbt.compound({ Count: nbt.byte(1) })])],
      ['Empty', nbt.list('end')],
    ])
    const node = nbtTreeNode('', root)
    expect(node.typeLabel).toBe('compound')
    expect(node.text).toBe('4 項目')
    expect(node.children?.map((c) => [c.label, c.typeLabel, c.text])).toEqual([
      ['Speed', 'float', '64f'],
      ['Network', 'compound', '2 項目'],
      ['Items', 'list<compound>', '1 個'],
      ['Empty', 'list<end>', '0 個'],
    ])
    const network = node.children?.[1]
    expect(network?.children?.map((c) => [c.label, c.type, c.text])).toEqual([
      ['Id', 'long', '7L'],
      ['Size', 'int', '3'],
    ])
    const item = node.children?.[2]?.children?.[0]
    expect(item?.label).toBe('[0]')
    expect(item?.children?.[0]).toEqual({ label: 'Count', type: 'byte', typeLabel: 'byte', text: '1b', children: null })
    expect(node.children?.[3]?.children).toEqual([])
  })
})
