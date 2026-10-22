// PNG を RGBA の画素にする小さなデコーダー。
// Worker の中でも Vitest（Node）でも動くよう、ブラウザだけの API（createImageBitmap・OffscreenCanvas）を使わない。
// 展開は fflate の unzlibSync。
//
// 対応するもの：色の種類 すべて（グレー・RGB・パレット・グレー+α・RGBA）、
// ビット深度 1/2/4/8/16（16 は上位 8 ビットだけ使う）、tRNS（透過色）、フィルター 0〜4。
// 対応しないもの：インターレース（Adam7）。PngDecodeError にする。

import { unzlibSync } from 'fflate'

/** 展開した画像。pixels は RGBA で、上の行から */
export interface RgbaImage {
  readonly width: number
  readonly height: number
  readonly pixels: Uint8ClampedArray
}

/** PNG を読めなかった。message は日本語でそのまま出せる */
export class PngDecodeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PngDecodeError'
  }
}

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]

/** 大きすぎる画像で固まらないための上限（1辺）。Minecraft のテクスチャはこれよりずっと小さい */
export const MAX_PNG_SIDE = 8192

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

/** PNG のチャンクの CRC32（種類の 4 バイト + 中身） */
export function crc32(bytes: Uint8Array, start = 0, end = bytes.length): number {
  let c = 0xffffffff
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** 色の種類ごとの、1画素あたりのサンプル数 */
const CHANNELS: Readonly<Record<number, number>> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }
/** 色の種類ごとに許されるビット深度 */
const ALLOWED_DEPTHS: Readonly<Record<number, readonly number[]>> = {
  0: [1, 2, 4, 8, 16],
  2: [8, 16],
  3: [1, 2, 4, 8],
  4: [8, 16],
  6: [8, 16],
}

function readU32(b: Uint8Array, o: number): number {
  return ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0
}

