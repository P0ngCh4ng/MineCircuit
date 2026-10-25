// 置くブロックの棚のアイコン（docs/design.md「ブロックのアイコン」）。
// Modpack ごとに、棚のための provider（3D 表示とは別の Worker）と BlockIconLoader を1つ持つ。
// Modpack が変わったら作り直し、覚えたアイコンを捨てる。

import { defineStore } from 'pinia'
import { shallowReactive, watch } from 'vue'
import type { BlockState } from '../../domain/blockState'
import type { Modpack } from '../../io/modpack/modpack'
import { createAppearanceProvider, type DisposableAppearanceProvider } from '../../workers/appearanceWorkerClient'
import { BlockIconLoader, createWebGlIconRasterizer, type IconRasterizer } from '../edit/blockIcons'
import { useModpackContentStore } from './modpackContent'

/** 作り方。テストで差し替える */
export interface BlockIconFactories {
  createProvider: (pack: Modpack) => DisposableAppearanceProvider
  /** WebGL が使えなければ null を返す */
  createRasterizer: () => IconRasterizer | null
}

const defaultFactories: BlockIconFactories = {
  createProvider: (pack) => createAppearanceProvider(pack.assets()),
  createRasterizer: () => createWebGlIconRasterizer(),
}

export const useBlockIconStore = defineStore('blockIcons', () => {
  const content = useModpackContentStore()
  /** 状態の key → アイコンの data URL。描けなかったものは null、まだのものはない */
  const icons = shallowReactive(new Map<string, string | null>())
  let factories = defaultFactories
  let provider: DisposableAppearanceProvider | null = null
  let loader: BlockIconLoader | null = null
  // WebGL の文脈は1つを使い回す（作れなければ null のまま。一度だけ試す）
  let rasterizer: IconRasterizer | null | undefined

  function reset(pack: Modpack | null): void {
    loader?.dispose()
    provider?.dispose()
    loader = null
    provider = null
    icons.clear()
    if (!pack) return
    if (rasterizer === undefined) rasterizer = factories.createRasterizer()
    provider = factories.createProvider(pack)
    loader = new BlockIconLoader(provider, rasterizer, (key, url) => icons.set(key, url))
  }

  watch(() => content.pack, reset, { immediate: true })

  /** アイコンを頼む。Modpack がなければ何もしない */
  function request(states: readonly BlockState[]): Promise<void> {
    return loader?.request(states) ?? Promise.resolve()
  }

  /** アイコン。まだなら undefined、描けなければ null */
  function iconOf(key: string): string | null | undefined {
    return icons.get(key)
  }

  /** 作り方を差し替える（テスト用）。今の Modpack で作り直す */
  function useFactories(next: Partial<BlockIconFactories>): void {
    factories = { ...defaultFactories, ...next }
    rasterizer?.dispose()
    rasterizer = undefined
    reset(content.pack)
  }

  return { request, iconOf, useFactories }
})
