// 2D表示で、マスにブロックの上の面のテクスチャを描く。docs/design.md「見た目（モデルとテクスチャ）」。
// アトラス（TextureAtlas の RGBA）を一度だけ canvas に写し、そこから drawImage で切り出して描く。
// ドット絵なので、拡大は最近傍（imageSmoothingEnabled = false）にする。

import type { AppearanceSet, AtlasRegion, TextureAtlas } from '../../domain/blockModel'
import type { BlockState } from '../../domain/blockState'
import { topFaces, type TopFace2D } from './topFace2D'

/** 色付け（tintIndex。草や葉）に掛ける色。バイオームの色は扱わず、草の緑（平原の草）に決める */
export const DEFAULT_TINT_RGB: readonly [number, number, number] = [0x91, 0xbd, 0x59]

/** drawImage に渡せる画像。テストでは偽物を渡せる */
export type AtlasImage = CanvasImageSource

/** アトラスを写した画像。色付け用は、全部の画素に DEFAULT_TINT_RGB を掛けたもの */
export interface AtlasImages {
  readonly plain: AtlasImage
  readonly tinted: AtlasImage
}

/** 描くのに使う canvas の操作 */
export type TextureCanvasLike = Pick<
  CanvasRenderingContext2D,
  'save' | 'restore' | 'translate' | 'rotate' | 'scale' | 'drawImage' | 'imageSmoothingEnabled'
>

/** マス1つにブロックを描く。2D表示の描画（layerRenderer2D）が使う */
export interface CellPainter2D {
  /**
   * 左上 (px, py)、大きさ size のマスに state を描く。
   * 描けなければ（見た目が分からない、上から見える面がない）何もせず false を返す。呼ぶ側は色で塗る
   */
  paint(ctx: TextureCanvasLike, state: BlockState, px: number, py: number, size: number): boolean
}

/** canvas を作る。作れない環境（テストの happy-dom など）では null */
function createCanvas(width: number, height: number): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

function imageFromPixels(atlas: TextureAtlas, pixels: Uint8ClampedArray): AtlasImage | null {
  const canvas = createCanvas(atlas.width, atlas.height)
  let ctx: CanvasRenderingContext2D | null
  try {
    ctx = canvas?.getContext('2d') ?? null
  } catch {
    ctx = null
  }
  if (!canvas || !ctx) return null
  const data = ctx.createImageData(atlas.width, atlas.height)
  data.data.set(pixels)
  ctx.putImageData(data, 0, 0)
  return canvas
}

/** 全部の画素に色を掛けた RGBA（透明度はそのまま） */
export function tintPixels(pixels: Uint8ClampedArray, [r, g, b]: readonly [number, number, number]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(pixels.length)
  for (let i = 0; i < pixels.length; i += 4) {
    out[i] = (pixels[i]! * r) / 255
    out[i + 1] = (pixels[i + 1]! * g) / 255
    out[i + 2] = (pixels[i + 2]! * b) / 255
    out[i + 3] = pixels[i + 3]!
  }
  return out
}

/** アトラスごとに一度だけ画像を作る（同じアトラスなら作り直さない） */
const imageCache = new WeakMap<TextureAtlas, AtlasImages | null>()

/** アトラスを画像にする。canvas が使えない環境では null（色で描く） */
export function atlasImages(atlas: TextureAtlas): AtlasImages | null {
  if (imageCache.has(atlas)) return imageCache.get(atlas) ?? null
  const plain = imageFromPixels(atlas, atlas.pixels)
  const tinted = plain ? imageFromPixels(atlas, tintPixels(atlas.pixels, DEFAULT_TINT_RGB)) : null
  const images = plain && tinted ? { plain, tinted } : null
  imageCache.set(atlas, images)
  return images
}

