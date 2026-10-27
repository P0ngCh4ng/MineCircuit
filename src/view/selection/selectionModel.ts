// 右パネル「選択範囲」（#130）の中身を作る。docs/ui.md「右パネル『選択範囲』」。
// 画面に依存しない計算だけを置く（部品は SelectionPanel.vue）。

import type { BlockState } from '../../domain/blockState'
import type { Blueprint } from '../../domain/blueprint'
import { boxFromCorners, clampBox, type Box } from '../../domain/box'
import type { Vec3 } from '../../domain/vec3'

/** 範囲の中にある1つのブロック状態と、その数 */
export interface StateCount {
  readonly state: BlockState
  readonly count: number
}

/** 範囲の中にある1つのブロックの種類（ID）と、その数 */
export interface KindCount {
  readonly id: string
  readonly count: number
}

/** 範囲の中の集計 */
export interface SelectionStats {
  /** 空きでないブロックの数 */
  readonly blockCount: number
  /** 種類（ID）ごとの数。多い順（同じ数なら ID の順） */
  readonly kinds: readonly KindCount[]
  /** ブロック状態ごとの数。多い順（同じ数なら key の順）。置き換えの「置き換える物」に使う */
  readonly states: readonly StateCount[]
}

/** パネルに出す種類の数（ui.md「多い順の種類（上位5つ）」） */
export const TOP_KINDS = 5

/**
 * 範囲の中のブロックを数える。範囲は設計図の大きさに切り詰める。
 * リージョンごとに重なる部分だけをたどるので、範囲が設計図より大きくても余計に回らない。
 * リージョンが重なる位置は、先のリージョンだけを数える（Blueprint.get と同じ）。
 */
export function selectionStats(bp: Blueprint, box: Box): SelectionStats {
  // 同じ状態はパレットの同じオブジェクトなので、まずオブジェクトで数え、あとで key でまとめる
  const byObject = new Map<BlockState, number>()
  const clamped = clampBox(box, bp.size)
  if (clamped) {
    const regions = bp.regions
    regions.forEach((region, ri) => {
      const lo: number[] = []
      const hi: number[] = []
      for (let a = 0; a < 3; a++) {
        lo.push(Math.max(clamped.min[a]!, region.offset[a]!) - region.offset[a]!)
        hi.push(Math.min(clamped.max[a]!, region.offset[a]! + region.size[a]! - 1) - region.offset[a]!)
        if (lo[a]! > hi[a]!) return
      }
      const overlapped = ri > 0
      for (let y = lo[1]!; y <= hi[1]!; y++) {
        for (let z = lo[2]!; z <= hi[2]!; z++) {
          for (let x = lo[0]!; x <= hi[0]!; x++) {
            const state = region.get(x, y, z)
            if (!state) continue
            if (overlapped) {
              const pos: Vec3 = [x + region.offset[0], y + region.offset[1], z + region.offset[2]]
              if (bp.locate(pos)?.region !== region) continue
            }
            byObject.set(state, (byObject.get(state) ?? 0) + 1)
          }
        }
      }
    })
  }

  const byKey = new Map<string, { state: BlockState; count: number }>()
  const byId = new Map<string, number>()
  let blockCount = 0
  for (const [state, count] of byObject) {
    blockCount += count
    const key = state.key
    const entry = byKey.get(key)
    if (entry) entry.count += count
    else byKey.set(key, { state, count })
    const id = state.id.toString()
    byId.set(id, (byId.get(id) ?? 0) + count)
  }

  const states = [...byKey.entries()]
    .sort(([ka, a], [kb, b]) => b.count - a.count || (ka < kb ? -1 : ka > kb ? 1 : 0))
    .map(([, v]) => ({ state: v.state, count: v.count }))
  const kinds = [...byId.entries()]
    .sort(([ia, a], [ib, b]) => b - a || (ia < ib ? -1 : ia > ib ? 1 : 0))
    .map(([id, count]) => ({ id, count }))
  return { blockCount, kinds, states }
}

/** 座標の欄の1つ（パネルの入力） */
export type BoxField = 'min' | 'max'

/**
 * 座標の欄に打った値で範囲を作り直す。axis は 0=x・1=y・2=z、value は画面の値（y は段なので1始まり）。
 * 最小が最大を越えたら入れ替え、設計図の大きさに切り詰める。数でなければ、設計図と重ならなければ null
 */
export function editBoxCoordinate(box: Box, field: BoxField, axis: number, value: number, size: Vec3): Box | null {
  if (!Number.isFinite(value)) return null
  const raw = Math.round(value) - (axis === 1 ? 1 : 0)
  const corner: [number, number, number] = [...box[field]] as [number, number, number]
  corner[axis] = raw
  const other = field === 'min' ? box.max : box.min
  return clampBox(boxFromCorners(corner, other), size)
}

/** 座標の欄に出す値（y は段なので1始まり） */
export function displayCoordinate(pos: Vec3, axis: number): number {
  return pos[axis]! + (axis === 1 ? 1 : 0)
}
