import type { NbtDocument, NbtTag } from '../../domain/nbt'
import { encodeMutf8 } from './mutf8'
import { tagIdFromType } from './tagIds'

/** 書き出せない値があったときの例外 */
export class NbtWriteError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NbtWriteError'
  }
}

/**
 * NBT を圧縮せずにバイト列にする（ビッグエンディアン、Java 版の形式）。
 * 値が型の範囲を超えているときは、黙って切り詰めずに例外を投げる。
 */
export function writeNbt(doc: NbtDocument): Uint8Array {
  const w = new ByteWriter()
  w.u8(tagIdFromType('compound'))
  w.str(doc.name, '(名前)')
  writePayload(w, doc.root, '')
  return w.bytes()
}

function writePayload(w: ByteWriter, tag: NbtTag, path: string): void {
  switch (tag.type) {
    case 'byte':
      w.i8(checkInt(tag.value, -0x80, 0x7f, tag.type, path))
      break
    case 'short':
      w.i16(checkInt(tag.value, -0x8000, 0x7fff, tag.type, path))
      break
    case 'int':
      w.i32(checkInt(tag.value, -0x80000000, 0x7fffffff, tag.type, path))
      break
    case 'long':
      w.i64(checkLong(tag.value, path))
      break
    case 'float':
      w.f32(tag.value)
      break
    case 'double':
      w.f64(tag.value)
      break
    case 'string':
      w.str(tag.value, path)
      break
    case 'byteArray':
      w.i32(tag.value.length)
      w.raw(new Uint8Array(tag.value.buffer, tag.value.byteOffset, tag.value.byteLength))
      break
    case 'intArray':
      w.i32(tag.value.length)
      for (const v of tag.value) w.i32(v)
      break
    case 'longArray':
      w.i32(tag.value.length)
      for (const v of tag.value) w.i64(v)
      break
    case 'list': {
      const { elementType, value } = tag
      if (value.length > 0 && elementType === 'end') {
        throw new NbtWriteError(`${pathLabel(path)}: 要素型が End のリストに要素があります。`)
      }
      w.u8(tagIdFromType(elementType))
      w.i32(value.length)
      value.forEach((item, i) => {
        const itemPath = `${path}[${i}]`
        if (item.type !== elementType) {
          throw new NbtWriteError(
            `${pathLabel(itemPath)}: リストの要素型は ${elementType} ですが、${item.type} の要素があります。`,
          )
        }
        writePayload(w, item, itemPath)
      })
      break
    }
    case 'compound':
      for (const [key, item] of tag.value) {
        const itemPath = path === '' ? key : `${path}.${key}`
        w.u8(tagIdFromType(item.type))
        w.str(key, itemPath)
        writePayload(w, item, itemPath)
      }
      w.u8(tagIdFromType('end'))
      break
  }
}

function checkInt(v: number, min: number, max: number, type: string, path: string): number {
  if (!Number.isInteger(v) || v < min || v > max) {
    throw new NbtWriteError(`${pathLabel(path)}: ${v} は ${type} の範囲（${min}〜${max}）に入りません。`)
  }
  return v
}

function checkLong(v: bigint, path: string): bigint {
  if (BigInt.asIntN(64, v) !== v) {
    throw new NbtWriteError(`${pathLabel(path)}: ${v} は long の範囲に入りません。`)
  }
  return v
}

function pathLabel(path: string): string {
  return path === '' ? '(一番上)' : path
}

class ByteWriter {
  private buf = new Uint8Array(1024)
  private dv = new DataView(this.buf.buffer)
  private n = 0

  u8(v: number): void {
    const p = this.reserve(1)
    this.dv.setUint8(p, v)
  }
  i8(v: number): void {
    const p = this.reserve(1)
    this.dv.setInt8(p, v)
  }
  i16(v: number): void {
    const p = this.reserve(2)
    this.dv.setInt16(p, v)
  }
  i32(v: number): void {
    const p = this.reserve(4)
    this.dv.setInt32(p, v)
  }
  i64(v: bigint): void {
    const p = this.reserve(8)
    this.dv.setBigInt64(p, v)
  }
  f32(v: number): void {
    const p = this.reserve(4)
    this.dv.setFloat32(p, v)
  }
  f64(v: number): void {
    const p = this.reserve(8)
    this.dv.setFloat64(p, v)
  }
  str(s: string, path: string): void {
    const b = encodeMutf8(s)
    if (b.length > 0xffff) {
      throw new NbtWriteError(`${pathLabel(path)}: 文字列が長すぎます（${b.length} バイト。65535 バイトまで）。`)
    }
    const p = this.reserve(2)
    this.dv.setUint16(p, b.length)
    this.raw(b)
  }
  raw(b: Uint8Array): void {
    const p = this.reserve(b.length)
    this.buf.set(b, p)
  }

  bytes(): Uint8Array {
    return this.buf.slice(0, this.n)
  }

  /** k バイト分の場所を確保して、書く位置を返す。buf と dv は作り直すことがあるので、呼んだ後に参照する */
  private reserve(k: number): number {
    if (this.n + k > this.buf.length) {
      const next = new Uint8Array(Math.max(this.buf.length * 2, this.n + k))
      next.set(this.buf.subarray(0, this.n))
      this.buf = next
      this.dv = new DataView(next.buffer)
    }
    const p = this.n
    this.n += k
    return p
  }
}
