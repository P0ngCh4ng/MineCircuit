import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { isReactive } from 'vue'
import { fakeAppearanceSet } from '../../../tests/fixtures/fakeAppearance'
import { useAppearanceStore } from './appearanceStore'

describe('useAppearanceStore', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('最初は見た目がなく、描画が使う見た目も null', () => {
    const store = useAppearanceStore()
    expect(store.set).toBeNull()
    expect(store.mode).toBe('texture')
    expect(store.active).toBeNull()
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
})
