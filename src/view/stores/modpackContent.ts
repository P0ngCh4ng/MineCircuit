// 選んだ Modpack の中身（Mod の一覧と表示名）の読み込みの状態。
// useModpackStore().source か、選んだゲームのフォルダ（Minecraft 本体の jar を探す場所）が変わるたびに読み直す。jar は Web Worker で開き、結果は IndexedDB に保存する。
// Modpack そのものは画面の状態ではないので、リアクティブにしない（shallowRef + markRaw）。

import { defineStore } from 'pinia'
import { markRaw, ref, shallowRef, watch } from 'vue'
import { ResourceLocation } from '../../domain/resourceLocation'
import type { FileSource } from '../../io/fileSource'
import { IndexedDbJarCache } from '../../io/modpack/indexedDbJarCache'
import type { Modpack } from '../../io/modpack/modpack'
import {
  ModpackLoader,
  ModpackLoadAbortedError,
  type JarCache,
  type JarScanner,
  type GameFolder,
  type ModpackLoadProgress,
} from '../../io/modpack/modpackLoader'
import type { ScriptRunner } from '../../io/modpack/kubejsScripts/scriptTypes'
import { createWorkerJarScanner } from '../../workers/jarScanClient'
import { createWorkerScriptRunner } from '../../workers/kubejsScriptsClient'
import { useGameFolderStore } from './gameFolders'
import { useModpackStore } from './modpack'

export type ModpackLoadPhase = 'idle' | 'loading' | 'loaded' | 'error'

/** 読み込みに使うもの。テストで差し替える */
export interface ModpackLoadEnvironment {
  cache: JarCache | null
  /** null ならその場で開く */
  scan: JarScanner | null
  /** KubeJS のスクリプトを動かす関数（Worker）。省略・null なら動かさない */
  scripts?: ScriptRunner | null
}

let environment: ModpackLoadEnvironment | null = null

/** 読み込みに使うものを差し替える（テスト用）。null で元に戻す */
export function setModpackLoadEnvironment(env: ModpackLoadEnvironment | null): void {
  environment = env
}

function defaultEnvironment(): ModpackLoadEnvironment {
  return {
    cache: IndexedDbJarCache.supported() ? new IndexedDbJarCache() : null,
    scan: createWorkerJarScanner()?.scan ?? null,
    scripts: createWorkerScriptRunner(),
  }
}

function errorMessage(e: unknown): string {
  const detail = e instanceof Error ? e.message : String(e)
  return `Mod の jar を読めませんでした（${detail}）。Modpack のフォルダを選び直してください。`
}

export const useModpackContentStore = defineStore('modpackContent', () => {
  const modpackStore = useModpackStore()
  const gameFolderStore = useGameFolderStore()

  /** 読み込んだ Modpack。読んでいない・選んでいないときは null */
  const pack = shallowRef<Modpack | null>(null)
  const phase = ref<ModpackLoadPhase>('idle')
  const progress = ref<ModpackLoadProgress | null>(null)
  const message = ref<string | null>(null)

  let controller: AbortController | null = null

  async function load(source: FileSource | null, gameFolders: readonly GameFolder[]): Promise<void> {
    controller?.abort()
    controller = null
    pack.value = null
    progress.value = null
    message.value = null
    if (!source) {
      phase.value = 'idle'
      return
    }
    const own = new AbortController()
    controller = own
    phase.value = 'loading'
    environment ??= defaultEnvironment()
    const loader = new ModpackLoader(source, {
      cache: environment.cache,
      scan: environment.scan ?? undefined,
      signal: own.signal,
      gameFolders,
      scripts: environment.scripts ?? null,
      onProgress: (p) => {
        if (controller === own) progress.value = p
      },
    })
    try {
      const result = await loader.load()
      if (controller !== own) return
      pack.value = markRaw(result)
      phase.value = 'loaded'
    } catch (e) {
      if (controller !== own || e instanceof ModpackLoadAbortedError) return
      phase.value = 'error'
      message.value = errorMessage(e)
    } finally {
      if (controller === own) controller = null
    }
  }

  watch(
    () => [modpackStore.source, gameFolderStore.opened] as const,
    ([source, gameFolders]) => void load(source, gameFolders),
    { immediate: true },
  )

  /**
   * ブロックの表示名。日本語 → 英語の順に探し、どちらもなければ null（画面では ID を出す）。
   * id は ResourceLocation か "namespace:path"。
   */
  function displayName(id: ResourceLocation | string): string | null {
    const p = pack.value
    if (!p) return null
    let rl: ResourceLocation
    try {
      rl = typeof id === 'string' ? ResourceLocation.parse(id) : id
    } catch {
      return null
    }
    return p.displayName(rl, 'ja_jp') ?? p.displayName(rl, 'en_us')
  }

  return {
    pack,
    phase,
    progress,
    message,
    displayName,
    /** 選んでいる Modpack を読み直す */
    reload: () => load(modpackStore.source, gameFolderStore.opened),
  }
})
