// Create の応力の計算プラグイン（docs/create-stress.md、docs/design.md「例：Createの応力プラグイン」）。

import type { Blueprint } from '../../domain/blueprint'
import { AssumptionLog } from '../assumptionLog'
import type {
  CalcContext,
  CalcIssue,
  CalcModpack,
  CalcPlugin,
  CalcProbe,
  CalcResult,
  CalcRotation,
  CalcSummaryItem,
  SpeedLevel,
} from '../calcPlugin'
import { resolved, type Provenance } from '../provenance'
import { loadCreateConfig } from './createConfig'
import { orientForPlacement, placementProblem } from './createPlacement'
import { CreateValueResolver } from './createValueResolver'
import {
  CREATE_STRESS_PLUGIN_ID,
  KineticGraph,
  formatNumber,
  weakerSource,
  type KineticEvaluation,
} from './kineticGraph'

export function createStressPlugin(): CalcPlugin {
  return {
    id: CREATE_STRESS_PLUGIN_ID,
    label: 'Create の応力',
    portKinds: [
      {
        kind: 'rotation-source',
        label: '回転の供給',
        description: '面の向こうに動力源を置きます。回転数の + / − は、面の軸の正の向きが基準です。',
        params: [
          { key: 'rpm', label: '回転数', unit: 'RPM', defaultValue: 16, min: -256, max: 256 },
          { key: 'capacity', label: '供給', unit: 'SU', defaultValue: 4096, min: 0 },
        ],
      },
      {
        kind: 'rotation-load',
        label: '回転の負荷',
        description: '面の向こうに負荷を置きます。応力（SU）か、1 RPM あたりの応力（SU/RPM）のどちらかを入れます。',
        params: [
          { key: 'stress', label: '応力', unit: 'SU', defaultValue: 256, min: 0, optional: true },
          { key: 'impact', label: '1 RPM あたりの応力', unit: 'SU/RPM', defaultValue: 4, min: 0, optional: true },
        ],
      },
    ],
    supports: (bp: Blueprint, _pack: CalcModpack | null) => bp.namespaces.has('create'),
    run: (bp: Blueprint, ctx: CalcContext) => runCreateStress(bp, ctx),
    orientForPlacement,
    placementProblem,
  }
}

export async function runCreateStress(bp: Blueprint, ctx: CalcContext): Promise<CalcResult> {
  const log = new AssumptionLog()
  const lookup = await loadCreateConfig(ctx.pack)
  if (!lookup.config) {
    log.add(
      ctx.pack
        ? 'Modpack に create-server.toml がないので、Create の内蔵の初期値を使った'
        : 'Modpack がないので、Create の内蔵の初期値を使った',
    )
  } else if (lookup.candidates.length > 1) {
    log.add(`create-server.toml が ${lookup.candidates.length} つあるので、${lookup.config.path} を使った`)
  }
  const values = new CreateValueResolver(lookup.config)
  const graph = KineticGraph.build(bp, ctx.ports, values, log)
  const maxRotationSpeed = values.maxRotationSpeed()
  const disableStress = values.disableStress()
  const evaluation = graph.evaluate({ maxRotationSpeed: maxRotationSpeed.value, disableStress: disableStress.value })
  if (disableStress.value) log.add('設定で応力が切ってある（disableStress）ので、過負荷にならない')

  return {
    summary: summarize(evaluation, disableStress.source),
    issues: [...evaluation.issues, ...placementIssues(bp)],
    assumptions: log.list(),
    probes: probes(graph, evaluation),
    rotations: rotations(graph, evaluation, values),
  }
}

/** 設置の規則に合わないブロック（ゲームでは外れて落ちる）。今は歯車だけ（#121） */
function placementIssues(bp: Blueprint): CalcIssue[] {
  const issues: CalcIssue[] = []
  bp.regions.forEach((region) => {
    const [ox, oy, oz] = region.offset
    region.forEachBlock((x, y, z, state) => {
      const pos: [number, number, number] = [x + ox, y + oy, z + oz]
      const problem = placementProblem(bp, pos, state)
      if (problem) issues.push({ pos, message: `この位置は設置の規則に合いません。${problem}` })
    })
  })
  return issues
}

