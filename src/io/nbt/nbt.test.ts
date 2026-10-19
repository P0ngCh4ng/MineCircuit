import { describe, expect, it } from 'vitest'
import { nbt, type NbtCompound, type NbtDocument, type NbtTag, type NbtTagType } from '../../domain/nbt'
import {
  NbtParseError,
  NbtWriteError,
  gunzip,
  gzip,
  isGzip,
  parseNbtFile,
  readNbt,
  serializeNbtFile,
  writeNbt,
} from './index'
import { decodeMutf8, encodeMutf8 } from './mutf8'

function doc(root: NbtCompound, name = ''): NbtDocument {
  return { name, root }
}

/** 書き出して読み直し、元と一致することと、もう一度書き出したバイト列が同じことを確かめる */
function expectRoundTrip(d: NbtDocument): void {
  const bytes = writeNbt(d)
  const back = readNbt(bytes)
  expect(back).toEqual(d)
  expect(writeNbt(back)).toEqual(bytes)
}

/** 全タグ型を含む Compound */
function allTypes(): NbtCompound {
  return nbt.compound([
    ['byte', nbt.byte(-5)],
    ['short', nbt.short(-1234)],
    ['int', nbt.int(123456789)],
    ['long', nbt.long(-9007199254740993n)],
    ['float', nbt.float(Math.fround(0.1))],
    ['double', nbt.double(0.1)],
    ['byteArray', nbt.byteArray([-128, -1, 0, 1, 127])],
    ['string', nbt.string('create:cogwheel')],
    ['list', nbt.list('int', [nbt.int(1), nbt.int(2)])],
    ['compound', nbt.compound({ Name: nbt.string('minecraft:stone') })],
    ['intArray', nbt.intArray([-2147483648, 0, 2147483647])],
    ['longArray', nbt.longArray([-(2n ** 63n), 0n, 2n ** 63n - 1n])],
  ])
}

