// ブロックの検索（docs/design.md「analysis：集計と検索」）。
// - 絞り込み：ブロック一覧の行（ID と表示名）が、入力した言葉に合うか
// - 場所：設計図の中で、ある ID のブロックがどこにあるか（強調表示に使う）
// ID は properties を含めない（"create:shaft"）。向きの違いは同じ種類として扱う（BlueprintStats と同じ）。

import type { Blueprint } from '../domain/blueprint'
import { ResourceLocation } from '../domain/resourceLocation'
import type { Vec3 } from '../domain/vec3'
import { isAir } from '../io/readers/nbtBlueprintReader'

/** 絞り込みの言葉。空白で区切った言葉を小文字にして持つ */
export interface BlockQuery {
  readonly terms: readonly string[]
}

/** 入力欄の文字を言葉に分ける。全角の空白でも区切る（\s は U+3000 も含む） */
export function parseBlockQuery(text: string): BlockQuery {
  return { terms: text.toLowerCase().split(/\s+/).filter((t) => t.length > 0) }
}

/** 言葉がなければ true（何も絞り込まない） */
export function isEmptyQuery(query: BlockQuery): boolean {
  return query.terms.length === 0
}

/**
 * ID と表示名が、すべての言葉に合えば true。
 * 言葉ごとに、ID（"create:shaft"）か表示名のどちらかに含まれていればよい。大文字と小文字は区別しない。
 * 表示名は Modpack を読み込んでいないときは null。
 */
export function matchesBlockQuery(query: BlockQuery, id: string, displayName: string | null): boolean {
  const lowerId = id.toLowerCase()
  const lowerName = displayName?.toLowerCase() ?? ''
  return query.terms.every((t) => lowerId.includes(t) || lowerName.includes(t))
}

/** ブロックの properties の条件。書いた項目がすべて同じ値なら合う */
export type PropertyFilter = Readonly<Record<string, string>>

export class BlockSearch {
  /**
   * id のブロックの位置（設計図全体の座標）。properties を渡すと、その値のブロックだけにする。
   * 並びは y → z → x の小さい順。空気は探さない。リージョンが重なる位置は先のリージョンだけを見る。
   */
  find(bp: Blueprint, id: ResourceLocation | string, properties: PropertyFilter | null = null): Vec3[] {
    const target = typeof id === 'string' ? ResourceLocation.parse(id).toString() : id.toString()
    const found: Vec3[] = []
    bp.regions.forEach((region, ri) => {
      const [ox, oy, oz] = region.offset
      region.forEachBlock((x, y, z, state) => {
        if (isAir(state) || state.id.toString() !== target) return
        if (properties) {
          for (const [k, v] of Object.entries(properties)) {
            if (state.properties[k] !== v) return
          }
        }
        const pos: Vec3 = [x + ox, y + oy, z + oz]
        if (ri > 0 && bp.locate(pos)?.region !== region) return
        found.push(pos)
      })
    })
    return found.sort((a, b) => a[1] - b[1] || a[2] - b[2] || a[0] - b[0])
  }
}
