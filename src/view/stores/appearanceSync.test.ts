import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { effectScope, nextTick, type EffectScope } from 'vue'
import { blueprintFixture } from '../../../tests/fixtures/blueprintFixture'
import { FakeAppearanceProvider } from '../../../tests/fixtures/fakeAppearance'
import { BlockState } from '../../domain/blockState'
import { ResourceLocation } from '../../domain/resourceLocation'
import { placeBlock } from '../../edit/editCommand'
import type { Modpack } from '../../io/modpack/modpack'
import type { DisposableAppearanceProvider } from '../../workers/appearanceWorkerClient'
import { useDocumentSession } from '../document/documentSession'
import { useAppearanceStore } from './appearanceStore'
import { paletteStates, useAppearanceSync } from './appearanceSync'
import { useModpackContentStore } from './modpackContent'

class FakeProvider extends FakeAppearanceProvider implements DisposableAppearanceProvider {
  disposed = false
  dispose(): void {
    this.disposed = true
  }
}

/** 偽の Modpack。provider は createProvider で作るので、中身は使わない */
const fakePack = (name: string) => ({ name }) as unknown as Modpack

const blueprint = () => blueprintFixture({ size: [4, 1, 4] }).place([0, 0, 0], 'test:red_block').place([1, 0, 0], 'minecraft:stone').toBlueprint()

describe('useAppearanceSync', () => {
  let scope: EffectScope
  let providers: FakeProvider[]

  beforeEach(() => {
    vi.useFakeTimers()
    setActivePinia(createPinia())
    providers = []
    scope = effectScope()
  })

  afterEach(() => {
    scope.stop()
    useDocumentSession().close()
    vi.useRealTimers()
  })

  function start(): void {
    scope.run(() =>
      useAppearanceSync({
        debounceMs: 100,
        createProvider: () => {
          const p = new FakeProvider()
          providers.push(p)
          return p
        },
      }),
    )
  }

  async function settle(): Promise<void> {
    await nextTick()
    await vi.runAllTimersAsync()
  }

  it('Modpack がなければ provider はなく、色で描く', async () => {
    start()
    useDocumentSession().setBlueprint(blueprint())
    await settle()
    expect(providers).toHaveLength(0)
    expect(useAppearanceStore().available).toBe(false)
  })

  it('Modpack を読み込むと provider を作り、開いている設計図のパレットで見た目を用意する', async () => {
    start()
    useDocumentSession().setBlueprint(blueprint())
    useModpackContentStore().pack = fakePack('a')
    await settle()
    expect(providers).toHaveLength(1)
    expect(providers[0]!.calls).toEqual([['test:red_block', 'minecraft:stone']])
    expect(useAppearanceStore().available).toBe(true)
    expect(useAppearanceStore().set?.appearances['test:red_block']).not.toBeNull()
  })

  it('設計図を開くとすぐ読む。知っている状態だけの設計図では読み直さない', async () => {
    useModpackContentStore().pack = fakePack('a')
    start()
    const session = useDocumentSession()
    session.setBlueprint(blueprint())
    await nextTick()
    expect(providers[0]!.calls).toHaveLength(1)

    session.setBlueprint(blueprintFixture().place([0, 0, 0], 'minecraft:stone').toBlueprint())
    await settle()
    expect(providers[0]!.calls).toHaveLength(1)
  })

  it('編集で状態が増えたときだけ、少し待ってまとめて読み直す', async () => {
    useModpackContentStore().pack = fakePack('a')
    start()
    const session = useDocumentSession()
    session.setBlueprint(blueprint())
    await settle()
    const provider = providers[0]!

    // 知っている状態を置いても読まない
    session.apply(placeBlock(session.current.value!.blueprint, [2, 0, 0], state('minecraft:stone'), true))
    await settle()
    expect(provider.calls).toHaveLength(1)

    // 新しい状態を2つ続けて置くと、待ってから1回だけ読む
    session.apply(placeBlock(session.current.value!.blueprint, [2, 0, 0], state('test:plate'), true))
    await nextTick()
    session.apply(placeBlock(session.current.value!.blueprint, [0, 0, 1], state('test:grass'), true))
    await nextTick()
    expect(provider.calls).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(100)
    expect(provider.calls).toHaveLength(2)
    expect(provider.calls[1]).toEqual(['test:red_block', 'minecraft:stone', 'test:plate', 'test:grass'])
  })

  it('Modpack を読み直すと、前の provider を止めて作り直す。なくなったら見た目を消す', async () => {
    start()
    const content = useModpackContentStore()
    useDocumentSession().setBlueprint(blueprint())
    content.pack = fakePack('a')
    await settle()
    content.pack = fakePack('b')
    await settle()
    expect(providers).toHaveLength(2)
    expect(providers[0]!.disposed).toBe(true)
    expect(providers[1]!.calls).toHaveLength(1)

    content.pack = null
    await settle()
    expect(providers[1]!.disposed).toBe(true)
    expect(useAppearanceStore().set).toBeNull()
  })

  it('止めると provider も止める', async () => {
    useModpackContentStore().pack = fakePack('a')
    start()
    await settle()
    scope.stop()
    expect(providers[0]!.disposed).toBe(true)
  })
})

describe('paletteStates', () => {
  it('全リージョンのパレットの状態を、重なりなく返す', () => {
    const bp = blueprintFixture().place([0, 0, 0], 'test:a').place([1, 0, 0], 'test:a').place([2, 0, 0], 'test:b').toBlueprint()
    expect(paletteStates(bp).map((s) => s.key)).toEqual(['test:a', 'test:b'])
  })
})

function state(id: string): BlockState {
  return new BlockState(ResourceLocation.parse(id))
}
