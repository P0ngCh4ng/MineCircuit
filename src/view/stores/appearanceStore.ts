import { defineStore } from 'pinia'
import { computed, markRaw, ref, shallowRef } from 'vue'
import type { AppearanceSet } from '../../domain/blockModel'
import type { BlockState } from '../../domain/blockState'
import type { AppearanceProvider } from '../../io/assets/assetTypes'
import { withAliases, type AppearanceAlias } from '../../io/assets/blockEntityAppearance'

/** ブロックの描き方。テクスチャ（モデルとテクスチャ）か、色（色付きの箱） */
export type AppearanceMode = 'texture' | 'color'

function errorMessage(e: unknown): string {
  const detail = e instanceof Error ? e.message : String(e)
  return `ブロックの見た目を読めませんでした（${detail}）。色で表示します。Modpack を選び直すと、もう一度読みます。`
}

/**
 * ブロックの見た目（docs/design.md「見た目（モデルとテクスチャ）」）。
 * - set：用意できた見た目。Modpack がない、まだ読んでいないときは null（色付きの箱で描く）
 * - mode：「テクスチャ／色」の切り替え（利用者が選んだもの）
 * - active：描画が使う見た目。色にしているか、見た目がなければ null
 * - 中身は AppearanceProvider から受け取る（setProvider → refresh。#85）。本物の provider は view/stores/appearanceSync.ts が Modpack から作って渡す（#86）
 * AppearanceSet は大きな素のデータなので、リアクティブにしない（markRaw）
 */
export const useAppearanceStore = defineStore('appearance', () => {
  // provider は画面の状態ではないので、リアクティブにしない
  let provider: AppearanceProvider | null = null
  /** 読み込みの番号。古い読み込みの結果を捨てるのに使う */
  let seq = 0

  const set = shallowRef<AppearanceSet | null>(null)
  const mode = ref<AppearanceMode>('texture')
  /** 読み込み中か */
  const loading = ref(false)
  /** 読み込みが失敗したときの文言。なければ null */
  const error = ref<string | null>(null)

  const active = computed<AppearanceSet | null>(() => (mode.value === 'texture' ? set.value : null))
  /** テクスチャで描けるか（見た目があるか） */
  const available = computed(() => set.value !== null)
  /** 実際の描き方。見た目がなければ、選んだものによらず色 */
  const effectiveMode = computed<AppearanceMode>(() => (active.value !== null ? 'texture' : 'color'))
  /** 読めなかったことの件数（AppearanceSet.problems） */
  const problemCount = computed(() => set.value?.problems.length ?? 0)

  /** 見た目を直接入れ替える。null で消す。読み込み中のものは捨てる */
  function setAppearanceSet(next: AppearanceSet | null): void {
    seq++
    loading.value = false
    error.value = null
    set.value = next ? markRaw(next) : null
  }

  function setMode(next: AppearanceMode): void {
    mode.value = next
  }

  /** 見た目を用意する provider を入れ替える。null（Modpack がない）なら見た目を消す */
  function setProvider(next: AppearanceProvider | null): void {
    provider = next
    setAppearanceSet(null)
  }

  /**
   * 設計図に出てくるブロック状態の見た目を、provider から読み直す。
   * aliases は、生データで見た目が変わるマスの、見た目を借りる先（借りる先の状態は states に入れておく）。
   * provider がなければ何もしない。読み込みの途中で呼び直したら、前の結果は捨てる
   */
  async function refresh(states: readonly BlockState[], aliases: readonly AppearanceAlias[] = []): Promise<void> {
    const p = provider
    if (p === null) return
    const mine = ++seq
    loading.value = true
    error.value = null
    try {
      const result = await p.prepare(states)
      if (mine !== seq) return
      set.value = markRaw(withAliases(result, aliases))
    } catch (e) {
      if (mine !== seq) return
      set.value = null
      error.value = errorMessage(e)
    } finally {
      if (mine === seq) loading.value = false
    }
  }

  return {
    set,
    mode,
    active,
    setAppearanceSet,
    setMode,
    loading,
    error,
    available,
    effectiveMode,
    problemCount,
    setProvider,
    refresh,
  }
})
