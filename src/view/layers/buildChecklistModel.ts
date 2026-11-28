// 建築チェックリストの保存の形（docs/design.md「アプリ独自のファイル」「view：画面」。#274）。画面に依存しない計算だけを置く。
// - 設計図の見分け方：ファイル名と大きさ（`mill.nbt|9x12x7`）
// - 保存：localStorage に JSON で。{ version: 1, entries: [[見分け, [建て終えた段の y, ...]], ...] }。新しく使った順
// - 覚える設計図の数は CHECKLIST_MEMORY まで。チェックが1つもない設計図は覚えない

import type { Vec3 } from '../../domain/vec3'

/** 覚えておく設計図の数 */
export const CHECKLIST_MEMORY = 30

/** 設計図ごとの建て終えた段。新しく使った順 */
export type ChecklistEntries = ReadonlyMap<string, readonly number[]>

/** 設計図の見分け。同じ名前・同じ大きさなら同じ設計図とみなす */
export function checklistKey(fileName: string, size: Vec3): string {
  return `${fileName}|${size[0]}x${size[1]}x${size[2]}`
}

function isLayerList(v: unknown): v is number[] {
  return Array.isArray(v) && v.every((y) => Number.isInteger(y) && (y as number) >= 0)
}

/** 保存した文字を読む。壊れていれば空から始める */
export function parseChecklist(text: string | null): ChecklistEntries {
  const entries = new Map<string, readonly number[]>()
  if (!text) return entries
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return entries
  }
  if (typeof data !== 'object' || data === null) return entries
  const list = (data as { entries?: unknown }).entries
  if (!Array.isArray(list)) return entries
  for (const item of list) {
    if (!Array.isArray(item) || item.length !== 2) continue
    const [key, layers] = item as [unknown, unknown]
    if (typeof key !== 'string' || !isLayerList(layers) || layers.length === 0 || entries.has(key)) continue
    entries.set(key, [...new Set(layers)].sort((a, b) => a - b))
    if (entries.size >= CHECKLIST_MEMORY) break
  }
  return entries
}

export function serializeChecklist(entries: ChecklistEntries): string {
  return JSON.stringify({ version: 1, entries: [...entries] })
}

/**
 * key の設計図の建て終えた段を done にして、新しく使った設計図として先頭に置く。
 * done が空なら忘れる。CHECKLIST_MEMORY を超えた古い設計図は忘れる
 */
export function withDoneLayers(entries: ChecklistEntries, key: string, done: Iterable<number>): ChecklistEntries {
  const layers = [...new Set(done)].sort((a, b) => a - b)
  const next = new Map<string, readonly number[]>()
  if (layers.length > 0) next.set(key, layers)
  for (const [k, v] of entries) {
    if (k === key) continue
    if (next.size >= CHECKLIST_MEMORY) break
    next.set(k, v)
  }
  return next
}
