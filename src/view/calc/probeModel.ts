// 計算結果から、プローブ・ネットのハイライト・問題の一覧に出すものを取り出す（#31）。
// Vue に依存しない関数だけを置くので、画面なしでテストできる。

import { ISSUE_SEVERITIES, issueSeverity, type CalcSummaryItem, type IssueSeverity } from '../../calc/calcPlugin'
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

/** ブロックが属するネットワークの、ネット一覧の行（#158） */
export interface NetworkRow {
  readonly pluginId: string
  readonly pluginLabel: string
  readonly row: CalcSummaryItem
}

/**
 * pos のブロックが属するネットワークの、ネット一覧の行（プラグインごと）。
 * 行の位置のブロックと同じネットワーク番号なら、そのネットワークの行とみなす
 */
export function networkRowsAt(outcomes: readonly PluginOutcome[] | null, pos: Vec3): NetworkRow[] {
  const rows: NetworkRow[] = []
  for (const o of outcomes ?? []) {
    if (o.status !== 'ok' || !o.result.probes) continue
    const probes = o.result.probes
    const networkOf = (p: Vec3): number | undefined => probes.find((x) => equalsVec3(x.pos, p))?.network
    const network = networkOf(pos)
    if (network === undefined) continue
    const row = o.result.summary.find((item) => item.network && item.pos && networkOf(item.pos) === network)
    if (row) rows.push({ pluginId: o.pluginId, pluginLabel: o.label, row })
  }
  return rows
}

/** ブロック1つが入る問題（#158） */
export interface BlockIssue {
  readonly pluginId: string
  readonly severity: IssueSeverity
  readonly message: string
}

/** pos のブロックが入る問題。ネットワーク全体などをまとめた問題（positions）も含む。重い順 */
export function issuesAt(outcomes: readonly PluginOutcome[] | null, pos: Vec3): BlockIssue[] {
  const found: BlockIssue[] = []
  for (const o of outcomes ?? []) {
    if (o.status !== 'ok') continue
    for (const issue of o.result.issues) {
      const positions = issue.positions ?? [issue.pos]
      if (positions.some((p) => equalsVec3(p, pos))) {
        found.push({ pluginId: o.pluginId, severity: issueSeverity(issue), message: issue.message })
      }
    }
  }
  return found.sort((a, b) => ISSUE_SEVERITIES.indexOf(a.severity) - ISSUE_SEVERITIES.indexOf(b.severity))
}

/** 座標の表示（[x, y, z]） */
export function formatPos(pos: Vec3): string {
  return `[${pos.join(', ')}]`
}
