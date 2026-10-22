import { describe, expect, it } from 'vitest'
import { BlockState } from '../../src/domain/blockState'
import { ResourceLocation } from '../../src/domain/resourceLocation'
import { FAKE_TEXTURES, FakeAppearanceProvider, MemoryAssetReader, fakeAppearanceSet, fakeAtlas } from './fakeAppearance'

describe('テクスチャ表示の偽のデータ', () => {
  it('アトラスにすべてのテクスチャと missing が入る', () => {
    const atlas = fakeAtlas()
    expect(atlas.pixels.length).toBe(atlas.width * atlas.height * 4)
    for (const id of Object.keys(FAKE_TEXTURES)) {
      const r = atlas.regions[id]!
      expect(r.u0).toBeGreaterThanOrEqual(0)
      expect(r.u1).toBeLessThanOrEqual(1)
      expect(r.u1).toBeGreaterThan(r.u0)
    }
    expect(atlas.missing.u1).toBe(1)
  })

  it('見た目のモデルが使うテクスチャは、すべてアトラスにある', () => {
    const set = fakeAppearanceSet()
    for (const app of Object.values(set.appearances)) {
      for (const part of app?.parts ?? []) {
        for (const el of part.model.elements) {
          for (const f of Object.values(el.faces)) expect(set.atlas.regions[f!.texture]).toBeDefined()
        }
      }
    }
  })

  it('偽の provider は、知らない状態を null にする', async () => {
    const p = new FakeAppearanceProvider()
    const set = await p.prepare([
      new BlockState(ResourceLocation.parse('test:red_block')),
      new BlockState(ResourceLocation.parse('test:nothing')),
    ])
    expect(set.appearances['test:red_block']?.parts.length).toBe(1)
    expect(set.appearances['test:nothing']).toBeNull()
    expect(p.calls).toEqual([['test:red_block', 'test:nothing']])
  })

  it('メモリの資産は、ないパスで null を返す', async () => {
    const r = new MemoryAssetReader({ 'assets/test/models/block/a.json': '{"parent":"block/cube_all"}' })
    expect(await r.readText('assets/test/models/block/a.json')).toContain('cube_all')
    expect(await r.readBytes('assets/test/textures/block/a.png')).toBeNull()
  })
})
