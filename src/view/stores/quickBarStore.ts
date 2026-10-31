// クイックバーの状態（docs/ui.md「クイックバー」。#197）。最近のブロックと固定、操作の並びを持ち、localStorage に保存する。
// 置くブロック（brushStore）の変化を見て、最近のブロックを足す。並びの計算は edit/quickBarModel.ts。

import { defineStore } from 'pinia'
import { shallowRef, watch } from 'vue'
import {
  DEFAULT_QUICK_ACTIONS,
  moveAction,
  parseQuickBar,
  recordUse,
  serializeQuickBar,
  toggleAction,
  togglePin,
  updateState,
  type QuickActionId,
  type QuickSlot,
} from '../edit/quickBarModel'
import { useBrushStore } from './brushStore'
import { useToolStore } from './toolStore'

export const QUICK_BAR_KEY = 'minecircuit.quickBar'

function load(): string | null {
  try {
    return localStorage.getItem(QUICK_BAR_KEY)
  } catch {
    return null
  }
}

function save(text: string): void {
  try {
    localStorage.setItem(QUICK_BAR_KEY, text)
  } catch {
    // 保存できなくても、その回だけ覚えていれば使える
  }
}

export const useQuickBarStore = defineStore('quickBar', () => {
  const brush = useBrushStore()
  const tools = useToolStore()
  const initial = parseQuickBar(load())
  /** 最近のブロック。固定したマスが左 */
  const slots = shallowRef<readonly QuickSlot[]>(initial.slots)
  /** バーに出す操作の並び */
  const actions = shallowRef<readonly QuickActionId[]>(initial.actions)
  /** バーから選んでいる間は true（並びを変えない） */
  let choosing = false

  function persist(): void {
    save(serializeQuickBar({ slots: slots.value, actions: actions.value }))
  }

  // 置くブロックが変わったら足す。同じブロックを回した・状態を選び直したときは、状態だけを変える
  watch(
    () => brush.state,
    (next, prev) => {
      if (!next || choosing) return
      const same = prev !== null && prev !== undefined && prev.id.toString() === next.id.toString()
      slots.value = same ? updateState(slots.value, next) : recordUse(slots.value, next)
      persist()
    },
    { flush: 'sync' },
  )

  /** index のマスのブロックを置くブロックにして、置くツールにする。マスがなければ false */
  function choose(index: number): boolean {
    const slot = slots.value[index]
    if (!slot) return false
    choosing = true
    try {
      brush.setFromBlock(slot.state)
    } finally {
      choosing = false
    }
    tools.setTool('place')
    return true
  }

  function pin(index: number): void {
    slots.value = togglePin(slots.value, index)
    persist()
  }

  function toggle(id: QuickActionId): void {
    actions.value = toggleAction(actions.value, id)
    persist()
  }

  function move(id: QuickActionId, delta: -1 | 1): void {
    actions.value = moveAction(actions.value, id, delta)
    persist()
  }

  function resetActions(): void {
    actions.value = [...DEFAULT_QUICK_ACTIONS]
    persist()
  }

  return { slots, actions, choose, pin, toggle, move, resetActions }
})
