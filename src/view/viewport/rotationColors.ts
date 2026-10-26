// 表示部分の「回転」の色（docs/ui.md「回転の表示」）。3D・2D・凡例で同じものを使う。
// 色は Create のゴーグルの速さの色（遅い 緑・中速 青・高速 紫）に寄せた。

import type { CalcRotation } from '../../calc/calcPlugin'

export type RotationColorKey = 'stopped' | 'slow' | 'medium' | 'fast' | 'overloaded'

export const ROTATION_COLORS: Readonly<Record<RotationColorKey, string>> = {
  stopped: '#8a8a8a',
  slow: '#2fbf4a',
  medium: '#1f86ff',
  fast: '#d04ad8',
  overloaded: '#e0402a',
}

/** 凡例の並びと文言 */
export const ROTATION_LEGEND: readonly { readonly key: RotationColorKey; readonly label: string }[] = [
  { key: 'stopped', label: '止まっている' },
  { key: 'slow', label: '遅い' },
  { key: 'medium', label: '中速' },
  { key: 'fast', label: '高速' },
  { key: 'overloaded', label: '過負荷' },
]

export function rotationColorKey(r: CalcRotation): RotationColorKey {
  return r.overloaded ? 'overloaded' : r.level
}

/** 回る向きの印を出すか。止まっているもの・過負荷で止まっているものは出さない */
export function showsDirection(r: CalcRotation): boolean {
  return r.rpm !== 0 && !r.overloaded
}
