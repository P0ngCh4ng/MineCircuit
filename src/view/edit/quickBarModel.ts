// クイックバーの中身（docs/ui.md「クイックバー」。#197）。画面に依存しない計算だけを置く。
// - 最近のブロック：最大 9 マス。固定したマスを左端にまとめ、残りは新しいものを左に。同じ ID は1マスにまとめる
// - 操作：元に戻す・やり直す・回す・縦にする。出し入れと並べ替えができる
// - 保存：localStorage に JSON で。ブロック状態は `create:shaft[axis=y]` の形の文字で持つ

import type { BlockState } from '../../domain/blockState'
import { parseBlockStateInput } from './brushInput'

/** 最近のブロックのマスの数（1〜9 キー） */
export const QUICK_SLOT_COUNT = 9

/** 最近のブロックのマス1つ */
export interface QuickSlot {
  readonly state: BlockState
  /** 固定したか。固定したマスは押し出されず、状態も変えない */
  readonly pinned: boolean
}

export type QuickActionId = 'undo' | 'redo' | 'rotate' | 'rotateVertical'

export interface QuickActionInfo {
  readonly id: QuickActionId
  readonly label: string
  /** ボタンに重ねると出す説明 */
  readonly title: string
}

/** 入れられる操作。並びは初期の並び */
export const QUICK_ACTIONS: readonly QuickActionInfo[] = [
  { id: 'undo', label: '元に戻す', title: '元に戻す（Ctrl+Z）' },
  { id: 'redo', label: 'やり直す', title: 'やり直す（Ctrl+Y）' },
  { id: 'rotate', label: '回す', title: '水平に回す。範囲なら右回りに 90°（R）' },
  { id: 'rotateVertical', label: '縦にする', title: '縦にする。範囲なら左回りに 90°（Shift+R）' },
]

export const DEFAULT_QUICK_ACTIONS: readonly QuickActionId[] = QUICK_ACTIONS.map((a) => a.id)

const sameBlock = (a: BlockState, b: BlockState) => a.id.toString() === b.id.toString()

/** 固定したマスを左、残りを後ろにして、9 マスに切る */
function arrange(slots: readonly QuickSlot[]): QuickSlot[] {
  return [...slots.filter((s) => s.pinned), ...slots.filter((s) => !s.pinned)].slice(0, QUICK_SLOT_COUNT)
}

/**
 * 置くブロックにしたブロックを足す（棚・ID の入力・スポイトから選んだとき）。
 * 同じ ID のマスがあれば、固定していなければ状態を変えて固定していないマスの先頭へ動かす。固定していれば何もしない
 */
export function recordUse(slots: readonly QuickSlot[], state: BlockState): QuickSlot[] {
  const same = slots.find((s) => sameBlock(s.state, state))
  if (same?.pinned) return [...slots]
  const rest = slots.filter((s) => s !== same)
  return arrange([...rest.filter((s) => s.pinned), { state, pinned: false }, ...rest.filter((s) => !s.pinned)])
}

/** 置くブロックを回した・状態を選び直したとき。同じ ID の固定していないマスの状態だけを変え、並びは変えない */
export function updateState(slots: readonly QuickSlot[], state: BlockState): QuickSlot[] {
  return slots.map((s) => (!s.pinned && sameBlock(s.state, state) ? { state, pinned: false } : s))
}

/** index のマスの固定を切り替える。固定したマスは固定の並びの最後に、外したマスは固定していないマスの先頭に置く */
export function togglePin(slots: readonly QuickSlot[], index: number): QuickSlot[] {
  const target = slots[index]
  if (!target) return [...slots]
  const rest = slots.filter((_, i) => i !== index)
  const pinned = rest.filter((s) => s.pinned)
  const unpinned = rest.filter((s) => !s.pinned)
  return arrange([...pinned, { state: target.state, pinned: !target.pinned }, ...unpinned])
}

/** 操作の出し入れ。入れるときは初期の並びでの位置に近い所に足す */
export function toggleAction(actions: readonly QuickActionId[], id: QuickActionId): QuickActionId[] {
  if (actions.includes(id)) return actions.filter((a) => a !== id)
  const order = DEFAULT_QUICK_ACTIONS.indexOf(id)
  const at = actions.findIndex((a) => DEFAULT_QUICK_ACTIONS.indexOf(a) > order)
  return at < 0 ? [...actions, id] : [...actions.slice(0, at), id, ...actions.slice(at)]
}

/** 操作を1つ前（-1）・後ろ（+1）へ動かす。端なら動かさない */
export function moveAction(actions: readonly QuickActionId[], id: QuickActionId, delta: -1 | 1): QuickActionId[] {
  const i = actions.indexOf(id)
  const j = i + delta
  if (i < 0 || j < 0 || j >= actions.length) return [...actions]
  const next = [...actions]
  next[i] = actions[j]!
  next[j] = id
  return next
}

/** 保存する形 */
export interface QuickBarData {
  readonly slots: readonly QuickSlot[]
  readonly actions: readonly QuickActionId[]
}

interface StoredQuickBar {
  version: 1
  slots: { state: string; pinned: boolean }[]
  actions: string[]
}

export function serializeQuickBar(data: QuickBarData): string {
  const stored: StoredQuickBar = {
    version: 1,
    slots: data.slots.map((s) => ({ state: s.state.key, pinned: s.pinned })),
    actions: [...data.actions],
  }
  return JSON.stringify(stored)
}

function isQuickActionId(v: unknown): v is QuickActionId {
  return typeof v === 'string' && (DEFAULT_QUICK_ACTIONS as readonly string[]).includes(v)
}

function parseStoredState(text: string): BlockState | null {
  try {
    return parseBlockStateInput(text)
  } catch {
    return null
  }
}

/** 保存したものを読む。読めない所は捨てる。text が null か形が違えば初期の並び */
export function parseQuickBar(text: string | null): QuickBarData {
  const empty: QuickBarData = { slots: [], actions: [...DEFAULT_QUICK_ACTIONS] }
  if (text === null) return empty
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return empty
  }
  if (typeof raw !== 'object' || raw === null || (raw as { version?: unknown }).version !== 1) return empty
  const { slots, actions } = raw as { slots?: unknown; actions?: unknown }
  const readSlots: QuickSlot[] = []
  for (const s of Array.isArray(slots) ? (slots as unknown[]) : []) {
    if (typeof s !== 'object' || s === null) continue
    const { state, pinned } = s as { state?: unknown; pinned?: unknown }
    if (typeof state !== 'string') continue
    const parsed = parseStoredState(state)
    if (!parsed || readSlots.some((r) => sameBlock(r.state, parsed))) continue
    readSlots.push({ state: parsed, pinned: pinned === true })
  }
  const readActions = Array.isArray(actions) ? [...new Set((actions as unknown[]).filter(isQuickActionId))] : empty.actions
  return { slots: arrange(readSlots), actions: readActions }
}
