// 上のバーに出す設計図の情報（寸法、ブロック数、種類、nbt 付き、エンティティ、バージョン）。
// ブロックごとの数の集計は #11 の BlueprintStats（analysis）で作る。ここは上のバー用の合計だけ。

import type { Blueprint } from '../../domain/blueprint'
import type { Vec3 } from '../../domain/vec3'

export interface BlueprintSummary {
  /** 幅 × 高さ × 奥行き */
  readonly size: Vec3
  /** 空きでないブロックの数 */
  readonly blockCount: number
  /** ブロックの ID の種類の数（properties の違いは数えない） */
  readonly kindCount: number
  /** 生データ（ブロックエンティティ）を持つブロックの数 */
  readonly blockEntityCount: number
  /** エンティティ（額縁、防具立てなど）の数 */
  readonly entityCount: number
  readonly dataVersion: number
}

/** 設計図の合計を数える。リージョンが重なる位置は、先のリージョンだけを数える */
export function summarizeBlueprint(bp: Blueprint): BlueprintSummary {
  let blockCount = 0
  let blockEntityCount = 0
  let entityCount = 0
  const kinds = new Set<string>()
  bp.regions.forEach((region, ri) => {
    entityCount += region.entities.length
    region.forEachBlock((x, y, z, state, blockEntity) => {
      if (ri > 0) {
        const pos: Vec3 = [x + region.offset[0], y + region.offset[1], z + region.offset[2]]
        if (bp.locate(pos)?.region !== region) return
      }
      blockCount++
      if (blockEntity) blockEntityCount++
      kinds.add(state.id.toString())
    })
  })
  return { size: bp.size, blockCount, kindCount: kinds.size, blockEntityCount, entityCount, dataVersion: bp.dataVersion }
}

// DataVersion と Minecraft のバージョンの対応（各バージョンの最初の値）。Minecraft Wiki の「Data version」による
const MINECRAFT_VERSIONS: readonly (readonly [number, string])[] = [
  [2586, '1.16.5'],
  [2730, '1.17.1'],
  [2975, '1.18.2'],
  [3120, '1.19.2'],
  [3218, '1.19.3'],
  [3337, '1.19.4'],
  [3465, '1.20.1'],
  [3578, '1.20.2'],
  [3700, '1.20.4'],
  [3839, '1.20.6'],
  [3955, '1.21.1'],
  [4189, '1.21.4'],
]

/**
 * DataVersion を画面に出す文字にする。「約 1.18.2（2975）」。
 * DataVersion がないファイル（0）は「不明」。
 */
export function minecraftVersionLabel(dataVersion: number): string {
  if (dataVersion <= 0) return '不明'
  let name: string | null = null
  for (const [min, version] of MINECRAFT_VERSIONS) if (dataVersion >= min) name = version
  return `${name ? `約 ${name}` : '1.16.5 より前'}（${dataVersion}）`
}
