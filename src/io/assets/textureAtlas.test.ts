import { describe, expect, it } from 'vitest'
import type { AtlasRegion, TextureAtlas } from '../../domain/blockModel'
import { MAX_ATLAS_SIZE, TextureAtlasBuilder, texturePath } from './textureAtlas'
import { MemoryAssetReader } from '../../../tests/fixtures/fakeAppearance'
import { pixelAt, rgbaPng, solidPng } from '../../../tests/fixtures/pngFixture'

type Rgba = [number, number, number, number]

/** 領域の左上を (0,0) とした画素 */
function texel(atlas: TextureAtlas, r: AtlasRegion, x: number, y: number): Rgba {
  return pixelAt(atlas.pixels, atlas.width, Math.round(r.u0 * atlas.width) + x, Math.round(r.v0 * atlas.height) + y)
}

function regionSize(atlas: TextureAtlas, r: AtlasRegion): [number, number] {
  return [Math.round((r.u1 - r.u0) * atlas.width), Math.round((r.v1 - r.v0) * atlas.height)]
}

function isPowerOfTwo(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0
}

const RED: Rgba = [200, 40, 40, 255]
const GREEN: Rgba = [40, 170, 60, 255]

describe('texturePath', () => {
  it('ID から PNG のパス', () => {
    expect(texturePath('create:block/shaft')).toBe('assets/create/textures/block/shaft.png')
    expect(texturePath('block/stone')).toBe('assets/minecraft/textures/block/stone.png')
    expect(texturePath('Bad:ID')).toBeNull()
    expect(texturePath('test:')).toBeNull()
  })
})

