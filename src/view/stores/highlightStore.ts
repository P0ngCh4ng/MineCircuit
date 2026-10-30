// 強調を1つにまとめる（#163。docs/ui.md「強調」）。
// 強調は3つの出どころがある：ブロック一覧の ID（searchStore）、同じブロック（measureStore）、
// ネットワーク（probeStore。ネットワークのツール・プローブ・問題やネット一覧から移る）。
// 同時に出すのは1つだけにし、新しく強調したら前の強調を消す。Esc と「強調を解除」で全部消す。

import { defineStore } from 'pinia'
import { computed, watch } from 'vue'
import { useMeasureStore } from './measureStore'
import { useProbeStore } from './probeStore'
import { useSearchStore } from './searchStore'

/** 今の強調の種類。強調していなければ null */
export type HighlightKind = 'search' | 'sameBlock' | 'network'

export const useHighlightStore = defineStore('highlight', () => {
  const search = useSearchStore()
  const measures = useMeasureStore()
  const probe = useProbeStore()

  const kind = computed<HighlightKind | null>(() => {
    if (probe.probedPos !== null) return 'network'
    if (measures.sameBlockStart !== null) return 'sameBlock'
    if (search.highlightId !== null) return 'search'
    return null
  })

  const active = computed(() => kind.value !== null)

  // 新しく強調したら、ほかの強調を消す。値を入れたその場で消す（描き直しの前に1つにする）
  watch(
    () => search.highlightId,
    (id) => {
      if (id === null) return
      measures.setSameBlockStart(null)
      probe.setProbed(null)
    },
    { flush: 'sync' },
  )
  watch(
    () => measures.sameBlockStart,
    (pos) => {
      if (pos === null) return
      search.clearHighlight()
      probe.setProbed(null)
    },
    { flush: 'sync' },
  )
  watch(
    () => probe.probedPos,
    (pos) => {
      if (pos === null) return
      search.clearHighlight()
      measures.setSameBlockStart(null)
    },
    { flush: 'sync' },
  )

  /** すべての強調を消す。消すものがあれば true */
  function clearAll(): boolean {
    const had = active.value
    search.clearHighlight()
    measures.setSameBlockStart(null)
    probe.setProbed(null)
    return had
  }

  return { kind, active, clearAll }
})