function summarize(ev: KineticEvaluation, settingSource: Provenance): CalcSummaryItem[] {
  const items: CalcSummaryItem[] = []
  let totalStress = 0
  let totalCapacity = 0
  let totalSource: Provenance = settingSource
  let number = 0
  for (const net of ev.networks) {
    if (!net.active) continue
    number++
    totalStress += net.stress
    totalCapacity += net.capacity
    totalSource = weakerSource(totalSource, net.source)
    const speeds =
      net.maxSpeed === 0
        ? '止まっている'
        : net.minSpeed === net.maxSpeed
          ? `${formatNumber(net.maxSpeed)} RPM`
          : `${formatNumber(net.minSpeed)}〜${formatNumber(net.maxSpeed)} RPM`
    const state = net.overloaded ? '（過負荷）' : ''
    items.push({
      label: `ネットワーク ${number}`,
      value: resolved(
        `使用 ${formatNumber(net.stress)} SU / 供給 ${formatNumber(net.capacity)} SU、${speeds}${state}`,
        net.source,
      ),
    })
  }
  items.unshift({
    label: '合計',
    value: resolved(`使用 ${formatNumber(totalStress)} SU / 供給 ${formatNumber(totalCapacity)} SU`, totalSource),
  })
  return items
}

/**
 * 回るブロックごとの回転（表示部分の色分け用）。仮の入出力のノードは含めない。
 * 速さの段階の境目は、設定の中速・高速（初期値 30・100 RPM）。過負荷なら止まる前の回転数で段階を決め、overloaded を立てる
 */
function rotations(graph: KineticGraph, ev: KineticEvaluation, values: CreateValueResolver): CalcRotation[] {
  const medium = values.mediumSpeed().value
  const fast = values.fastSpeed().value
  const result: CalcRotation[] = []
  graph.nodes.forEach((node, i) => {
    if (node.portId !== null) return
    const r = ev.nodes[i]!
    const overloaded = ev.networks[r.network]!.overloaded && r.theoreticalSpeed !== 0
    const rpm = overloaded ? r.theoreticalSpeed : r.speed
    const speed = Math.abs(rpm)
    const level: SpeedLevel = speed === 0 ? 'stopped' : speed >= fast ? 'fast' : speed >= medium ? 'medium' : 'slow'
    result.push({ pos: [node.pos[0], node.pos[1], node.pos[2]], axis: node.axis, rpm, level, overloaded })
  })
  return result
}

/** ブロックごとの値（プローブ用）。仮の入出力のノードは含めない */
function probes(graph: KineticGraph, ev: KineticEvaluation): CalcProbe[] {
  const numbers = new Map<number, number>()
  ev.networks.forEach((net, i) => {
    if (net.active) numbers.set(i, numbers.size + 1)
  })
  const result: CalcProbe[] = []
  graph.nodes.forEach((node, i) => {
    if (node.portId !== null) return
    const r = ev.nodes[i]
    const net = ev.networks[r.network]
    const speedText =
      net.overloaded && r.theoreticalSpeed !== 0
        ? `0 RPM（過負荷で止まる。止まる前は ${formatNumber(r.theoreticalSpeed)} RPM）`
        : `${formatNumber(r.speed)} RPM`
    const values: CalcSummaryItem[] = [{ label: '回転数', value: resolved(speedText, r.speedSource) }]
    if (node.impact.value !== 0) {
      values.push({
        label: '応力',
        value: resolved(
          `${formatNumber(r.stress)} SU（${formatNumber(node.impact.value)} SU/RPM）`,
          weakerSource(node.impact.source, r.speedSource),
        ),
      })
    }
    if (node.source) {
      const cap = node.source.capacity.value * Math.abs(node.source.speed.value)
      values.push({
        label: '供給',
        value: resolved(
          `${formatNumber(cap)} SU（${formatNumber(node.source.speed.value)} RPM で）`,
          weakerSource(node.source.capacity.source, node.source.speed.source),
        ),
      })
    }
    const number = numbers.get(r.network)
    if (number !== undefined) {
      values.push({
        label: 'ネットワーク',
        value: resolved(
          `ネットワーク ${number}（使用 ${formatNumber(net.stress)} SU / 供給 ${formatNumber(net.capacity)} SU）`,
          net.source,
        ),
      })
    }
    result.push({ pos: [node.pos[0], node.pos[1], node.pos[2]], values, network: r.network })
  })
  return result
}
