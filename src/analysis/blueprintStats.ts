// 設計図の集計（docs/design.md「analysis：集計と検索」）。
// ブロックの ID ごとの数（全体・段ごと）、ブロックのある範囲、合計の数を出す。
// ID は properties を含めない（"create:shaft"）。向きの違いは同じ種類として数える。
// リージョンが重なる位置は、先のリージョンだけを数える（Blueprint と同じ規則）。

import type { BlockState } from '../domain/blockState'
import type { Blueprint } from '../domain/blueprint'
import type { Vec3 } from '../domain/vec3'
import { isAir } from '../io/readers/nbtBlueprintReader'

/** ブロックのある範囲。min と max はどちらも、ブロックのあるマスの座標（max も含む） */
export interface BlockBounds {
  readonly min: Vec3
  readonly max: Vec3
}

/** 設計図全体の合計 */
export interface BlueprintTotals {
  /** 空きでないブロックの数 */
  readonly blockCount: number
  /** ブロックの ID の種類の数（properties の違いは数えない） */
  readonly kindCount: number
  /** 生データ（ブロックエンティティ）を持つブロックの数 */
  readonly blockEntityCount: number
  /** エンティティ（額縁、防具立てなど）の数 */
  readonly entityCount: number
}

interface FullPass {
  readonly counts: Map<string, number>
  readonly bounds: BlockBounds | null
  readonly totals: BlueprintTotals
}

/** 数の多い順、同じなら ID の名前順に並べ直す */
function sortCounts(counts: Map<string, number>): Map<string, number> {
  return new Map([...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)))
}

function addCount(counts: Map<string, number>, state: BlockState): void {
  const id = state.id.toString()
  counts.set(id, (counts.get(id) ?? 0) + 1)
}

/**
 * 設計図1つの集計。作った後に設計図が編集されたら、作り直すこと（結果を中に覚えておくため）。
 * 空気（minecraft:air など）は数えない。
 */
export class BlueprintStats {
  private full: FullPass | null = null

  constructor(private readonly bp: Blueprint) {}

  /** ID ごとのブロック数。数の多い順、同じなら ID の名前順 */
  countAll(): Map<string, number> {
    return new Map(this.pass().counts)
  }

  /** 段 y（0 始まり）の ID ごとのブロック数。並びは countAll と同じ。範囲外の段は空 */
  countLayer(y: number): Map<string, number> {
    const counts = new Map<string, number>()
    this.bp.forEachInLayer(y, (_pos, state) => {
      if (!isAir(state)) addCount(counts, state)
    })
    return sortCounts(counts)
  }

  /** ブロックのある範囲。ブロックが1つもなければ null */
  bounds(): BlockBounds | null {
    return this.pass().bounds
  }

  /** 設計図全体の合計（ブロック数、種類、nbt 付き、エンティティ） */
  totals(): BlueprintTotals {
    return this.pass().totals
  }

  /** 全体を1回だけ見て、ID ごとの数・範囲・合計をまとめて作る */
  private pass(): FullPass {
    if (this.full) return this.full
    const counts = new Map<string, number>()
    const min = [Infinity, Infinity, Infinity]
    const max = [-Infinity, -Infinity, -Infinity]
    let blockCount = 0
    let blockEntityCount = 0
    let entityCount = 0
    this.bp.regions.forEach((region, ri) => {
      entityCount += region.entities.length
      const [ox, oy, oz] = region.offset
      region.forEachBlock((x, y, z, state, blockEntity) => {
        if (isAir(state)) return
        const pos: Vec3 = [x + ox, y + oy, z + oz]
        if (ri > 0 && this.bp.locate(pos)?.region !== region) return
        blockCount++
        if (blockEntity) blockEntityCount++
        addCount(counts, state)
        for (let a = 0; a < 3; a++) {
          if (pos[a] < min[a]) min[a] = pos[a]
          if (pos[a] > max[a]) max[a] = pos[a]
        }
      })
    })
    this.full = {
      counts: sortCounts(counts),
      bounds: blockCount > 0 ? { min: [min[0], min[1], min[2]], max: [max[0], max[1], max[2]] } : null,
      totals: { blockCount, kindCount: counts.size, blockEntityCount, entityCount },
    }
    return this.full
  }
}
