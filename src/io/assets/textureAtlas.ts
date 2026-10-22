// テクスチャの PNG を読んで、1枚の画像（TextureAtlas）にまとめる。
// 資産は AssetReader だけを使って読む（jar の読み方は知らない）。Worker の中でも Vitest でも動く。
//
// 決まり：
// - パスは assets/<namespace>/textures/<path>.png。namespace がない ID は minecraft とみなす
// - .png.mcmeta にアニメーションがあれば、1枚目の絵だけを使う（frames の最初の番号。なければ 0 番）。
//   1枚の大きさは mcmeta の width / height。どちらもなければ、画像の幅と高さの小さいほうの正方形
// - 並べ方は棚詰め（高い順に左から並べ、入らなければ次の段）。アトラスの幅と高さは 2 の累乗で、
//   1辺 MAX_ATLAS_SIZE（4096）まで。入りきらないテクスチャは missing にして problems に書く
// - 各テクスチャの周りに 1 画素の縁を付け、端の画素を伸ばして埋める（拡大・縮小で隣がにじまないように）
// - 見つからない・読めないテクスチャは missing（紫と黒の市松模様）にし、problems に書く。
//   その ID も regions に入れ、位置は missing と同じにする

import type { AtlasRegion, TextureAtlas, TextureId } from '../../domain/blockModel'
import type { AssetReader } from './assetTypes'
import { decodePng, PngDecodeError, type RgbaImage } from './pngDecoder'

/** アトラスの1辺の上限（画素）。WebGL で多くの環境が扱える大きさ */
export const MAX_ATLAS_SIZE = 4096

/** missing の模様の大きさ（画素） */
export const MISSING_TEXTURE_SIZE = 16

/** 各テクスチャの周りの縁（画素） */
export const ATLAS_GUTTER = 1

export interface TextureAtlasBuildResult {
  readonly atlas: TextureAtlas
  /** 読めなかったテクスチャなど。日本語でそのまま出せる */
  readonly problems: readonly string[]
}

export interface TextureAtlasOptions {
  /** アトラスの1辺の上限。2 の累乗。省略時は MAX_ATLAS_SIZE */
  readonly maxSize?: number
}

/** テクスチャの ID から PNG のパス。"create:block/shaft" → "assets/create/textures/block/shaft.png" */
export function texturePath(id: TextureId): string | null {
  const colon = id.indexOf(':')
  const ns = colon < 0 ? 'minecraft' : id.slice(0, colon)
  const path = colon < 0 ? id : id.slice(colon + 1)
  if (ns === '' || path === '' || !/^[a-z0-9_.-]+$/.test(ns) || !/^[a-z0-9_./-]+$/.test(path)) return null
  return `assets/${ns}/textures/${path}.png`
}

/** missing の模様（紫と黒の市松模様。左上は黒） */
export function missingTexture(): RgbaImage {
  const n = MISSING_TEXTURE_SIZE
  const pixels = new Uint8ClampedArray(n * n * 4)
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const magenta = x < n / 2 !== y < n / 2
      const o = (y * n + x) * 4
      pixels[o] = magenta ? 248 : 0
      pixels[o + 1] = 0
      pixels[o + 2] = magenta ? 248 : 0
      pixels[o + 3] = 255
    }
  }
  return { width: n, height: n, pixels }
}

export class TextureAtlasBuilder {
  private readonly maxSize: number

  constructor(
    private readonly reader: AssetReader,
    options: TextureAtlasOptions = {},
  ) {
    this.maxSize = options.maxSize ?? MAX_ATLAS_SIZE
  }

  async build(ids: Iterable<TextureId>): Promise<TextureAtlasBuildResult> {
    const unique = [...new Set(ids)]
    // 並べて読むが、problems は ID の順にそろえる
    const perId = unique.map((): string[] => [])
    const loaded = await Promise.all(unique.map((id, i) => this.load(id, perId[i]!)))
    const problems: string[] = perId.flat()

    const items: PackItem[] = [{ id: null, image: missingTexture() }]
    unique.forEach((id, i) => {
      const image = loaded[i]
      if (image) items.push({ id, image })
    })

    const { width, height, placed, dropped } = pack(items, this.maxSize)
    for (const item of dropped) {
      problems.push(`テクスチャ ${item.id} がアトラス（${this.maxSize}×${this.maxSize}）に入りきりませんでした。紫と黒で表示します。`)
    }

    const pixels = new Uint8ClampedArray(width * height * 4)
    let missing: AtlasRegion | null = null
    const regions: Record<TextureId, AtlasRegion> = {}
    for (const p of placed) {
      blit(pixels, width, p.image, p.x, p.y)
      const region = regionOf(p, width, height)
      if (p.id === null) missing = region
      else regions[p.id] = region
    }
    if (missing === null) throw new Error('missing を置けませんでした')
    for (const id of unique) if (!(id in regions)) regions[id] = missing

    return { atlas: { width, height, pixels, regions, missing }, problems }
  }

  /** 1つのテクスチャを読む。読めなければ problems に書いて null */
  private async load(id: TextureId, problems: string[]): Promise<RgbaImage | null> {
    const path = texturePath(id)
    if (path === null) {
      problems.push(`テクスチャの ID ${id} が正しくありません。紫と黒で表示します。`)
      return null
    }
    const bytes = await this.reader.readBytes(path)
    if (bytes === null) {
      problems.push(`テクスチャ ${id}（${path}）が見つかりません。紫と黒で表示します。`)
      return null
    }
    let image: RgbaImage
    try {
      image = decodePng(bytes)
    } catch (e) {
      const reason = e instanceof PngDecodeError ? e.message : '読めませんでした。'
      problems.push(`テクスチャ ${id}（${path}）：${reason}紫と黒で表示します。`)
      return null
    }
    const meta = await this.reader.readText(`${path}.mcmeta`)
    if (meta === null) return image
    return firstFrame(image, meta, id, problems)
  }
}

