import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { isReactive } from 'vue'
import { fakeAppearanceSet, FakeAppearanceProvider } from '../../../tests/fixtures/fakeAppearance'
import type { AppearanceSet } from '../../domain/blockModel'
import { BlockState } from '../../domain/blockState'
import { ResourceLocation } from '../../domain/resourceLocation'
import type { AppearanceProvider } from '../../io/assets/assetTypes'
import { useAppearanceStore } from './appearanceStore'

const state = (id: string, properties: Record<string, string> = {}) => new BlockState(ResourceLocation.parse(id), properties)

/** prepare の結果を、テストから好きな順に返せる provider */
class ManualProvider implements AppearanceProvider {
  readonly pending: { resolve: (s: AppearanceSet) => void; reject: (e: unknown) => void }[] = []
  prepare(): Promise<AppearanceSet> {
    return new Promise((resolve, reject) => this.pending.push({ resolve, reject }))
  }
}

describe('useAppearanceStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('見た目がないときは、選んだものによらず色で描く', () => {
    const store = useAppearanceStore()
    expect(store.set).toBeNull()
    expect(store.mode).toBe('texture')
    expect(store.available).toBe(false)
    expect(store.effectiveMode).toBe('color')
    expect(store.active).toBeNull()
  })

  it('provider から見た目を読み、テクスチャで描く。色に切り替えると active は null', async () => {
    const store = useAppearanceStore()
    const provider = new FakeAppearanceProvider(fakeAppearanceSet(['a.png を読めません', 'b.json を読めません']))
    store.setProvider(provider)
    const done = store.refresh([state('test:red_block'), state('minecraft:stone')])
    expect(store.loading).toBe(true)
    await done
    expect(store.loading).toBe(false)
    expect(provider.calls).toEqual([['test:red_block', 'minecraft:stone']])
    expect(store.set?.appearances['test:red_block']).not.toBeNull()
    expect(store.problemCount).toBe(2)
    expect(store.effectiveMode).toBe('texture')
    expect(store.active).toBe(store.set)

    store.setMode('color')
    expect(store.effectiveMode).toBe('color')
    expect(store.active).toBeNull()
    store.setMode('texture')
    expect(store.active).toBe(store.set)
  })

  it('provider がなければ refresh は何もしない。setProvider(null) で見た目を消す', async () => {
    const store = useAppearanceStore()
    await store.refresh([state('test:red_block')])
    expect(store.loading).toBe(false)
    expect(store.set).toBeNull()

    store.setProvider(new FakeAppearanceProvider())
    await store.refresh([state('test:red_block')])
    expect(store.set).not.toBeNull()
    store.setProvider(null)
    expect(store.set).toBeNull()
    expect(store.effectiveMode).toBe('color')
  })

  it('読み込みの途中で読み直したら、前の結果は捨てる', async () => {
    const store = useAppearanceStore()
    const provider = new ManualProvider()
    store.setProvider(provider)
    const first = store.refresh([state('test:a')])
    const second = store.refresh([state('test:b')])
    const newer = fakeAppearanceSet(['新しい'])
    provider.pending[1]!.resolve(newer)
    await second
    provider.pending[0]!.resolve(fakeAppearanceSet(['古い']))
    await first
    expect(store.set?.problems).toEqual(['新しい'])
    expect(store.loading).toBe(false)
  })

  it('読み込みに失敗したら、見た目を消して文言を出す', async () => {
    const store = useAppearanceStore()
    const provider = new ManualProvider()
    store.setProvider(provider)
    const done = store.refresh([state('test:a')])
    provider.pending[0]!.reject(new Error('壊れた jar'))
    await done
    expect(store.set).toBeNull()
    expect(store.error).toContain('壊れた jar')
    expect(store.loading).toBe(false)
  })

  it('setAppearanceSet で直接入れ替えられる（開発用など）', () => {
    const store = useAppearanceStore()
    store.setAppearanceSet(fakeAppearanceSet())
    expect(store.available).toBe(true)
    store.setAppearanceSet(null)
    expect(store.available).toBe(false)
  })

  it('テクスチャのときだけ見た目を描画に渡し、色にすると null にする', () => {
    const store = useAppearanceStore()
    const set = fakeAppearanceSet()
    store.setAppearanceSet(set)
    expect(store.active).toBe(set)
    expect(isReactive(store.set)).toBe(false)
    store.setMode('color')
    expect(store.active).toBeNull()
    store.setMode('texture')
    store.setAppearanceSet(null)
    expect(store.active).toBeNull()
  })

  it('setAppearanceSet は読み込み中の結果を捨てる', async () => {
    const store = useAppearanceStore()
    const provider = new ManualProvider()
    store.setProvider(provider)
    const pending = store.refresh([state('test:a')])
    const direct = fakeAppearanceSet(['直接'])
    store.setAppearanceSet(direct)
    expect(store.loading).toBe(false)
    provider.pending[0]!.resolve(fakeAppearanceSet(['古い']))
    await pending
    expect(store.set).toBe(direct)
  })
})