describe('NBT の読み書き', () => {
  it('全タグ型を書き出して読み直すと一致する', () => {
    expectRoundTrip(doc(allTypes(), 'root'))
  })

  it('読み直した値が型の名前を保つ（数値の型を区別する）', () => {
    const back = readNbt(writeNbt(doc(allTypes())))
    const types = [...back.root.value].map(([k, v]) => [k, v.type])
    expect(types).toEqual([...allTypes().value].map(([k]) => [k, k]))
    expect(back.root.value.get('byteArray')?.value).toBeInstanceOf(Int8Array)
    expect(back.root.value.get('intArray')?.value).toBeInstanceOf(Int32Array)
    expect(back.root.value.get('longArray')?.value).toBeInstanceOf(BigInt64Array)
  })

  it('整数型の境界の値を保つ', () => {
    expectRoundTrip(
      doc(
        nbt.compound([
          ['b0', nbt.byte(-128)],
          ['b1', nbt.byte(127)],
          ['s0', nbt.short(-32768)],
          ['s1', nbt.short(32767)],
          ['i0', nbt.int(-2147483648)],
          ['i1', nbt.int(2147483647)],
        ]),
      ),
    )
  })

  it('Long が精度を失わない（BigInt）', () => {
    const values = [-(2n ** 63n), 2n ** 63n - 1n, 2n ** 53n + 1n, -1n, 0n]
    const root = nbt.compound(values.map((v, i) => [`l${i}`, nbt.long(v)] as const))
    const back = readNbt(writeNbt(doc(root)))
    for (const [i, v] of values.entries()) {
      const tag = back.root.value.get(`l${i}`)
      expect(tag?.type).toBe('long')
      expect(tag?.value).toBe(v)
    }
  })

  it('浮動小数の特別な値を保つ（-0、無限大、NaN）', () => {
    const special = [-0, Infinity, -Infinity, NaN, Number.MIN_VALUE, Number.MAX_VALUE]
    const root = nbt.compound(special.map((v, i) => [`d${i}`, nbt.double(v)] as const))
    for (const [i, v] of [-0, Infinity, -Infinity, NaN, 1.5].entries()) root.value.set(`f${i}`, nbt.float(v))
    const back = readNbt(writeNbt(doc(root)))
    for (const [i, v] of special.entries()) expect(Object.is(back.root.value.get(`d${i}`)?.value, v)).toBe(true)
    expect(Object.is(back.root.value.get('f0')?.value, -0)).toBe(true)
    expect(Number.isNaN(back.root.value.get('f3')?.value)).toBe(true)
  })

  it('空のリストの要素型を保つ', () => {
    const types: NbtTagType[] = [
      'end',
      'byte',
      'short',
      'int',
      'long',
      'float',
      'double',
      'byteArray',
      'string',
      'list',
      'compound',
      'intArray',
      'longArray',
    ]
    const root = nbt.compound(types.map((t) => [t, nbt.list(t)] as const))
    const back = readNbt(writeNbt(doc(root)))
    for (const t of types) {
      const tag = back.root.value.get(t)
      expect(tag).toEqual({ type: 'list', elementType: t, value: [] })
    }
  })

  it('入れ子のリストと Compound を保つ', () => {
    const root = nbt.compound({
      lists: nbt.list('list', [nbt.list('string', [nbt.string('a')]), nbt.list('end'), nbt.list('double', [nbt.double(1)])]),
      blocks: nbt.list('compound', [
        nbt.compound({ pos: nbt.list('int', [nbt.int(0), nbt.int(1), nbt.int(2)]), state: nbt.int(0) }),
        nbt.compound({ nbt: nbt.compound({ Speed: nbt.float(32), Network: nbt.compound({ Size: nbt.int(3) }) }) }),
      ]),
      emptyArrays: nbt.compound({ b: nbt.byteArray([]), i: nbt.intArray([]), l: nbt.longArray([]) }),
    })
    expectRoundTrip(doc(root))
  })

  it('Compound の項目の順番を保つ', () => {
    const keys = ['z', 'a', 'm', '__proto__', 'constructor', '0', '']
    const root = nbt.compound(keys.map((k) => [k, nbt.byte(1)] as const))
    expect([...readNbt(writeNbt(doc(root))).root.value.keys()]).toEqual(keys)
  })

  it('いろいろな文字列を保つ（空、日本語、絵文字、NUL）', () => {
    const strings = ['', 'abc', '歯車', '😀 絵文字', 'a\u0000b', '￿', 'é'.repeat(1000)]
    const root = nbt.compound(strings.map((s, i) => [`s${i}`, nbt.string(s)] as const))
    root.value.set('キー', nbt.string('値'))
    expectRoundTrip(doc(root, '名前'))
  })

  it('仕様の例のバイト列（hello world）を読める', () => {
    const name = 'hello world'
    const bytes = new Uint8Array([
      0x0a, 0x00, name.length, ...new TextEncoder().encode(name),
      0x08, 0x00, 0x04, ...new TextEncoder().encode('name'),
      0x00, 0x0d, ...new TextEncoder().encode('Bancho Stelar'),
      0x00,
    ])
    const d = readNbt(bytes)
    expect(d).toEqual(doc(nbt.compound({ name: nbt.string('Bancho Stelar') }), 'hello world'))
    expect(writeNbt(d)).toEqual(bytes)
  })

  it('大きなデータ（数万要素）を保つ', () => {
    const blocks = Array.from({ length: 20000 }, (_, i) =>
      nbt.compound({ pos: nbt.list('int', [nbt.int(i % 40), nbt.int(i >> 10), nbt.int((i >> 5) % 32)]), state: nbt.int(i % 7) }),
    )
    const root = nbt.compound({
      blocks: nbt.list('compound', blocks),
      data: nbt.longArray(Array.from({ length: 5000 }, (_, i) => BigInt(i) * 0x123456789n)),
    })
    expectRoundTrip(doc(root))
    // CI の遅い環境では 5 秒を超えることがあるので長めにする
  }, 30_000)

  it('数値をビッグエンディアンで書く', () => {
    const bytes = writeNbt(doc(nbt.compound({ v: nbt.int(0x01020304) })))
    // 0a 0000 | 03 0001 'v' | 01 02 03 04 | 00
    expect([...bytes]).toEqual([0x0a, 0, 0, 0x03, 0, 1, 0x76, 1, 2, 3, 4, 0])
  })
})

