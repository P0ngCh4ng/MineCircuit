// 3D表示で描くブロックを、種類（ID）ごとにまとめる。Three.js に依存しない部分。
// BlueprintMeshBuilder がこの結果から InstancedMesh を作る。

import type { Blueprint } from '../../domain/blueprint'
import type { LayerVisibility } from '../layers/layerDisplay'
import { blockColor } from './blockColor'

/** 1種類のブロックの置き場所。座標は設計図全体の座標で [x, y, z, x, y, z, …] と並べる */
export interface BlockInstanceGroup {
  /** ブロックの ID（"create:shaft"）。同じ ID は向きなどの状態が違っても同じ色なので1つにまとめる */
  readonly id: string
  readonly color: number
  /** 普通に描くブロック */
  readonly solid: readonly number[]
  /** 半透明で描くブロック（今の段より上を半透明にする表示方法のとき） */
  readonly ghost: readonly number[]
}

/** 段 y の見え方を返す関数。layerVisibility(display, y) を渡す */
export type LayerVisibilityOf = (y: number) => LayerVisibility

/**
 * 設計図のブロックを ID ごとにまとめる。空きと、隠す段のブロックは入れない。
 * 並びは ID の文字列順（毎回同じ順にして、描き直しで色や順番が揺れないようにする）。
 */
export function collectBlockInstances(blueprint: Blueprint, visibilityOf: LayerVisibilityOf): BlockInstanceGroup[] {
  const groups = new Map<string, { solid: number[]; ghost: number[] }>()
  // 同じ段を何度も聞かないように覚えておく
  const visibilityCache = new Map<number, LayerVisibility>()
  const multiRegion = blueprint.regions.length > 1

  blueprint.regions.forEach((region, ri) => {
    const [ox, oy, oz] = region.offset
    region.forEachBlock((lx, ly, lz, state) => {
      const x = lx + ox
      const y = ly + oy
      const z = lz + oz
      // リージョンが重なる位置は、先のリージョンだけを描く（Blueprint.get と同じ）
      if (multiRegion && ri > 0 && blueprint.locate([x, y, z])?.region !== region) return
      let visibility = visibilityCache.get(y)
      if (visibility === undefined) {
        visibility = visibilityOf(y)
        visibilityCache.set(y, visibility)
      }
      if (visibility === 'hidden') return
      const id = state.id.toString()
      let group = groups.get(id)
      if (!group) {
        group = { solid: [], ghost: [] }
        groups.set(id, group)
      }
      ;(visibility === 'solid' ? group.solid : group.ghost).push(x, y, z)
    })
  })

  return [...groups.keys()]
    .sort()
    .map((id) => {
      const g = groups.get(id)!
      return { id, color: blockColor(id), solid: g.solid, ghost: g.ghost }
    })
}

/** まとめた中のブロックの数（普通・半透明） */
export function countInstances(groups: readonly BlockInstanceGroup[]): { solid: number; ghost: number } {
  let solid = 0
  let ghost = 0
  for (const g of groups) {
    solid += g.solid.length / 3
    ghost += g.ghost.length / 3
  }
  return { solid, ghost }
}