/** AppearanceSet とアトラスの画像で、マスに上の面を描く */
export class TextureCellPainter implements CellPainter2D {
  /** BlockState.key → 上から見える面。同じ状態の計算を繰り返さない */
  private readonly facesCache = new Map<string, readonly TopFace2D[]>()

  constructor(
    private readonly set: AppearanceSet,
    private readonly images: AtlasImages,
  ) {}

  /** state の上から見える面。見た目が分からなければ空 */
  facesOf(state: BlockState): readonly TopFace2D[] {
    const key = state.key
    const cached = this.facesCache.get(key)
    if (cached) return cached
    const appearance = this.set.appearances[key] ?? null
    const faces = appearance ? topFaces(appearance) : []
    this.facesCache.set(key, faces)
    return faces
  }

  paint(ctx: TextureCanvasLike, state: BlockState, px: number, py: number, size: number): boolean {
    const faces = this.facesOf(state)
    if (faces.length === 0) return false
    const { atlas } = this.set
    ctx.save()
    ctx.imageSmoothingEnabled = false
    for (const face of faces) {
      const region = atlas.regions[face.texture] ?? atlas.missing
      const image = face.tintIndex !== null ? this.images.tinted : this.images.plain
      drawFace(ctx, image, atlas, region, face, px, py, size)
    }
    ctx.restore()
    return true
  }
}

/** 面1つを、マスの中の範囲（face.x0〜x1、z0〜z1）に描く */
function drawFace(
  ctx: TextureCanvasLike,
  image: AtlasImage,
  atlas: TextureAtlas,
  region: AtlasRegion,
  face: TopFace2D,
  px: number,
  py: number,
  size: number,
): void {
  // 描く先。マスの境目にすき間ができないよう、ピクセルにそろえる
  const left = Math.round(px + (face.x0 / 16) * size)
  const right = Math.round(px + (face.x1 / 16) * size)
  const top = Math.round(py + (face.z0 / 16) * size)
  const bottom = Math.round(py + (face.z1 / 16) * size)
  const dw = right - left
  const dh = bottom - top
  if (dw <= 0 || dh <= 0) return

  // 切り出す元。uv は 0〜16 で、テクスチャ1枚の範囲（region）の中の位置
  const [u1, v1, u2, v2] = face.uv
  // テクスチャ1枚の範囲は画素の境目にあるので、割り算の誤差を丸める
  const rx = Math.round(region.u0 * atlas.width)
  const ry = Math.round(region.v0 * atlas.height)
  const rw = Math.round(region.u1 * atlas.width) - rx
  const rh = Math.round(region.v1 * atlas.height) - ry
  const sx = rx + (Math.min(u1, u2) / 16) * rw
  const sy = ry + (Math.min(v1, v2) / 16) * rh
  const sw = (Math.abs(u2 - u1) / 16) * rw
  const sh = (Math.abs(v2 - v1) / 16) * rh
  if (sw <= 0 || sh <= 0) return

  // 範囲の真ん中を軸に回す。90・270 度なら、縦横を入れ替えて描くと範囲にぴったり入る
  const quarter = face.rotation === 90 || face.rotation === 270
  const w = quarter ? dh : dw
  const h = quarter ? dw : dh
  ctx.save()
  ctx.translate(left + dw / 2, top + dh / 2)
  if (face.rotation !== 0) ctx.rotate((face.rotation * Math.PI) / 180)
  if (u1 > u2 || v1 > v2) ctx.scale(u1 > u2 ? -1 : 1, v1 > v2 ? -1 : 1)
  ctx.drawImage(image, sx, sy, sw, sh, -w / 2, -h / 2, w, h)
  ctx.restore()
}

/** 見た目があり、canvas が使えるときに painter を作る。どちらかがなければ null（色で描く） */
export function createTextureCellPainter(set: AppearanceSet | null): TextureCellPainter | null {
  if (set === null) return null
  const images = atlasImages(set.atlas)
  return images ? new TextureCellPainter(set, images) : null
}
