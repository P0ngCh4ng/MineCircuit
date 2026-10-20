// 強調しているブロックの位置。3D/2D表示がこれを見て、強調するブロック以外を薄く描く。
// 開く・編集・戻すたびに探し直す。別の設計図を開いたら強調を解除する。

import { computed, watch, type ComputedRef } from 'vue'
import { BlockSearch } from '../../analysis/blockSearch'
import type { Vec3 } from '../../domain/vec3'
import { useDocumentSession } from '../document/documentSession'
import { useSearchStore } from '../stores/searchStore'

const search = new BlockSearch()

/** 部品の setup の中で呼ぶ。強調していなければ null、強調しているがブロックがなければ空の配列 */
export function useSearchHighlight(): ComputedRef<readonly Vec3[] | null> {
  const session = useDocumentSession()
  const store = useSearchStore()

  watch(
    () => session.current.value?.blueprint ?? null,
    (bp, before) => {
      if (bp !== before) store.clearHighlight()
    },
  )

  return computed(() => {
    void session.version.value
    const bp = session.current.value?.blueprint
    const id = store.highlightId
    if (!bp || id === null) return null
    return search.find(bp, id)
  })
}
