// 書き出しの前に知らせること（docs/design.md「ゲームとの行き来」）。
// アプリで置いたブロックには生データ（nbt）がないので、ゲームに持ち込むと初期値になる。その数を数える。

import type { Blueprint } from '../../domain/blueprint'
import { isAir } from '../readers/nbtBlueprintReader'

/** 生データのないブロックの、ID ごとの数 */
export interface MissingBlockEntity {
  /** ブロックの ID（"create:creative_motor"） */
  id: string
  count: number
}

export interface ExportSummary {
  /** 置かれているブロックの数（空気を除く） */
  blockCount: number
  /** 使っているブロック状態の種類 */
  stateCount: number
  /** 生データのあるブロックの数 */
  blockEntityCount: number
  /** 生データを持つはずなのに持っていないブロックの数 */
  missingBlockEntityCount: number
  /** missingBlockEntityCount の内訳。数の多い順 */
  missingBlockEntities: MissingBlockEntity[]
}

export interface ExportSummaryOptions {
  /**
   * ID のブロックが生データを持つ種類か。Modpack から分かるときに渡す。
   * null のときは、同じ設計図の中で同じ ID のブロックが生データを持っているかで判断する。
   */
  hasBlockEntity?: ((id: string) => boolean) | null
}

/**
 * 書き出しの前に知らせる数を数える。
 *
 * 「生データを持つはずのブロック」は、hasBlockEntity が true を返す ID か、
 * 同じ設計図の中に生データ付きのブロックがある ID。
 * Modpack がないときは後者だけで判断するので、設計図の中にない種類は数えない（少なめに出る）。
 */
export function exportSummary(bp: Blueprint, options: ExportSummaryOptions = {}): ExportSummary {
  const hasBlockEntity = options.hasBlockEntity ?? null
  let blockCount = 0
  let blockEntityCount = 0
  const states = new Set<string>()
  const idsWithData = new Set<string>()
  const withoutData = new Map<string, number>()

  for (const region of bp.regions) {
    region.forEachBlock((_x, _y, _z, state, blockEntity) => {
      if (isAir(state)) return
      blockCount++
      states.add(state.key)
      const id = state.id.toString()
      if (blockEntity) {
        blockEntityCount++
        idsWithData.add(id)
      } else {
        withoutData.set(id, (withoutData.get(id) ?? 0) + 1)
      }
    })
  }

  const missingBlockEntities = [...withoutData]
    .filter(([id]) => idsWithData.has(id) || (hasBlockEntity !== null && hasBlockEntity(id)))
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id))

  return {
    blockCount,
    stateCount: states.size,
    blockEntityCount,
    missingBlockEntityCount: missingBlockEntities.reduce((sum, m) => sum + m.count, 0),
    missingBlockEntities,
  }
}
