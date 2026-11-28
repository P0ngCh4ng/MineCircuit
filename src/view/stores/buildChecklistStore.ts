// 建築チェックリストの建て終えた段（docs/ui.md「建築チェックリスト」。#274）。設計図ごとに持ち、localStorage に保存する。
// 設計図のデータは持たない。設計図の見分けと保存の形は layers/buildChecklistModel.ts、
// 開いている設計図とのつなぎは layers/useBuildChecklist.ts。

import { defineStore } from 'pinia'
import { shallowRef } from 'vue'
import { parseChecklist, serializeChecklist, withDoneLayers, type ChecklistEntries } from '../layers/buildChecklistModel'

export const BUILD_CHECKLIST_KEY = 'minecircuit.buildChecklist'

function load(): string | null {
  try {
    return localStorage.getItem(BUILD_CHECKLIST_KEY)
  } catch {
    return null
  }
}

function save(text: string): void {
  try {
    localStorage.setItem(BUILD_CHECKLIST_KEY, text)
  } catch {
    // 保存できなくても、開いている間は覚えている
  }
}

const EMPTY: ReadonlySet<number> = new Set()

export const useBuildChecklistStore = defineStore('buildChecklist', () => {
  const entries = shallowRef<ChecklistEntries>(parseChecklist(load()))

  /** key の設計図の建て終えた段 */
  function doneLayers(key: string): ReadonlySet<number> {
    const layers = entries.value.get(key)
    return layers ? new Set(layers) : EMPTY
  }

  function setAll(key: string, done: Iterable<number>): void {
    entries.value = withDoneLayers(entries.value, key, done)
    save(serializeChecklist(entries.value))
  }

  /** 段 y を建て終えた（done）か、まだ（!done）にする */
  function setDone(key: string, y: number, done: boolean): void {
    const next = new Set(doneLayers(key))
    if (done) next.add(y)
    else next.delete(y)
    setAll(key, next)
  }

  /** key の設計図のチェックをすべて外す */
  function clear(key: string): void {
    setAll(key, [])
  }

  return { entries, doneLayers, setDone, clear }
})
