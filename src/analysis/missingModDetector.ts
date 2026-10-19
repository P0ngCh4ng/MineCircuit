// 足りない Mod の検出（docs/design.md「analysis：集計と検索」）。
// 設計図に出てくるブロックの namespace のうち、Modpack に入っていないものを探す。
// Modpack がない（null）ときは何も分からないので、足りないものは出さない。

import type { Blueprint } from '../domain/blueprint'
import type { Modpack } from '../io/modpack/modpack'
import { isAir } from '../io/readers/nbtBlueprintReader'

/** 検出に使う Modpack の部分。namespace があるかだけ分かればよい */
export type NamespaceLookup = Pick<Modpack, 'hasNamespace'>

/** 設計図で使っている namespace 1つ分 */
export interface NamespaceUsage {
  /** namespace（"create"） */
  readonly namespace: string
  /** その namespace のブロックの数（空気を除く） */
  readonly blockCount: number
  /** Modpack に入っていない。Modpack がないときは常に false */
  readonly missing: boolean
}

/** 設計図で使っている namespace ごとのブロック数。数の多い順、同じなら名前順 */
export function countNamespaces(bp: Blueprint): Map<string, number> {
  const counts = new Map<string, number>()
  for (const region of bp.regions) {
    region.forEachBlock((_x, _y, _z, state) => {
      if (isAir(state)) return
      const ns = state.id.namespace
      counts.set(ns, (counts.get(ns) ?? 0) + 1)
    })
  }
  return new Map([...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))
}

export class MissingModDetector {
  /** 足りない namespace の一覧（名前順）。Modpack がないときは空 */
  detect(bp: Blueprint, pack: NamespaceLookup | null): string[] {
    if (!pack) return []
    return [...bp.namespaces].filter((ns) => !pack.hasNamespace(ns)).sort()
  }

  /**
   * 使っている namespace の一覧と、それぞれが足りないか。
   * 足りないものを先に、その中はブロックの多い順に並べる。
   */
  usage(bp: Blueprint, pack: NamespaceLookup | null): NamespaceUsage[] {
    const result: NamespaceUsage[] = []
    for (const [namespace, blockCount] of countNamespaces(bp)) {
      result.push({ namespace, blockCount, missing: pack !== null && !pack.hasNamespace(namespace) })
    }
    // sort は安定なので、同じグループの中は countNamespaces の順のまま
    return result.sort((a, b) => Number(b.missing) - Number(a.missing))
  }
}
