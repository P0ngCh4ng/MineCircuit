// 開いている設計図の建築チェックリスト（docs/ui.md「建築チェックリスト」。#274）。
// 段ごとの要るブロック（analysis/buildChecklist.ts）と、建て終えた段（stores/buildChecklistStore.ts）をつなぐ。

import { computed, type ComputedRef } from 'vue'
import {
  buildChecklist,
  checklistProgress,
  type ChecklistLayer,
  type ChecklistProgress,
} from '../../analysis/buildChecklist'
import { useBlueprintStats } from '../analysis/useBlueprintStats'
import { useDocumentSession } from '../document/documentSession'
import { useBuildChecklistStore } from '../stores/buildChecklistStore'
import { checklistKey } from './buildChecklistModel'

export interface BuildChecklist {
  /** 段ごとの要るブロック。下の段から順。設計図がなければ空 */
  readonly layers: ComputedRef<readonly ChecklistLayer[]>
  /** 建て終えた段（y） */
  readonly done: ComputedRef<ReadonlySet<number>>
  readonly progress: ComputedRef<ChecklistProgress>
  setDone(y: number, done: boolean): void
  /** この設計図のチェックをすべて外す */
  clear(): void
}

/** 部品の setup の中で呼ぶ */
export function useBuildChecklist(): BuildChecklist {
  const session = useDocumentSession()
  const stats = useBlueprintStats()
  const store = useBuildChecklistStore()

  const key = computed(() => {
    void session.version.value
    const doc = session.current.value
    return doc ? checklistKey(doc.fileName, doc.blueprint.size) : null
  })

  const layers = computed<readonly ChecklistLayer[]>(() => {
    const s = stats.value
    const bp = session.current.value?.blueprint
    return s && bp ? buildChecklist(s, bp.size[1]) : []
  })

  const done = computed<ReadonlySet<number>>(() => {
    void store.entries
    return key.value ? store.doneLayers(key.value) : new Set()
  })

  const progress = computed(() => checklistProgress(layers.value, done.value))

  return {
    layers,
    done,
    progress,
    setDone(y, value) {
      if (key.value) store.setDone(key.value, y, value)
    },
    clear() {
      if (key.value) store.clear(key.value)
    },
  }
}
