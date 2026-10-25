import { describe, expect, it } from 'vitest'
import { fakeAppearanceSet } from '../../../tests/fixtures/fakeAppearance'
import type { AppearanceSet } from '../../domain/blockModel'
import { BlockState } from '../../domain/blockState'
import { ResourceLocation } from '../../domain/resourceLocation'
import type { AppearanceProvider } from '../../io/assets/assetTypes'
import { BlockIconLoader, createWebGlIconRasterizer, type IconRasterizer } from './blockIcons'

const state = (s: string) => new BlockState(ResourceLocation.parse(s))

/** 頼まれた状態を数える provider。test:red_block だけ見た目がある */
class CountingProvider implements AppearanceProvider {
  calls: string[][] = []
  async prepare(states: readonly BlockState[]): Promise<AppearanceSet> {
    this.calls.push(states.map((s) => s.key))
    const base = fakeAppearanceSet()
    return { ...base, appearances: Object.fromEntries(states.map((s) => [s.key, base.appearances[s.key] ?? null])) }
  }
}

describe('BlockIconLoader', () => {
  it('頼まれた状態の見た目を用意して描く。見た目がないもの・描けないものは null。同じ状態は2度頼まない', async () => {
    const provider = new CountingProvider()
    const drawn: string[] = []
    const rasterizer: IconRasterizer = {
      draw: (look) => {
        drawn.push(String(look.parts.length))
        return 'data:icon'
      },
      dispose() {},
    }
    const icons = new Map<string, string | null>()
    const loader = new BlockIconLoader(provider, rasterizer, (k, url) => icons.set(k, url), async () => {})
    await loader.request([state('test:red_block'), state('test:unknown')])
    await loader.request([state('test:red_block')])
    expect(provider.calls).toEqual([['test:red_block', 'test:unknown']])
    expect(icons.get('test:red_block')).toBe('data:icon')
    expect(icons.get('test:unknown')).toBeNull()
    expect(drawn).toHaveLength(1)
  })

  it('描く手段がなければ（WebGL がない）、すべて null', async () => {
    const icons = new Map<string, string | null>()
    await new BlockIconLoader(new CountingProvider(), null, (k, url) => icons.set(k, url), async () => {}).request([
      state('test:red_block'),
    ])
    expect(icons.get('test:red_block')).toBeNull()
  })

  it('happy-dom では WebGL が使えないので、描く手段は作らない', () => {
    expect(createWebGlIconRasterizer()).toBeNull()
  })
})
