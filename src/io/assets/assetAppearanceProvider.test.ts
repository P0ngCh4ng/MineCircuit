import { describe, expect, it } from 'vitest'
import { CASING_END_COLOR, fakeAssetFiles, GEAR_COLOR } from '../../../tests/fixtures/fakeAssets'
import { FakeAppearanceProvider, MemoryAssetReader } from '../../../tests/fixtures/fakeAppearance'
import { pixelAt } from '../../../tests/fixtures/pngFixture'
import type { AtlasRegion, TextureAtlas } from '../../domain/blockModel'
import { BlockState } from '../../domain/blockState'
import { ResourceLocation } from '../../domain/resourceLocation'
import { AssetAppearanceProvider, CachedAppearanceProvider, CachingAssetReader, textureIdsOf } from './assetAppearanceProvider'
import type { AssetReader } from './assetTypes'

const state = (id: string, properties: Record<string, string> = {}) => new BlockState(ResourceLocation.parse(id), properties)

/** アトラスの中のテクスチャの (x, y) の色 */
function texel(atlas: TextureAtlas, r: AtlasRegion, x: number, y: number): [number, number, number, number] {
  return pixelAt(atlas.pixels, atlas.width, Math.round(r.u0 * atlas.width) + x, Math.round(r.v0 * atlas.height) + y)
}

/** problems を持つ reader（ModpackAssetReader の代わり） */
class ReaderWithProblems extends MemoryAssetReader implements AssetReader {
  readonly problems = ['mods/broken.jar: 開けませんでした（壊れています）']
}

describe('AssetAppearanceProvider', () => {
  it('blockstates → モデル → テクスチャを読み、アトラスと見た目をまとめる', async () => {
    const provider = new AssetAppearanceProvider(new MemoryAssetReader(fakeAssetFiles()))
    const set = await provider.prepare([state('test:gear'), state('test:casing', { axis: 'x' }), state('minecraft:air')])

    const gear = set.appearances['test:gear']
    expect(gear?.parts).toHaveLength(1)
    expect(gear?.parts[0]!.model.elements[0]!.faces.up?.texture).toBe('test:block/gear')
    const casing = set.appearances['test:casing[axis=x]']
    expect(casing?.parts[0]).toMatchObject({ x: 90, y: 90 })
    expect(set.appearances['minecraft:air']).toEqual({ parts: [] })

    const atlas = set.atlas
    expect(Object.keys(atlas.regions).sort()).toEqual(['test:block/casing_end', 'test:block/casing_side', 'test:block/gear'])
    expect(texel(atlas, atlas.regions['test:block/gear']!, 3, 3)).toEqual([...GEAR_COLOR])
    expect(texel(atlas, atlas.regions['test:block/casing_end']!, 8, 8)).toEqual([...CASING_END_COLOR])
    expect(set.problems).toEqual([])
  })

  it('モデルの問題・テクスチャの問題・reader の問題をまとめる', async () => {
    const provider = new AssetAppearanceProvider(new ReaderWithProblems(fakeAssetFiles()))
    const set = await provider.prepare([state('test:broken'), state('test:nopng'), state('test:unknown')])

    expect(set.appearances['test:broken']).toBeNull()
    expect(set.appearances['test:unknown']).toBeNull()
    // テクスチャだけないブロックは、紫と黒で描く
    expect(set.appearances['test:nopng']).not.toBeNull()
    expect(set.atlas.regions['test:block/nopng']).toEqual(set.atlas.missing)

    expect(set.problems.some((p) => p.includes('test:block/nothing_here'))).toBe(true)
    expect(set.problems.some((p) => p.includes('test:unknown') && p.includes('blockstates'))).toBe(true)
    expect(set.problems.some((p) => p.includes('test:block/nopng') && p.includes('見つかりません'))).toBe(true)
    expect(set.problems).toContain('mods/broken.jar: 開けませんでした（壊れています）')
    expect(new Set(set.problems).size).toBe(set.problems.length)
  })

  it('状態が増えて作り直しても、同じファイルは2度読まない', async () => {
    const reader = new MemoryAssetReader(fakeAssetFiles())
    const provider = new AssetAppearanceProvider(reader)
    await provider.prepare([state('test:gear')])
    const set = await provider.prepare([state('test:gear'), state('test:casing', { axis: 'y' })])
    expect(Object.keys(set.atlas.regions)).toContain('test:block/gear')
    expect(reader.reads.filter((p) => p === 'assets/test/textures/block/gear.png')).toHaveLength(1)
    expect(new Set(reader.reads).size).toBe(reader.reads.length)
  })
})

describe('CachingAssetReader', () => {
  it('BOM を除いて文字列にする。読めなかったものは覚えない', async () => {
    let fail = true
    const inner: AssetReader = {
      readText: async () => null,
      readBytes: async (path) => {
        if (path === 'a' && fail) throw new Error('だめ')
        return new TextEncoder().encode('﻿{}')
      },
    }
    const reader = new CachingAssetReader(inner)
    await expect(reader.readBytes('a')).rejects.toThrow('だめ')
    fail = false
    expect(await reader.readText('a')).toBe('{}')
  })
})

describe('textureIdsOf', () => {
  it('null を飛ばし、面のテクスチャを重なりなく集める', async () => {
    const set = await new AssetAppearanceProvider(new MemoryAssetReader(fakeAssetFiles())).prepare([
      state('test:gear'),
      state('test:casing', { axis: 'z' }),
      state('test:broken'),
    ])
    expect([...textureIdsOf(Object.values(set.appearances))].sort()).toEqual([
      'test:block/casing_end',
      'test:block/casing_side',
      'test:block/gear',
    ])
  })
})

describe('CachedAppearanceProvider', () => {
  it('知っている状態だけなら前の結果を返し、知らない状態が来たら全部で頼み直す', async () => {
    const inner = new FakeAppearanceProvider()
    const cached = new CachedAppearanceProvider(inner)
    const first = await cached.prepare([state('test:red_block'), state('minecraft:stone')])
    expect(await cached.prepare([state('minecraft:stone')])).toBe(first)
    expect(inner.calls).toHaveLength(1)

    const second = await cached.prepare([state('test:plate')])
    expect(inner.calls[1]).toEqual(['test:red_block', 'minecraft:stone', 'test:plate'])
    expect(second.appearances['test:red_block']).not.toBeNull()
  })

  it('失敗した結果は覚えず、次に頼み直す', async () => {
    let calls = 0
    const cached = new CachedAppearanceProvider({
      prepare: async (states) => {
        calls++
        if (calls === 1) throw new Error('読めません')
        return new FakeAppearanceProvider().prepare(states)
      },
    })
    await expect(cached.prepare([state('test:red_block')])).rejects.toThrow('読めません')
    await expect(cached.prepare([state('test:red_block')])).resolves.toBeTruthy()
    expect(calls).toBe(2)
  })
})