describe('TextureAtlasBuilder', () => {
  it('テクスチャの位置と画素が正しい。縁は端の画素を伸ばす', async () => {
    // 左上だけ白、ほかは赤
    const png = rgbaPng(16, 16, (x, y) => (x === 0 && y === 0 ? [255, 255, 255, 255] : RED))
    const reader = new MemoryAssetReader({ 'assets/test/textures/block/red.png': png })
    const { atlas, problems } = await new TextureAtlasBuilder(reader).build(['test:block/red'])

    expect(problems).toEqual([])
    expect(isPowerOfTwo(atlas.width) && isPowerOfTwo(atlas.height)).toBe(true)
    expect(atlas.pixels.length).toBe(atlas.width * atlas.height * 4)

    const r = atlas.regions['test:block/red']!
    expect(regionSize(atlas, r)).toEqual([16, 16])
    expect(texel(atlas, r, 0, 0)).toEqual([255, 255, 255, 255])
    expect(texel(atlas, r, 1, 0)).toEqual(RED)
    expect(texel(atlas, r, 15, 15)).toEqual(RED)
    // 縁：左上の外側は白、右下の外側は赤
    expect(texel(atlas, r, -1, -1)).toEqual([255, 255, 255, 255])
    expect(texel(atlas, r, -1, 0)).toEqual([255, 255, 255, 255])
    expect(texel(atlas, r, 16, 16)).toEqual(RED)
    expect(texel(atlas, r, 5, 16)).toEqual(RED)

    // missing は紫と黒の市松模様。v は上が 0
    const m = atlas.missing
    expect(regionSize(atlas, m)).toEqual([16, 16])
    expect(texel(atlas, m, 0, 0)).toEqual([0, 0, 0, 255])
    expect(texel(atlas, m, 8, 0)).toEqual([248, 0, 248, 255])
    expect(texel(atlas, m, 0, 8)).toEqual([248, 0, 248, 255])
    expect(texel(atlas, m, 8, 8)).toEqual([0, 0, 0, 255])
  })

  it('見つからない・読めないテクスチャは missing にして problems に書く', async () => {
    const reader = new MemoryAssetReader({ 'assets/test/textures/block/broken.png': new Uint8Array([1, 2, 3]) })
    const { atlas, problems } = await new TextureAtlasBuilder(reader).build(['test:block/none', 'test:block/broken', 'BAD:x'])
    expect(atlas.regions['test:block/none']).toEqual(atlas.missing)
    expect(atlas.regions['test:block/broken']).toEqual(atlas.missing)
    expect(atlas.regions['BAD:x']).toEqual(atlas.missing)
    expect(problems).toHaveLength(3)
    expect(problems[0]).toContain('test:block/none')
    expect(problems[0]).toContain('見つかりません')
    expect(problems[1]).toContain('PNG ではありません')
  })

  it('アニメーションは1枚目だけ使う', async () => {
    // 16×48：上から赤・緑・青の3枚
    const colors: Rgba[] = [RED, GREEN, [40, 80, 210, 255]]
    const strip = rgbaPng(16, 48, (_x, y) => colors[Math.floor(y / 16)]!)
    const reader = new MemoryAssetReader({
      'assets/test/textures/block/anim.png': strip,
      'assets/test/textures/block/anim.png.mcmeta': JSON.stringify({ animation: { frametime: 2 } }),
      'assets/test/textures/block/anim2.png': strip,
      'assets/test/textures/block/anim2.png.mcmeta': JSON.stringify({ animation: { frames: [{ index: 1, time: 3 }, 0] } }),
      'assets/test/textures/block/tall.png': strip,
    })
    const { atlas, problems } = await new TextureAtlasBuilder(reader).build([
      'test:block/anim',
      'test:block/anim2',
      'test:block/tall',
    ])
    expect(problems).toEqual([])
    const a = atlas.regions['test:block/anim']!
    expect(regionSize(atlas, a)).toEqual([16, 16])
    expect(texel(atlas, a, 3, 15)).toEqual(RED)
    expect(texel(atlas, a, 3, 16)).toEqual(RED) // 縁も1枚目の端
    const b = atlas.regions['test:block/anim2']!
    expect(texel(atlas, b, 0, 0)).toEqual(GREEN)
    // mcmeta がなければ画像全体
    expect(regionSize(atlas, atlas.regions['test:block/tall']!)).toEqual([16, 48])
  })

  it('mcmeta で1枚の大きさを決められる', async () => {
    // 32×16 を 16×16 の2枚（左が赤、右が緑）
    const png = rgbaPng(32, 16, (x) => (x < 16 ? RED : GREEN))
    const reader = new MemoryAssetReader({
      'assets/test/textures/block/wide.png': png,
      'assets/test/textures/block/wide.png.mcmeta': JSON.stringify({ animation: { width: 16, height: 16, frames: [1] } }),
    })
    const { atlas } = await new TextureAtlasBuilder(reader).build(['test:block/wide'])
    const r = atlas.regions['test:block/wide']!
    expect(regionSize(atlas, r)).toEqual([16, 16])
    expect(texel(atlas, r, 0, 0)).toEqual(GREEN)
  })

  it('大きさの違うテクスチャをまとめ、重ならない', async () => {
    const files: Record<string, Uint8Array> = {}
    const ids: string[] = []
    const sizes = [32, 16, 16, 64, 8, 16, 32]
    sizes.forEach((s, i) => {
      files[`assets/test/textures/block/t${i}.png`] = solidPng(s, s, [i * 30, 255 - i * 30, i, 255])
      ids.push(`test:block/t${i}`)
    })
    const { atlas, problems } = await new TextureAtlasBuilder(new MemoryAssetReader(files)).build([...ids, ids[0]!])
    expect(problems).toEqual([])
    expect(isPowerOfTwo(atlas.width) && isPowerOfTwo(atlas.height)).toBe(true)

    const rects = [...ids.map((id) => atlas.regions[id]!), atlas.missing].map((r) => ({
      x0: Math.round(r.u0 * atlas.width) - 1,
      y0: Math.round(r.v0 * atlas.height) - 1,
      x1: Math.round(r.u1 * atlas.width) + 1,
      y1: Math.round(r.v1 * atlas.height) + 1,
    }))
    for (const r of rects) {
      expect(r.x0).toBeGreaterThanOrEqual(0)
      expect(r.y0).toBeGreaterThanOrEqual(0)
      expect(r.x1).toBeLessThanOrEqual(atlas.width)
      expect(r.y1).toBeLessThanOrEqual(atlas.height)
    }
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i]!
        const b = rects[j]!
        expect(a.x1 <= b.x0 || b.x1 <= a.x0 || a.y1 <= b.y0 || b.y1 <= a.y0).toBe(true)
      }
    }
    ids.forEach((id, i) => {
      const r = atlas.regions[id]!
      const s = sizes[i]!
      expect(regionSize(atlas, r)).toEqual([s, s])
      expect(texel(atlas, r, 0, 0)).toEqual([i * 30, 255 - i * 30, i, 255])
      expect(texel(atlas, r, s - 1, s - 1)).toEqual([i * 30, 255 - i * 30, i, 255])
    })
  })

  it('上限に入りきらないテクスチャは missing にして problems に書く', async () => {
    const reader = new MemoryAssetReader({
      'assets/test/textures/block/a.png': solidPng(16, 16, RED),
      'assets/test/textures/block/b.png': solidPng(16, 16, GREEN),
      'assets/test/textures/block/huge.png': solidPng(64, 64, GREEN),
    })
    const { atlas, problems } = await new TextureAtlasBuilder(reader, { maxSize: 32 }).build([
      'test:block/a',
      'test:block/b',
      'test:block/huge',
    ])
    expect(atlas.width).toBeLessThanOrEqual(32)
    expect(atlas.height).toBeLessThanOrEqual(32)
    expect(atlas.regions['test:block/huge']).toEqual(atlas.missing)
    // 18×18 が 32×32 に入るのは1つだけ（missing が先）
    expect(atlas.regions['test:block/a']).toEqual(atlas.missing)
    expect(problems.some((p) => p.includes('test:block/huge') && p.includes('入りきりません'))).toBe(true)
  })

  it('テクスチャがなくても missing だけのアトラスを作る', async () => {
    const { atlas, problems } = await new TextureAtlasBuilder(new MemoryAssetReader({})).build([])
    expect(problems).toEqual([])
    expect(atlas.width).toBe(32)
    expect(atlas.height).toBe(32)
    expect(Object.keys(atlas.regions)).toEqual([])
    expect(MAX_ATLAS_SIZE).toBe(4096)
  })

  it('結果は構造化複製できる', async () => {
    const reader = new MemoryAssetReader({ 'assets/test/textures/block/red.png': solidPng(16, 16, RED) })
    const { atlas } = await new TextureAtlasBuilder(reader).build(['test:block/red'])
    const copy = structuredClone(atlas)
    expect(copy.regions).toEqual(atlas.regions)
    expect(copy.pixels).toEqual(atlas.pixels)
  })
})
