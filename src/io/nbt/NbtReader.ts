import type { NbtCompound, NbtDocument, NbtTag, NbtTagType } from '../../domain/nbt'
import { decodeMutf8 } from './mutf8'
import { tagTypeFromId } from './tagIds'

/** 入れ子の深さの上限。Minecraft 本体と同じ 512 */
const MAX_DEPTH = 512

/** NBT が読めなかったときの例外 */
export class NbtParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NbtParseError'
  }
}

/**
 * 圧縮していない NBT のバイト列を読む（ビッグエンディアン、Java 版の形式）。
 * 一番上は名前付きの Compound であること。
 */
export function readNbt(bytes: Uint8Array): NbtDocument {
  const r = new ByteReader(bytes)
  try {
    const rootType = tagTypeFromId(r.u8())
    if (rootType !== 'compound') {
      throw new NbtParseError('NBT の先頭が Compound ではありません。設計図（.nbt）のファイルか確かめてください。')
    }
    const name = r.str()
    // Minecraft 本体と同じく、Compound の後ろに続くデータは読まない
    const root = readPayload(r, 'compound', 0) as NbtCompound
    return { name, root }
  } catch (e) {
    if (e instanceof NbtParseError) throw e
    if (e instanceof RangeError) {
      throw new NbtParseError('NBT が途中で終わっています。ファイルが壊れているか、途中までしか保存されていません。')
    }
    throw new NbtParseError(`NBT を読めませんでした: ${e instanceof Error ? e.message : String(e)}`)
  }
}

function readPayload(r: ByteReader, type: NbtTagType, depth: number): NbtTag {
  switch (type) {
    case 'byte':
      return { type, value: r.i8() }
    case 'short':
      return { type, value: r.i16() }
    case 'int':
      return { type, value: r.i32() }
    case 'long':
      return { type, value: r.i64() }
    case 'float':
      return { type, value: r.f32() }
    case 'double':
      return { type, value: r.f64() }
    case 'string':
      return { type, value: r.str() }
    case 'byteArray': {
      const n = r.length(1)
      return { type, value: new Int8Array(r.take(n)) }
    }
    case 'intArray': {
      const n = r.length(4)
      const a = new Int32Array(n)
      for (let i = 0; i < n; i++) a[i] = r.i32()
      return { type, value: a }
    }
    case 'longArray': {
      const n = r.length(8)
      const a = new BigInt64Array(n)
      for (let i = 0; i < n; i++) a[i] = r.i64()
      return { type, value: a }
    }
    case 'list': {
      checkDepth(depth)
      const elementType = readTagType(r)
      const n = r.length(1)
      if (n > 0 && elementType === 'end') throw new NbtParseError('要素型が End のリストに要素があります。')
      const value: NbtTag[] = []
      for (let i = 0; i < n; i++) value.push(readPayload(r, elementType, depth + 1))
      return { type, elementType, value }
    }
    case 'compound': {
      checkDepth(depth)
      const value = new Map<string, NbtTag>()
      for (;;) {
        const t = readTagType(r)
        if (t === 'end') break
        const key = r.str()
        value.set(key, readPayload(r, t, depth + 1))
      }
      return { type, value }
    }
    case 'end':
      throw new NbtParseError('End タグを値として読もうとしました。')
  }
}

function readTagType(r: ByteReader): NbtTagType {
  const id = r.u8()
  const t = tagTypeFromId(id)
  if (t === null) throw new NbtParseError(`不明なタグ番号 ${id} があります（位置 ${r.pos - 1}）。`)
  return t
}

function checkDepth(depth: number): void {
  if (depth >= MAX_DEPTH) throw new NbtParseError(`NBT の入れ子が深すぎます（${MAX_DEPTH} 段まで）。`)
}

class ByteReader {
  pos = 0
  private readonly dv: DataView

  constructor(private readonly bytes: Uint8Array) {
    this.dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  }

  u8(): number {
    return this.dv.getUint8(this.advance(1))
  }
  i8(): number {
    return this.dv.getInt8(this.advance(1))
  }
  i16(): number {
    return this.dv.getInt16(this.advance(2))
  }
  i32(): number {
    return this.dv.getInt32(this.advance(4))
  }
  i64(): bigint {
    return this.dv.getBigInt64(this.advance(8))
  }
  f32(): number {
    return this.dv.getFloat32(this.advance(4))
  }
  f64(): number {
    return this.dv.getFloat64(this.advance(8))
  }
  str(): string {
    const n = this.dv.getUint16(this.advance(2))
    return decodeMutf8(this.take(n))
  }

  /** 配列やリストの長さ（int）を読み、残りのデータに収まるか確かめる */
  length(minBytesPerItem: number): number {
    const n = this.i32()
    if (n < 0) throw new NbtParseError(`長さが負の値です（${n}）。`)
    if (n * minBytesPerItem > this.bytes.length - this.pos) throw new RangeError('長さがデータの残りを超えています')
    return n
  }

  take(n: number): Uint8Array {
    const start = this.advance(n)
    return this.bytes.subarray(start, start + n)
  }

  private advance(n: number): number {
    const p = this.pos
    if (p + n > this.bytes.length) throw new RangeError('データの終わりを超えて読もうとしました')
    this.pos = p + n
    return p
  }
}
