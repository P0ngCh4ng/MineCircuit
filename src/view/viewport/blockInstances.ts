// 3D表示で描くブロックを、種類（ID）ごとにまとめる。Three.js に依存しない部分。
// BlueprintMeshBuilder がこの結果から InstancedMesh を作る。
//
// 段の表示方法（すべて・上を消す・上を半透明・この段だけ）と段ごとの非表示は、
// メッシュを作り直さずに切り替える（#10）。そのため、ここではすべての段のブロックを集め、
// 段ごとの数（layerCounts）を一緒に持っておく。

import type { Blueprint } from '../../domain/blueprint'
import type { LayerVisibility } from '../layers/layerDisplay'
import { blockColor } from './blockColor'

/** 1種類のブロックの置き場所。座標は設計図全体の座標で [x, y, z, x, y, z, …] と並べる */
export interface BlockInstanceGroup {
  /** ブロックの ID（"create:shaft"）。同じ ID は向きなどの状態が違っても同じ色なので1つにまとめる */
  readonly id: string
  readonly color: number
  /** 検索の強調で薄くするブロックのまとまりなら true（#15）。普通に描く段でも半透明で描く */
  readonly dimmed: boolean
  /** すべての段のブロックの位置 */
  readonly positions: readonly number[]
  /** 段（y）ごとのブロックの数 */
  readonly layerCounts: ReadonlyMap<number, number>
}

/** 段 y の見え方を返す関数。layerVisibility(display, y) を渡す */
export type LayerVisibilityOf = (y: number) => LayerVisibility

/** 強調表示で薄くするブロックなら true を返す関数（座標は設計図全体の座標） */
export type DimmedOf = (x: number, y: number, z: number) => boolean

interface GroupBuilder {
  positions: number[]
  layerCounts: Map<number, number>
}

/**
 * 設計図のブロックを ID ごとにまとめる。空きは入れない。
 * dimmed を渡すと、dimmed が true のブロックを別のまとまり（dimmed: true）に分ける（検索の強調、#15）。
 * 並びは ID の文字列順で、同じ ID なら普通のまとまりが先（毎回同じ順にして、描き直しで色や順番が揺れないようにする）。
 */
export function collectBlockInstances(blueprint: Blueprint, dimmed: DimmedOf | null = null): BlockInstanceGroup[] {
  const groups = new Map<string, { normal: GroupBuilder | null; dimmed: GroupBuilder | null }>()
  const multiRegion = blueprint.regions.length > 1

  blueprint.regions.forEach((region, ri) => {
    const [ox, oy, oz] = region.offset
    region.forEachBlock((lx, ly, lz, state) => {
      const x = lx + ox
      const y = ly + oy
      const z = lz + oz
      // リージョンが重なる位置は、先のリージョンだけを描く（Blueprint.get と同じ）
      if (multiRegion && ri > 0 && blueprint.locate([x, y, z])?.region !== region) return
      const id = state.id.toString()
      let entry = groups.get(id)
      if (!entry) {
        entry = { normal: null, dimmed: null }
        groups.set(id, entry)
      }
      const dim = dimmed !== null && dimmed(x, y, z)
      let group = dim ? entry.dimmed : entry.normal
      if (!group) {
        group = { positions: [], layerCounts: new Map() }
        if (dim) entry.dimmed = group
        else entry.normal = group
      }
      group.positions.push(x, y, z)
      group.layerCounts.set(y, (group.layerCounts.get(y) ?? 0) + 1)
    })
  })

  const result: BlockInstanceGroup[] = []
  for (const id of [...groups.keys()].sort()) {
    const entry = groups.get(id)!
    const color = blockColor(id)
    if (entry.normal) result.push({ id, color, dimmed: false, ...entry.normal })
    if (entry.dimmed) result.push({ id, color, dimmed: true, ...entry.dimmed })
  }
  return result
}

/**
 * 1つのまとまりのうち、普通に描く数と半透明で描く数。
 * 薄くするまとまりは、普通に描く段でも半透明として数える。
 */
export function countVisible(group: BlockInstanceGroup, visibilityOf: LayerVisibilityOf): { solid: number; ghost: number } {
  let solid = 0
  let ghost = 0
  for (const [y, n] of group.layerCounts) {
    const v = visibilityOf(y)
    if (v === 'solid' && !group.dimmed) solid += n
    else if (v !== 'hidden') ghost += n
  }
  return { solid, ghost }
}

/** まとめた中で、普通に描く数と半透明で描く数の合計 */
export function countInstances(
  groups: readonly BlockInstanceGroup[],
  visibilityOf: LayerVisibilityOf,
): { solid: number; ghost: number } {
  let solid = 0
  let ghost = 0
  for (const g of groups) {
    const c = countVisible(g, visibilityOf)
    solid += c.solid
    ghost += c.ghost
  }
  return { solid, ghost }
}
