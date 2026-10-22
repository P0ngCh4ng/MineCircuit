import { defineStore } from 'pinia'
import { computed, markRaw, ref, shallowRef } from 'vue'
import type { AppearanceSet } from '../../domain/blockModel'

/** ブロックの描き方。テクスチャ（モデルとテクスチャ）か、色（色付きの箱） */
export type AppearanceMode = 'texture' | 'color'

/**
 * ブロックの見た目（docs/design.md「見た目（モデルとテクスチャ）」）。
 * - set：用意できた見た目。Modpack がない、まだ読んでいないときは null（色付きの箱で描く）
 * - mode：「テクスチャ／色」の切り替え
 * - active：描画が使う見た目。色にしているか、見た目がなければ null
 * AppearanceSet は大きな素のデータなので、リアクティブにしない（markRaw）
 */
export const useAppearanceStore = defineStore('appearance', () => {
  const set = shallowRef<AppearanceSet | null>(null)
  const mode = ref<AppearanceMode>('texture')

  const active = computed<AppearanceSet | null>(() => (mode.value === 'texture' ? set.value : null))

  function setAppearanceSet(next: AppearanceSet | null): void {
    set.value = next ? markRaw(next) : null
  }

  function setMode(next: AppearanceMode): void {
    mode.value = next
  }

  return { set, mode, active, setAppearanceSet, setMode }
})
