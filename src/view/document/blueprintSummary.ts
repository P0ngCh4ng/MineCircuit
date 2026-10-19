// 上のバーに出す設計図の情報（寸法、ブロック数、種類、nbt 付き、エンティティ、バージョン）。
// 数は analysis の BlueprintStats で数える。ここは上のバー用にまとめるだけ。

import { BlueprintStats } from '../../analysis/blueprintStats'
import type { Blueprint } from '../../domain/blueprint'
import { MINECRAFT_VERSIONS, minecraftVersionOf } from '../../domain/minecraftVersion'
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

/** 設計図の合計を数える。stats を渡すと、その集計を使う（同じ設計図のもの） */
export function summarizeBlueprint(bp: Blueprint, stats: BlueprintStats = new BlueprintStats(bp)): BlueprintSummary {
  return { size: bp.size, ...stats.totals(), dataVersion: bp.dataVersion }
}

/**
 * DataVersion を画面に出す文字にする。「約 1.18.2（2975）」。
 * DataVersion がないファイル（0）は「不明」。
 */
export function minecraftVersionLabel(dataVersion: number): string {
  if (dataVersion <= 0) return '不明'
  const version = minecraftVersionOf(dataVersion)
  return `${version ? `約 ${version.name}` : `${MINECRAFT_VERSIONS[0].name} より前`}（${dataVersion}）`
}
