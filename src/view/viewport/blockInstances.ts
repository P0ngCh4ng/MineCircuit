// 3D表示で描くブロックを、種類（ID）ごとにまとめる。Three.js に依存しない部分。
// BlueprintMeshBuilder がこの結果から InstancedMesh を作る。
//
// 段の表示方法（すべて・上を消す・上を半透明・この段だけ）と段ごとの非表示は、
// メッシュを作り直さずに切り替える（#10）。そのため、ここではすべての段のブロックを集め、
// 段ごとの数（layerCounts）を一緒に持っておく。

import type { AppearanceSet, BlockAppearance } from '../../domain/blockModel'
import type { BlockState } from '../../domain/blockState'
import type { Blueprint } from '../../domain/blueprint'
import { directionVector, HORIZONTAL_DIRECTIONS, type Direction } from '../../domain/direction'
import type { RawNbt } from '../../domain/nbt'
import type { Vec3 } from '../../domain/vec3'
import { appearanceKey, hasBlockEntityAppearance } from '../../io/assets/blockEntityAppearance'
import type { LayerVisibility } from '../layers/layerDisplay'
import { blockColor } from './blockColor'
import { cullBit, OpaqueCubeCache } from './modelGeometry'

/** 1種類のブロックの置き場所。座標は設計図全体の座標で [x, y, z, x, y, z, …] と並べる */
export interface BlockInstanceGroup {
  /** ブロックの ID（"create:shaft"）。色付きの箱では、同じ ID は向きなどの状態が違っても同じ色なので1つにまとめる */
  readonly id: string
  readonly color: number
  /**
   * モデルとテクスチャで描くときの見た目（#84）。null なら色付きの箱で描く。
   * 同じ見た目（オブジェクトが同じ）で、隠す面（cullMask）も同じブロックを1つにまとめる
   */
  readonly appearance: BlockAppearance | null
  /** 見た目を選んだブロック状態の key（名前に使う）。色付きの箱なら null */
  readonly stateKey: string | null
  /** 隣の不透明な立方体に隠れて描かない面の向き（modelGeometry.ts の cullBit の和）。色付きの箱なら 0 */
  readonly cullMask: number
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

interface GroupEntry {
  readonly sortKey: string
  readonly id: string
  readonly appearance: BlockAppearance | null
  readonly stateKey: string | null
  readonly cullMask: number
  normal: GroupBuilder | null
  dimmed: GroupBuilder | null
}

/**
 * 面を隠し合う向き。水平の4方向だけにする。
 * 上下の面は、段の表示方法（上を消す・この段だけ）や段ごとの非表示で、隣の段が消えると見えるようになるため。
 * 同じ段のブロックは、いつも同じように見える・隠れるので、水平の向きは隠してよい
 */
const CULL_DIRECTIONS: readonly Direction[] = HORIZONTAL_DIRECTIONS

/**
 * 設計図のブロックを ID ごとにまとめる。空きは入れない。
 * dimmed を渡すと、dimmed が true のブロックを別のまとまり（dimmed: true）に分ける（検索の強調、#15）。
 * appearances を渡すと、見た目が分かるブロックは見た目と隠す面ごとにまとめる（#84）。見た目が null のブロックは今までどおり ID ごと。
 * 並びは ID の文字列順で、同じ ID なら普通のまとまりが先（毎回同じ順にして、描き直しで色や順番が揺れないようにする）。
 */
export function collectBlockInstances(
  blueprint: Blueprint,
  dimmed: DimmedOf | null = null,
  appearances: AppearanceSet | null = null,
): BlockInstanceGroup[] {
  const groups = new Map<string, GroupEntry>()
  const multiRegion = blueprint.regions.length > 1
  const opaque = appearances ? new OpaqueCubeCache(appearances) : null
  const appearanceIds = new Map<BlockAppearance, number>()

  // 生データで見た目が変わるブロック（Custom Machinery の機械）は、生データから見た目の鍵を決める
  const keyOf = (state: BlockState, blockEntity: () => RawNbt | null): string =>
    hasBlockEntityAppearance(state) ? appearanceKey(state, blockEntity()) : state.key
  const appearanceOf = (key: string): BlockAppearance | null => appearances?.appearances[key] ?? null
  const isDimmed = (x: number, y: number, z: number): boolean => dimmed !== null && dimmed(x, y, z)

  blueprint.regions.forEach((region, ri) => {
    const [ox, oy, oz] = region.offset
    region.forEachBlock((lx, ly, lz, state, blockEntity) => {
      const x = lx + ox
      const y = ly + oy
      const z = lz + oz
      // リージョンが重なる位置は、先のリージョンだけを描く（Blueprint.get と同じ）
      if (multiRegion && ri > 0 && blueprint.locate([x, y, z])?.region !== region) return
      const id = state.id.toString()
      const dim = isDimmed(x, y, z)
      const lookKey = keyOf(state, () => blockEntity)
      const appearance = appearanceOf(lookKey)
      let key = id
      let cullMask = 0
      if (appearance) {
        // 中身のない見た目（見えないブロック）は描かない
        if (appearance.parts.length === 0) return
        // 隣が不透明な立方体なら、その向きの面を隠す。薄くしたブロック（半透明）は、自分も薄いときだけ隠す側になる
        // 隠せる面のない向きは調べない（同じ形のブロックを1つのまとまりにするため）
        const cullable = opaque!.cullableMask(appearance)
        for (const d of CULL_DIRECTIONS) {
          if ((cullable & cullBit(d)) === 0) continue
          const [dx, dy, dz] = directionVector(d)
          const neighbor = blueprint.get([x + dx, y + dy, z + dz])
          if (!neighbor) continue
          const np: Vec3 = [x + dx, y + dy, z + dz]
          const na = appearanceOf(keyOf(neighbor, () => blueprint.blockEntityAt(np)))
          if (!na || !opaque!.isOpaqueCube(na)) continue
          if (!dim && isDimmed(x + dx, y + dy, z + dz)) continue
          cullMask |= cullBit(d)
        }
        let n = appearanceIds.get(appearance)
        if (n === undefined) {
          n = appearanceIds.size
          appearanceIds.set(appearance, n)
        }
        key = `${id}|${n}|${cullMask}`
      }
      let entry = groups.get(key)
      if (!entry) {
        entry = {
          sortKey: appearance ? `${id}|${lookKey}|${cullMask}` : id,
          id,
          appearance,
          stateKey: appearance ? lookKey : null,
          cullMask,
          normal: null,
          dimmed: null,
        }
        groups.set(key, entry)
      }
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
  const entries = [...groups.values()].sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0))
  for (const entry of entries) {
    const { id, appearance, stateKey, cullMask } = entry
    const base = { id, color: blockColor(id), appearance, stateKey, cullMask }
    if (entry.normal) result.push({ ...base, dimmed: false, ...entry.normal })
    if (entry.dimmed) result.push({ ...base, dimmed: true, ...entry.dimmed })
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
