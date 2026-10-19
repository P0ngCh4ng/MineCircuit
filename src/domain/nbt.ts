// NBT の値の型。ファイルにある型（byte / short / int など）を失わないように、
// 値ごとに型の名前を持たせる。読み書きは io/nbt/ で行う。この層は他の層に依存しない。

/** NBT のタグ型の名前。`end` は空のリストの要素型としてだけ現れる */
export type NbtTagType =
  | 'end'
  | 'byte'
  | 'short'
  | 'int'
  | 'long'
  | 'float'
  | 'double'
  | 'byteArray'
  | 'string'
  | 'list'
  | 'compound'
  | 'intArray'
  | 'longArray'

export interface NbtByte {
  readonly type: 'byte'
  value: number
}
export interface NbtShort {
  readonly type: 'short'
  value: number
}
export interface NbtInt {
  readonly type: 'int'
  value: number
}
/** Long は精度を失わないように bigint で持つ */
export interface NbtLong {
  readonly type: 'long'
  value: bigint
}
export interface NbtFloat {
  readonly type: 'float'
  value: number
}
export interface NbtDouble {
  readonly type: 'double'
  value: number
}
export interface NbtByteArray {
  readonly type: 'byteArray'
  value: Int8Array
}
export interface NbtString {
  readonly type: 'string'
  value: string
}
/**
 * リスト。要素型 `elementType` を別に持つので、空のリストでも型が残る。
 * 要素が1つ以上あるときは、全要素の type が elementType と同じであること。
 */
export interface NbtList {
  readonly type: 'list'
  elementType: NbtTagType
  value: NbtTag[]
}
/** Compound。項目の順番を保つため Map で持つ */
export interface NbtCompound {
  readonly type: 'compound'
  value: Map<string, NbtTag>
}
export interface NbtIntArray {
  readonly type: 'intArray'
  value: Int32Array
}
export interface NbtLongArray {
  readonly type: 'longArray'
  value: BigInt64Array
}

export type NbtTag =
  | NbtByte
  | NbtShort
  | NbtInt
  | NbtLong
  | NbtFloat
  | NbtDouble
  | NbtByteArray
  | NbtString
  | NbtList
  | NbtCompound
  | NbtIntArray
  | NbtLongArray

/**
 * 生データ。ブロックエンティティ、エンティティ、解釈していない項目などを
 * 中身を解釈せずにそのまま持つときの型。
 */
export type RawNbt = NbtCompound

/** NBT ファイル1つ分。一番上の Compound と、その名前（設計図では通常は空文字） */
export interface NbtDocument {
  name: string
  root: NbtCompound
}

// 値を作る関数。テストや書き出しで使う
export const nbt = {
  byte: (value: number): NbtByte => ({ type: 'byte', value }),
  short: (value: number): NbtShort => ({ type: 'short', value }),
  int: (value: number): NbtInt => ({ type: 'int', value }),
  long: (value: bigint): NbtLong => ({ type: 'long', value }),
  float: (value: number): NbtFloat => ({ type: 'float', value }),
  double: (value: number): NbtDouble => ({ type: 'double', value }),
  byteArray: (value: ArrayLike<number>): NbtByteArray => ({ type: 'byteArray', value: Int8Array.from(value) }),
  string: (value: string): NbtString => ({ type: 'string', value }),
  list: (elementType: NbtTagType, value: NbtTag[] = []): NbtList => ({ type: 'list', elementType, value }),
  compound: (entries: Iterable<readonly [string, NbtTag]> | Record<string, NbtTag> = []): NbtCompound => ({
    type: 'compound',
    value: new Map(isIterable(entries) ? entries : Object.entries(entries)),
  }),
  intArray: (value: ArrayLike<number>): NbtIntArray => ({ type: 'intArray', value: Int32Array.from(value) }),
  longArray: (value: ArrayLike<bigint>): NbtLongArray => ({ type: 'longArray', value: BigInt64Array.from(value) }),
}

function isIterable<T>(v: Iterable<T> | object): v is Iterable<T> {
  return Symbol.iterator in v
}
