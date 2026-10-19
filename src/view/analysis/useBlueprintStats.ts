// 開いている設計図の集計（BlueprintStats）。開く・編集・戻すたびに作り直す。
// 上のバーとブロック一覧で同じ集計を使うよう、設計図と version ごとに1つだけ作る。

import { computed, type ComputedRef } from 'vue'
import { BlueprintStats } from '../../analysis/blueprintStats'
import type { Blueprint } from '../../domain/blueprint'
import { useDocumentSession } from '../document/documentSession'

const cache = new WeakMap<Blueprint, { version: number; stats: BlueprintStats }>()

/** bp の version 時点の集計。同じ組み合わせなら前に作ったものを返す */
export function statsFor(bp: Blueprint, version: number): BlueprintStats {
  const hit = cache.get(bp)
  if (hit && hit.version === version) return hit.stats
  const stats = new BlueprintStats(bp)
  cache.set(bp, { version, stats })
  return stats
}

/** 部品の setup の中で呼ぶ。設計図がなければ null */
export function useBlueprintStats(): ComputedRef<BlueprintStats | null> {
  const session = useDocumentSession()
  return computed(() => {
    const version = session.version.value
    const bp = session.current.value?.blueprint
    return bp ? statsFor(bp, version) : null
  })
}
