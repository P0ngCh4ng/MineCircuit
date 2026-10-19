import type { NbtTag } from '../../domain/nbt'

/**
 * 2つの NBT の値が同じか。型・要素型・項目の名前と値を深く比べる。
 * Compound の項目の並びは比べない（ゲームは並びを使わない）。
 * float はファイルに 32 ビットで書くので、32 ビットに丸めた値で比べる。NaN 同士は同じとみなす。
 */
export function nbtEquals(a: NbtTag, b: NbtTag): boolean {
  if (a.type !== b.type) return false
  switch (a.type) {
    case 'byte':
    case 'short':
    case 'int':
    case 'double':
      return sameNumber(a.value, (b as typeof a).value)
    case 'float':
      return sameNumber(Math.fround(a.value), Math.fround((b as typeof a).value))
    case 'long':
    case 'string':
      return a.value === (b as typeof a).value
    case 'byteArray':
    case 'intArray':
    case 'longArray':
      return sameArray(a.value, (b as typeof a).value)
    case 'list': {
      const other = b as typeof a
      if (a.value.length !== other.value.length) return false
      // 空のリストは要素型も比べる（書き出しで要素型が変わらないことを確かめるため）
      if (a.elementType !== other.elementType) return false
      return a.value.every((item, i) => nbtEquals(item, other.value[i]))
    }
    case 'compound': {
      const other = b as typeof a
      if (a.value.size !== other.value.size) return false
      for (const [key, value] of a.value) {
        const otherValue = other.value.get(key)
        if (otherValue === undefined || !nbtEquals(value, otherValue)) return false
      }
      return true
    }
  }
}

function sameNumber(a: number, b: number): boolean {
  return a === b || (Number.isNaN(a) && Number.isNaN(b))
}

function sameArray(a: ArrayLike<number | bigint>, b: ArrayLike<number | bigint>): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}