/** .png.mcmeta にアニメーションがあれば、1枚目の絵を切り出す */
function firstFrame(image: RgbaImage, metaText: string, id: TextureId, problems: string[]): RgbaImage {
  let meta: unknown
  try {
    meta = JSON.parse(metaText)
  } catch {
    problems.push(`テクスチャ ${id} の .mcmeta を読めませんでした。画像の上の正方形を使います。`)
    meta = { animation: {} }
  }
  const animation = isObject(meta) ? meta['animation'] : undefined
  if (!isObject(animation)) return image

  const square = Math.min(image.width, image.height)
  const w = positiveInt(animation['width'])
  const h = positiveInt(animation['height'])
  const frameW = w ?? (h !== null ? image.width : square)
  const frameH = h ?? (w !== null ? image.height : square)
  if (frameW > image.width || frameH > image.height) {
    problems.push(`テクスチャ ${id} のアニメーションの1枚の大きさ（${frameW}×${frameH}）が画像より大きいです。画像全体を使います。`)
    return image
  }

  const frames = animation['frames']
  let index = 0
  if (Array.isArray(frames) && frames.length > 0) {
    const f: unknown = frames[0]
    const n = isObject(f) ? f['index'] : f
    if (typeof n === 'number' && Number.isInteger(n) && n >= 0) index = n
  }
  const cols = Math.floor(image.width / frameW)
  const rows = Math.floor(image.height / frameH)
  if (index >= cols * rows) index = 0
  return crop(image, (index % cols) * frameW, Math.floor(index / cols) * frameH, frameW, frameH)
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function positiveInt(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null
}

function crop(image: RgbaImage, x0: number, y0: number, w: number, h: number): RgbaImage {
  if (x0 === 0 && y0 === 0 && w === image.width && h === image.height) return image
  const pixels = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    const from = ((y0 + y) * image.width + x0) * 4
    pixels.set(image.pixels.subarray(from, from + w * 4), y * w * 4)
  }
  return { width: w, height: h, pixels }
}

interface PackItem {
  /** null は missing */
  readonly id: TextureId | null
  readonly image: RgbaImage
}

interface Placed extends PackItem {
  /** 縁を含めた左上 */
  readonly x: number
  readonly y: number
}

interface PackResult {
  readonly width: number
  readonly height: number
  readonly placed: readonly Placed[]
  readonly dropped: readonly PackItem[]
}

/**
 * 棚詰めで並べる。幅・高さが 2 の累乗の候補を、面積の小さい順に試し、最初に全部入ったものを使う。
 * 上限の大きさでも入らなければ、入るものだけ置き、残りを dropped で返す（missing は最初に置く）
 */
function pack(items: readonly PackItem[], maxSize: number): PackResult {
  const g = ATLAS_GUTTER * 2
  const [missingItem, ...rest] = items
  // 高い順、同じなら広い順。missing は必ず先頭にして、上限でも置けるようにする
  const sorted = [
    missingItem!,
    ...rest.sort((a, b) => b.image.height - a.image.height || b.image.width - a.image.width),
  ]
  const area = sorted.reduce((s, it) => s + (it.image.width + g) * (it.image.height + g), 0)
  const widest = Math.max(...sorted.map((it) => it.image.width + g))

  for (let h = 1; h <= maxSize; h *= 2) {
    for (const w of [h, h * 2]) {
      if (w > maxSize || w * h < area || w < widest) continue
      const r = shelfPack(sorted, w, h)
      if (r.dropped.length === 0) return r
    }
  }
  return shelfPack(sorted, maxSize, maxSize)
}

function shelfPack(items: readonly PackItem[], width: number, height: number): PackResult {
  const g = ATLAS_GUTTER * 2
  const placed: Placed[] = []
  const dropped: PackItem[] = []
  let x = 0
  let y = 0
  let shelf = 0
  for (const it of items) {
    const w = it.image.width + g
    const h = it.image.height + g
    if (w > width) {
      dropped.push(it)
      continue
    }
    if (x + w > width) {
      y += shelf
      x = 0
      shelf = 0
    }
    if (y + h > height) {
      dropped.push(it)
      continue
    }
    placed.push({ ...it, x, y })
    x += w
    shelf = Math.max(shelf, h)
  }
  return { width, height, placed, dropped }
}

/** 縁を含めて書き込む。縁は端の画素を伸ばす */
function blit(dst: Uint8ClampedArray, dstWidth: number, image: RgbaImage, x0: number, y0: number): void {
  const { width: w, height: h, pixels } = image
  const gut = ATLAS_GUTTER
  for (let y = -gut; y < h + gut; y++) {
    const sy = Math.min(h - 1, Math.max(0, y))
    for (let x = -gut; x < w + gut; x++) {
      const sx = Math.min(w - 1, Math.max(0, x))
      const s = (sy * w + sx) * 4
      const d = ((y0 + gut + y) * dstWidth + (x0 + gut + x)) * 4
      dst[d] = pixels[s]!
      dst[d + 1] = pixels[s + 1]!
      dst[d + 2] = pixels[s + 2]!
      dst[d + 3] = pixels[s + 3]!
    }
  }
}

function regionOf(p: Placed, width: number, height: number): AtlasRegion {
  const x = p.x + ATLAS_GUTTER
  const y = p.y + ATLAS_GUTTER
  return { u0: x / width, v0: y / height, u1: (x + p.image.width) / width, v1: (y + p.image.height) / height }
}
