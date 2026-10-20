// 計算結果から、プローブ・ネットのハイライト・問題の一覧に出すものを取り出す（#31）。
// Vue に依存しない関数だけを置くので、画面なしでテストできる。

import type { CalcSummaryItem } from '../../calc/calcPlugin'
import type { PluginOutcome } from '../../calc/pluginRegistry'
import { equalsVec3, type Vec3 } from '../../domain/vec3'

/** プラグイン1つ分の、ブロック1つの値 */
export interface ProbeReading {
  readonly pluginId: string
  readonly pluginLabel: string
  readonly values: readonly CalcSummaryItem[]
}

/** pos のブロックの値を、プラグインごとに返す。値がなければ空の配列 */
export function probeAt(outcomes: readonly PluginOutcome[] | null, pos: Vec3): ProbeReading[] {
  const readings: ProbeReading[] = []
  for (const o of outcomes ?? []) {
    if (o.status !== 'ok') continue
    const probe = o.result.probes?.find((p) => equalsVec3(p.pos, pos))
    if (probe) readings.push({ pluginId: o.pluginId, pluginLabel: o.label, values: probe.values })
  }
  return readings
}

/**
 * pos のブロックとつながったブロック（同じネットワーク）の位置。pos 自身も含む。
 * ネットワークの番号を持つ最初のプラグインのものを使う。どのネットワークにも入っていなければ null
 */
export function networkAt(outcomes: readonly PluginOutcome[] | null, pos: Vec3): Vec3[] | null {
  for (const o of outcomes ?? []) {
    if (o.status !== 'ok' || !o.result.probes) continue
    const network = o.result.probes.find((p) => equalsVec3(p.pos, pos))?.network
    if (network === undefined) continue
    return o.result.probes.filter((p) => p.network === network).map((p) => p.pos)
  }
  return null
}

/** 座標の表示（[x, y, z]） */
export function formatPos(pos: Vec3): string {
  return `[${pos.join(', ')}]`
}
