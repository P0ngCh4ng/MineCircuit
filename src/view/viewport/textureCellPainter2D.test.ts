import { describe, expect, it } from 'vitest'
import { fakeAppearanceSet } from '../../../tests/fixtures/fakeAppearance'
import type { AppearanceSet } from '../../domain/blockModel'
import { BlockState } from '../../domain/blockState'
import { ResourceLocation } from '../../domain/resourceLocation'
import {
  createTextureCellPainter,
  DEFAULT_TINT_RGB,
  TextureCellPainter,
  tintPixels,
  type AtlasImages,
  type TextureCanvasLike,
} from './textureCellPainter2D'

const state = (id: string, properties: Record<string, string> = {}) => new BlockState(ResourceLocation.parse(id), properties)

interface DrawCall {
  readonly image: string
  readonly source: readonly number[]
  readonly dest: readonly number[]
  readonly translate: readonly [number, number]
  readonly rotate: number
}

/** drawImage を記録する偽の canvas。translate・rotate は最後の値だけ持つ */
function fakeContext() {
  const draws: DrawCall[] = []
  let translate: [number, number] = [0, 0]
  let rotate = 0
  const ctx = {
    imageSmoothingEnabled: true,
    save() {},
    restore() {
      translate = [0, 0]
      rotate = 0
    },
    translate(x: number, y: number) {
      translate = [x, y]
    },
    rotate(r: number) {
      rotate = r
    },
    scale() {},
    drawImage(image: { name: string }, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number) {
      draws.push({ image: image.name, source: [sx, sy, sw, sh], dest: [dx, dy, dw, dh], translate, rotate })
    },
  }
  return { ctx: ctx as unknown as TextureCanvasLike, draws, raw: ctx }
}

const images = { plain: { name: 'plain' }, tinted: { name: 'tinted' } } as unknown as AtlasImages

function painter(set: AppearanceSet = fakeAppearanceSet()) {
  return new TextureCellPainter(set, images)
}

describe('TextureCellPainter', () => {
  it('上の面のテクスチャを、アトラスの中のその範囲から切り出してマス全体に描く', () => {
    const { ctx, draws, raw } = fakeContext()
    expect(painter().paint(ctx, state('test:red_block'), 100, 50, 32)).toBe(true)
    expect(raw.imageSmoothingEnabled).toBe(false)
    // test:block/red はアトラスの左端の 16×16
    expect(draws).toEqual([{ image: 'plain', source: [0, 0, 16, 16], dest: [-16, -16, 32, 32], translate: [116, 66], rotate: 0 }])
  })

  it('シャフトは真ん中の範囲に、uv で切り出した部分を描く', () => {
    const { ctx, draws } = fakeContext()
    painter().paint(ctx, state('test:shaft', { axis: 'y' }), 0, 0, 32)
    // shaft_end はアトラスの 5 枚目（x = 64）。uv 6〜10
    expect(draws[0]?.source).toEqual([64 + 6, 6, 4, 4])
    expect(draws[0]?.dest).toEqual([-4, -4, 8, 8])
    expect(draws[0]?.translate).toEqual([16, 16])
  })

  it('横に寝た丸太は、横の面を回して描く', () => {
    const { ctx, draws } = fakeContext()
    painter().paint(ctx, state('test:log', { axis: 'x' }), 0, 0, 16)
    expect(draws[0]?.source).toEqual([16, 0, 16, 16])
    expect(draws[0]?.rotate).toBeCloseTo(Math.PI / 2)
  })

  it('色付けの面（tintIndex）は色を掛けた画像から描く', () => {
    const { ctx, draws } = fakeContext()
    painter().paint(ctx, state('test:grass'), 0, 0, 16)
    expect(draws[0]?.image).toBe('tinted')
  })

  it('テクスチャが見つからない面は missing で描く', () => {
    const set = fakeAppearanceSet()
    const regions = { ...set.atlas.regions }
    delete regions['test:block/red']
    const { ctx, draws } = fakeContext()
    painter({ ...set, atlas: { ...set.atlas, regions } }).paint(ctx, state('test:red_block'), 0, 0, 16)
    // missing はアトラスの最後（7 枚目、x = 96）
    expect(draws[0]?.source).toEqual([96, 0, 16, 16])
  })

  it('見た目が分からないブロックと、知らないブロックは描かずに false を返す（色で塗る）', () => {
    const { ctx, draws } = fakeContext()
    const p = painter()
    expect(p.paint(ctx, state('test:unknown'), 0, 0, 16)).toBe(false)
    expect(p.paint(ctx, state('minecraft:stone'), 0, 0, 16)).toBe(false)
    expect(draws).toEqual([])
  })
})

describe('tintPixels', () => {
  it('色を掛け、透明度は変えない', () => {
    const out = tintPixels(new Uint8ClampedArray([255, 255, 255, 128, 0, 0, 0, 255]), DEFAULT_TINT_RGB)
    expect([...out]).toEqual([...DEFAULT_TINT_RGB, 128, 0, 0, 0, 255])
  })
})

describe('createTextureCellPainter', () => {
  it('見た目がなければ null', () => {
    expect(createTextureCellPainter(null)).toBeNull()
  })
})
