// 生データ（nbt）から計算に使う値を読む小さな関数。
// 値がないときや型が違うときは null を返す。null なら次の出どころ（内蔵の初期値など）に進む。

import type { NbtCompound, NbtTag, RawNbt } from '../domain/nbt'
import type { Vec3 } from '../domain/vec3'

/** 数の項目（byte / short / int / long / float / double）。long は number に直す */
export function nbtNumber(data: RawNbt | null, key: string): number | null {
  return tagNumber(data?.value.get(key))
}

/** 文字列の項目 */
export function nbtString(data: RawNbt | null, key: string): string | null {
  const tag = data?.value.get(key)
  return tag?.type === 'string' ? tag.value : null
}

/** 真偽の項目（byte の 0 / 1。Minecraft の書き方） */
export function nbtBoolean(data: RawNbt | null, key: string): boolean | null {
  const n = nbtNumber(data, key)
  return n === null ? null : n !== 0
}

/** compound の項目 */
export function nbtCompound(data: RawNbt | null, key: string): NbtCompound | null {
  const tag = data?.value.get(key)
  return tag?.type === 'compound' ? tag : null
}

/**
 * 位置の項目。1.20.5 からの int 配列 [x, y, z] と、それより前の compound {X, Y, Z} の両方を読む。
 */
export function nbtPos(data: RawNbt | null, key: string): Vec3 | null {
  const tag = data?.value.get(key)
  if (!tag) return null
  if (tag.type === 'intArray' && tag.value.length === 3) return [tag.value[0], tag.value[1], tag.value[2]]
  if (tag.type === 'compound') {
    const x = nbtNumber(tag, 'X')
    const y = nbtNumber(tag, 'Y')
    const z = nbtNumber(tag, 'Z')
    if (x !== null && y !== null && z !== null) return [x, y, z]
  }
  return null
}

function tagNumber(tag: NbtTag | undefined): number | null {
  if (!tag) return null
  switch (tag.type) {
    case 'byte':
    case 'short':
    case 'int':
    case 'float':
    case 'double':
      return tag.value
    case 'long':
      return Number(tag.value)
    default:
      return null
  }
}
