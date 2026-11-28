// 段ごとの建築チェックリストの集計（docs/design.md「analysis：集計と検索」。#274）。
// BlueprintStats.countLayer を段ごとに並べ、建て終えた段の進み具合を数えるだけにする。
// Mod ごとの意味づけはしない（どの設計図でも同じに使う）。

import type { BlueprintStats } from './blueprintStats'

/** 段1つ分の、要るブロックの数 */
export interface ChecklistItem {
  /** ブロックの ID（properties なし） */
  readonly id: string
  readonly count: number
}

/** チェックリストの段1つ */
export interface ChecklistLayer {
  /** 段（0 始まり） */
  readonly y: number
  /** その段のブロック数 */
  readonly total: number
  /** ID ごとの数。数の多い順、同じなら ID の名前順（countLayer と同じ） */
  readonly items: readonly ChecklistItem[]
}

/** 建て終えた段の進み具合。ブロックのない段は数えない */
export interface ChecklistProgress {
  /** ブロックのある段の数 */
  readonly layerCount: number
  /** そのうち建て終えた段の数 */
  readonly doneLayerCount: number
  /** 設計図のブロック数（ブロックのある段の合計） */
  readonly blockCount: number
  /** 建て終えた段のブロック数の合計 */
  readonly doneBlockCount: number
}

/** 高さ height の設計図の、段ごとのチェックリスト。下の段から順に、空の段も入れる */
export function buildChecklist(stats: BlueprintStats, height: number): ChecklistLayer[] {
  const layers: ChecklistLayer[] = []
  for (let y = 0; y < height; y++) {
    const items = [...stats.countLayer(y)].map(([id, count]) => ({ id, count }))
    layers.push({ y, total: items.reduce((sum, i) => sum + i.count, 0), items })
  }
  return layers
}

/** 建て終えた段（y の集合）から進み具合を数える。チェックリストにない段・空の段のチェックは数えない */
export function checklistProgress(layers: readonly ChecklistLayer[], done: ReadonlySet<number>): ChecklistProgress {
  let layerCount = 0
  let doneLayerCount = 0
  let blockCount = 0
  let doneBlockCount = 0
  for (const layer of layers) {
    if (layer.total === 0) continue
    layerCount++
    blockCount += layer.total
    if (done.has(layer.y)) {
      doneLayerCount++
      doneBlockCount += layer.total
    }
  }
  return { layerCount, doneLayerCount, blockCount, doneBlockCount }
}
