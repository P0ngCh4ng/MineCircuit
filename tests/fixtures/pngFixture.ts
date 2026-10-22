// テスト用の PNG をコードで作る小さなエンコーダー。本物のテクスチャはリポジトリに入れない。
// 圧縮は fflate の zlibSync。フィルターは行ごとに選べる（デコーダーの各フィルターを試すため）。

import { zlibSync } from 'fflate'
import { crc32, paeth } from '../../src/io/assets/pngDecoder'

export type PngColorType = 0 | 2 | 3 | 4 | 6

export interface PngSpec {
  readonly width: number
  readonly height: number
  /** 0 グレー、2 RGB、3 パレット、4 グレー+α、6 RGBA。省略時は 6 */
  readonly colorType?: PngColorType
  /** 省略時は 8 */
  readonly bitDepth?: number
  /** 画素ごとのサンプルの値（元のビット深度のまま）。上の行から、1画素につき色の種類のチャンネル数ぶん */
  readonly samples: readonly number[]
  /** パレット [r, g, b] の並び */
  readonly palette?: readonly (readonly [number, number, number])[]
  /** tRNS の中身（そのままのバイト） */
  readonly trns?: readonly number[]
  /** 行ごとのフィルター（0〜4）。足りない行は繰り返す。省略時は 0 */
  readonly filters?: readonly number[]
  /** IHDR のインターレースの値。省略時は 0 */
  readonly interlace?: number
}

const CHANNELS: Readonly<Record<PngColorType, number>> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }

export function encodePng(spec: PngSpec): Uint8Array {
  const colorType = spec.colorType ?? 6
  const bitDepth = spec.bitDepth ?? 8
  const channels = CHANNELS[colorType]
  const bitsPerPixel = channels * bitDepth
  const bpp = Math.max(1, bitsPerPixel >> 3)
  const stride = Math.ceil((spec.width * bitsPerPixel) / 8)

  // 行のバイト列（フィルター前）を作る
  const rows: Uint8Array[] = []
  for (let y = 0; y < spec.height; y++) {
    const row = new Uint8Array(stride)
    for (let i = 0; i < spec.width * channels; i++) {
      const v = spec.samples[y * spec.width * channels + i] ?? 0
      if (bitDepth === 8) row[i] = v
      else if (bitDepth === 16) {
        row[i * 2] = v >> 8
        row[i * 2 + 1] = v & 0xff
      } else {
        const bit = i * bitDepth
        row[bit >> 3]! |= v << (8 - bitDepth - (bit & 7))
      }
    }
    rows.push(row)
  }

  const filters = spec.filters ?? [0]
  const raw = new Uint8Array((stride + 1) * spec.height)
  for (let y = 0; y < spec.height; y++) {
    const f = filters[y % filters.length]!
    const cur = rows[y]!
    const prev = y > 0 ? rows[y - 1]! : new Uint8Array(stride)
    const o = y * (stride + 1)
    raw[o] = f
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp]! : 0
      const b = prev[i]!
      const c = i >= bpp ? prev[i - bpp]! : 0
      const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : paeth(a, b, c)
      raw[o + 1 + i] = (cur[i]! - pred) & 0xff
    }
  }

  const ihdr = new Uint8Array(13)
  const view = new DataView(ihdr.buffer)
  view.setUint32(0, spec.width)
  view.setUint32(4, spec.height)
  ihdr[8] = bitDepth
  ihdr[9] = colorType
  ihdr[12] = spec.interlace ?? 0

  const chunks: Uint8Array[] = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr)]
  if (spec.palette) chunks.push(chunk('PLTE', new Uint8Array(spec.palette.flat())))
  if (spec.trns) chunks.push(chunk('tRNS', new Uint8Array(spec.trns)))
  chunks.push(chunk('IDAT', zlibSync(raw)))
  chunks.push(chunk('IEND', new Uint8Array(0)))

  const total = chunks.reduce((s, c) => s + c.length, 0)
  const out = new Uint8Array(total)
  let off = 0
  for (const c of chunks) {
    out.set(c, off)
    off += c.length
  }
  return out
}

function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(body.length + 12)
  const view = new DataView(out.buffer)
  view.setUint32(0, body.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(body, 8)
  view.setUint32(8 + body.length, crc32(out, 4, 8 + body.length))
  return out
}

/** RGBA の画素を関数で決めて PNG にする（colorType 6、8 ビット） */
export function rgbaPng(
  width: number,
  height: number,
  color: (x: number, y: number) => readonly [number, number, number, number],
  filters?: readonly number[],
): Uint8Array {
  const samples: number[] = []
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) samples.push(...color(x, y))
  return encodePng({ width, height, samples, ...(filters ? { filters } : {}) })
}

/** 単色の RGBA の PNG */
export function solidPng(width: number, height: number, rgba: readonly [number, number, number, number]): Uint8Array {
  return rgbaPng(width, height, () => rgba)
}

/** RGBA 画素の配列から (x, y) の色を取る */
export function pixelAt(
  pixels: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
): [number, number, number, number] {
  const o = (y * width + x) * 4
  return [pixels[o]!, pixels[o + 1]!, pixels[o + 2]!, pixels[o + 3]!]
}