describe('Modified UTF-8', () => {
  it('NUL を 0xC0 0x80 で表す', () => {
    expect([...encodeMutf8('\u0000')]).toEqual([0xc0, 0x80])
  })

  it('U+10000 以上の文字をサロゲートペアの各半分 3 バイトずつで表す', () => {
    const b = encodeMutf8('😀')
    expect([...b]).toEqual([0xed, 0xa0, 0xbd, 0xed, 0xb8, 0x80])
    expect(decodeMutf8(b)).toBe('😀')
  })

  it('壊れたバイト列は例外にする', () => {
    expect(() => decodeMutf8(new Uint8Array([0xc3]))).toThrow()
    expect(() => decodeMutf8(new Uint8Array([0xff]))).toThrow()
  })
})

describe('gzip', () => {
  it('圧縮して展開すると元に戻る', async () => {
    const raw = writeNbt(doc(allTypes()))
    const gz = await gzip(raw)
    expect(isGzip(gz)).toBe(true)
    expect(isGzip(raw)).toBe(false)
    expect(await gunzip(gz)).toEqual(raw)
  })

  it('parseNbtFile は gzip と非圧縮の両方を読む', async () => {
    const d = doc(allTypes())
    const gz = await serializeNbtFile(d)
    const plain = await serializeNbtFile(d, { compress: false })
    expect(isGzip(gz)).toBe(true)
    expect(isGzip(plain)).toBe(false)
    expect(await parseNbtFile(gz)).toEqual({ ...d, compressed: true })
    expect(await parseNbtFile(plain)).toEqual({ ...d, compressed: false })
  })

  it('読み込み → 書き出し → 読み込みで一致する', async () => {
    const first = await parseNbtFile(await serializeNbtFile(doc(allTypes(), 'x')))
    const second = await parseNbtFile(await serializeNbtFile(first))
    expect(second).toEqual(first)
    expect(writeNbt(second)).toEqual(writeNbt(first))
  })

  it('壊れた gzip は NbtParseError にする', async () => {
    const gz = await gzip(writeNbt(doc(allTypes())))
    await expect(parseNbtFile(gz.subarray(0, gz.length - 10))).rejects.toBeInstanceOf(NbtParseError)
  })
})

describe('読み込みのエラー', () => {
  it('途中で終わっているデータ', () => {
    const bytes = writeNbt(doc(allTypes()))
    for (const n of [0, 1, 3, 10, bytes.length - 1]) {
      expect(() => readNbt(bytes.subarray(0, n))).toThrow(NbtParseError)
    }
  })

  it('先頭が Compound でない', () => {
    expect(() => readNbt(new Uint8Array([0x08, 0, 0, 0, 0]))).toThrow(/Compound/)
  })

  it('不明なタグ番号', () => {
    expect(() => readNbt(new Uint8Array([0x0a, 0, 0, 0x0d, 0, 0]))).toThrow(/不明なタグ番号 13/)
  })

  it('負の長さ', () => {
    expect(() => readNbt(new Uint8Array([0x0a, 0, 0, 0x0b, 0, 0, 0xff, 0xff, 0xff, 0xff, 0]))).toThrow(/負/)
  })

  it('入れ子が深すぎる', () => {
    let tag = nbt.compound()
    for (let i = 0; i < 600; i++) tag = nbt.compound({ c: tag })
    // 書き出しは深さを制限しないが、読み込みは 512 段で止める
    expect(() => readNbt(writeNbt(doc(tag)))).toThrow(/深すぎ/)
  })
})

describe('書き出しのエラー', () => {
  const cases: [string, NbtTag][] = [
    ['byte の範囲外', nbt.byte(128)],
    ['short の範囲外', nbt.short(-32769)],
    ['int の範囲外', nbt.int(2 ** 31)],
    ['整数でない int', nbt.int(1.5)],
    ['long の範囲外', nbt.long(2n ** 63n)],
    ['要素型と違う要素', nbt.list('int', [nbt.int(1), nbt.byte(1)])],
    ['要素型が End で要素がある', nbt.list('end', [nbt.int(1)])],
    ['長すぎる文字列', nbt.string('a'.repeat(65536))],
  ]
  for (const [label, tag] of cases) {
    it(label, () => {
      expect(() => writeNbt(doc(nbt.compound({ v: tag })))).toThrow(NbtWriteError)
    })
  }

  it('エラーに項目の場所を書く', () => {
    const root = nbt.compound({ a: nbt.list('compound', [nbt.compound({ b: nbt.byte(999) })]) })
    expect(() => writeNbt(doc(root))).toThrow(/a\[0\]\.b/)
  })
})