export function decodePng(data: Uint8Array): RgbaImage {
  if (data.length < 8 || SIGNATURE.some((v, i) => data[i] !== v)) throw new PngDecodeError('PNG ではありません。')

  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = -1
  let interlace = 0
  let palette: Uint8Array | null = null
  let trns: Uint8Array | null = null
  const idat: Uint8Array[] = []
  let idatLength = 0
  let sawHeader = false

  let pos = 8
  for (;;) {
    if (pos + 12 > data.length) throw new PngDecodeError('PNG が途中で切れています。')
    const length = readU32(data, pos)
    const typeStart = pos + 4
    const bodyStart = pos + 8
    const bodyEnd = bodyStart + length
    if (bodyEnd + 4 > data.length) throw new PngDecodeError('PNG が途中で切れています。')
    if (crc32(data, typeStart, bodyEnd) !== readU32(data, bodyEnd)) throw new PngDecodeError('PNG が壊れています（CRC が合いません）。')
    const type = String.fromCharCode(data[typeStart]!, data[typeStart + 1]!, data[typeStart + 2]!, data[typeStart + 3]!)
    const body = data.subarray(bodyStart, bodyEnd)
    pos = bodyEnd + 4

    if (type === 'IHDR') {
      if (length !== 13) throw new PngDecodeError('PNG の IHDR が壊れています。')
      width = readU32(body, 0)
      height = readU32(body, 4)
      bitDepth = body[8]!
      colorType = body[9]!
      interlace = body[12]!
      sawHeader = true
    } else if (type === 'PLTE') {
      palette = body
    } else if (type === 'tRNS') {
      trns = body
    } else if (type === 'IDAT') {
      idat.push(body)
      idatLength += body.length
    } else if (type === 'IEND') {
      break
    }
  }

  if (!sawHeader) throw new PngDecodeError('PNG に IHDR がありません。')
  if (width === 0 || height === 0) throw new PngDecodeError('PNG の大きさが 0 です。')
  if (width > MAX_PNG_SIDE || height > MAX_PNG_SIDE) {
    throw new PngDecodeError(`PNG が大きすぎます（${width}×${height}。1辺 ${MAX_PNG_SIDE} まで）。`)
  }
  const channels = CHANNELS[colorType]
  if (channels === undefined || !ALLOWED_DEPTHS[colorType]!.includes(bitDepth)) {
    throw new PngDecodeError(`対応していない PNG の形式です（色の種類 ${colorType}、ビット深度 ${bitDepth}）。`)
  }
  if (interlace !== 0) throw new PngDecodeError('インターレースの PNG には対応していません。インターレースなしで保存し直してください。')
  if (colorType === 3 && palette === null) throw new PngDecodeError('PNG にパレット（PLTE）がありません。')

  const compressed = new Uint8Array(idatLength)
  let off = 0
  for (const c of idat) {
    compressed.set(c, off)
    off += c.length
  }
  let raw: Uint8Array
  try {
    raw = unzlibSync(compressed)
  } catch {
    throw new PngDecodeError('PNG の画素データを展開できませんでした。')
  }

  const bitsPerPixel = channels * bitDepth
  const bpp = Math.max(1, bitsPerPixel >> 3)
  const stride = Math.ceil((width * bitsPerPixel) / 8)
  if (raw.length < (stride + 1) * height) throw new PngDecodeError('PNG の画素データが足りません。')

  const pixels = new Uint8ClampedArray(width * height * 4)
  let prev = new Uint8Array(stride)
  let line = new Uint8Array(stride)
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1)
    const filter = raw[rowStart]!
    unfilter(filter, raw.subarray(rowStart + 1, rowStart + 1 + stride), prev, line, bpp)
    writeRow(line, y)
    const t = prev
    prev = line
    line = t
  }
  return { width, height, pixels }

  function writeRow(row: Uint8Array, y: number): void {
    const maxSample = (1 << Math.min(bitDepth, 8)) - 1
    // 8 ビット未満のサンプルを 0〜255 に広げる
    const scale = bitDepth < 8 ? 255 / maxSample : 1
    const sample = (x: number, c: number): number => {
      if (bitDepth === 8) return row[x * channels + c]!
      if (bitDepth === 16) return row[(x * channels + c) * 2]!
      const bit = (x * channels + c) * bitDepth
      const byte = row[bit >> 3]!
      return (byte >> (8 - bitDepth - (bit & 7))) & maxSample
    }
    // tRNS の透過色の比較は元のビット深度の値で行う
    const rawSample = (x: number, c: number): number => {
      if (bitDepth === 16) return (row[(x * channels + c) * 2]! << 8) | row[(x * channels + c) * 2 + 1]!
      return sample(x, c)
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4
      let r: number
      let g: number
      let b: number
      let a = 255
      switch (colorType) {
        case 0: {
          r = g = b = Math.round(sample(x, 0) * scale)
          if (trns !== null && trns.length >= 2 && rawSample(x, 0) === ((trns[0]! << 8) | trns[1]!)) a = 0
          break
        }
        case 2: {
          r = sample(x, 0)
          g = sample(x, 1)
          b = sample(x, 2)
          if (
            trns !== null &&
            trns.length >= 6 &&
            rawSample(x, 0) === ((trns[0]! << 8) | trns[1]!) &&
            rawSample(x, 1) === ((trns[2]! << 8) | trns[3]!) &&
            rawSample(x, 2) === ((trns[4]! << 8) | trns[5]!)
          ) {
            a = 0
          }
          break
        }
        case 3: {
          const i = sample(x, 0)
          if (i * 3 + 2 >= palette!.length) throw new PngDecodeError('PNG のパレットの番号が範囲外です。')
          r = palette![i * 3]!
          g = palette![i * 3 + 1]!
          b = palette![i * 3 + 2]!
          if (trns !== null && i < trns.length) a = trns[i]!
          break
        }
        case 4: {
          r = g = b = sample(x, 0)
          a = sample(x, 1)
          break
        }
        default: {
          r = sample(x, 0)
          g = sample(x, 1)
          b = sample(x, 2)
          a = sample(x, 3)
        }
      }
      pixels[o] = r
      pixels[o + 1] = g
      pixels[o + 2] = b
      pixels[o + 3] = a
    }
  }
}

function unfilter(filter: number, src: Uint8Array, prev: Uint8Array, out: Uint8Array, bpp: number): void {
  const n = src.length
  switch (filter) {
    case 0:
      out.set(src)
      return
    case 1:
      for (let i = 0; i < n; i++) out[i] = src[i]! + (i >= bpp ? out[i - bpp]! : 0)
      return
    case 2:
      for (let i = 0; i < n; i++) out[i] = src[i]! + prev[i]!
      return
    case 3:
      for (let i = 0; i < n; i++) out[i] = src[i]! + (((i >= bpp ? out[i - bpp]! : 0) + prev[i]!) >> 1)
      return
    case 4:
      for (let i = 0; i < n; i++) {
        const a = i >= bpp ? out[i - bpp]! : 0
        const b = prev[i]!
        const c = i >= bpp ? prev[i - bpp]! : 0
        out[i] = src[i]! + paeth(a, b, c)
      }
      return
    default:
      throw new PngDecodeError(`PNG のフィルターの種類 ${filter} は不正です。`)
  }
}

/** PNG の Paeth 予測 */
export function paeth(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  if (pb <= pc) return b
  return c
}
