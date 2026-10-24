// 見た目のつなぎ込み（#86）。Modpack と開いている設計図に合わせて、appearanceStore の見た目を用意し直す。
// - Modpack が変わったら（選び直す、読み直す）、provider を作り直す。Modpack がなければ null（色で描く）
// - 設計図を開いたとき・編集でブロック状態が増えたときに、パレットの状態で refresh する。
//   すでに頼んだ状態しかなければ何もしない。編集のときは少し待ってまとめる
// - 生データで見た目が変わるマス（Custom Machinery の機械）は、見た目を借りる先の状態も頼み、借りた見た目を鍵で足す
//   （docs/design.md「生データで見た目が変わるブロック」）
// App.vue の setup で1回だけ呼ぶ。

import { onScopeDispose, watch } from 'vue'
import type { Blueprint } from '../../domain/blueprint'
import type { BlockState } from '../../domain/blockState'
import {
  appearanceAlias,
  hasBlockEntityAppearance,
  type AppearanceAlias,
  type MachineAppearanceLookup,
} from '../../io/assets/blockEntityAppearance'
import type { Modpack } from '../../io/modpack/modpack'
import { createAppearanceProvider, type DisposableAppearanceProvider } from '../../workers/appearanceWorkerClient'
import { useDocumentSession, type BlueprintDocument } from '../document/documentSession'
import { useAppearanceStore } from './appearanceStore'
import { useModpackContentStore } from './modpackContent'

export interface AppearanceSyncOptions {
  /** Modpack から provider を作る。テストで差し替える */
  createProvider?: (pack: Modpack) => DisposableAppearanceProvider
  /** 編集で状態が増えてから読み直すまでの待ち時間（ミリ秒） */
  debounceMs?: number
}

/** 設計図のパレットにあるブロック状態（全リージョン。重なりなし） */
export function paletteStates(bp: Blueprint): BlockState[] {
  const states = new Map<string, BlockState>()
  for (const r of bp.regions) for (const s of r.palette) if (!states.has(s.key)) states.set(s.key, s)
  return [...states.values()]
}

/** 生データで見た目が変わるマスの、見た目を借りる先（鍵ごとに1つ）。パレットにそうしたブロックがなければ空 */
export function blueprintAliases(bp: Blueprint, lookup: MachineAppearanceLookup | null): AppearanceAlias[] {
  if (!lookup) return []
  const aliases = new Map<string, AppearanceAlias>()
  for (const r of bp.regions) {
    if (!r.palette.some(hasBlockEntityAppearance)) continue
    r.forEachBlock((_x, _y, _z, state, blockEntity) => {
      if (!hasBlockEntityAppearance(state)) return
      const alias = appearanceAlias(state, blockEntity, lookup)
      if (alias && !aliases.has(alias.key)) aliases.set(alias.key, alias)
    })
  }
  return [...aliases.values()]
}

/** 頼む状態：パレットの状態と、見た目を借りる先の状態（重なりなし） */
function requestStates(bp: Blueprint, aliases: readonly AppearanceAlias[]): BlockState[] {
  const states = new Map(paletteStates(bp).map((s) => [s.key, s]))
  for (const a of aliases) if (!states.has(a.borrow.key)) states.set(a.borrow.key, a.borrow)
  return [...states.values()]
}

export function useAppearanceSync(options: AppearanceSyncOptions = {}): void {
  const create = options.createProvider ?? ((pack: Modpack) => createAppearanceProvider(pack.assets()))
  const debounceMs = options.debounceMs ?? 250
  const appearance = useAppearanceStore()
  const content = useModpackContentStore()
  const session = useDocumentSession()

  let provider: DisposableAppearanceProvider | null = null
  /** 今の provider に頼んだ状態の key */
  let requested = new Set<string>()
  let lastDoc: BlueprintDocument | null = session.current.value
  let timer: ReturnType<typeof setTimeout> | null = null

  function cancelTimer(): void {
    if (timer !== null) clearTimeout(timer)
    timer = null
  }

  /** 開いている設計図の状態で読み直す。知らない状態がなければ何もしない */
  function refreshNow(): void {
    cancelTimer()
    const bp = session.current.value?.blueprint
    if (!provider || !bp) return
    const aliases = blueprintAliases(bp, content.pack)
    const states = requestStates(bp, aliases)
    const keys = [...states.map((s) => s.key), ...aliases.map((a) => a.key)]
    if (keys.every((k) => requested.has(k))) return
    for (const k of keys) requested.add(k)
    void appearance.refresh(states, aliases)
  }

  function scheduleRefresh(): void {
    cancelTimer()
    timer = setTimeout(refreshNow, debounceMs)
  }

  watch(
    () => content.pack,
    (pack) => {
      cancelTimer()
      provider?.dispose()
      provider = pack ? create(pack) : null
      requested = new Set()
      appearance.setProvider(provider)
      refreshNow()
    },
    { immediate: true },
  )

  watch(session.version, () => {
    const doc = session.current.value
    if (doc !== lastDoc) {
      // 設計図を開いた・閉じた：すぐ読む
      lastDoc = doc
      refreshNow()
      return
    }
    // 編集：状態が増えたときだけ、少し待って読む
    const bp = doc?.blueprint
    if (!provider || !bp) return
    const aliases = blueprintAliases(bp, content.pack)
    if (requestStates(bp, aliases).some((s) => !requested.has(s.key)) || aliases.some((a) => !requested.has(a.key))) {
      scheduleRefresh()
    }
  })

  onScopeDispose(() => {
    cancelTimer()
    provider?.dispose()
    provider = null
  })
}
