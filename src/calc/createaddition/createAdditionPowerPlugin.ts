// Create Crafts & Additions の電力の計算プラグイン（docs/createaddition-power.md）。
// 発電機の回転数は、先に走ったプラグインの結果の rotations から引く（docs/design.md「プラグインの順番と、前の結果」）。

import type { BlockState } from '../../domain/blockState'
import { transformVector, type BlockTransform } from '../../domain/blockTransform'
import type { Blueprint } from '../../domain/blueprint'
import { boxContains, type Box } from '../../domain/box'
import type { NbtTag, RawNbt } from '../../domain/nbt'
import { addVec3, type Vec3 } from '../../domain/vec3'
import type { BlockEntityTransform } from '../../edit/regionTransform'
import { AssumptionLog } from '../assumptionLog'
import type { CalcContext, CalcModpack, CalcPlugin, CalcProbe, CalcResult, CalcSummaryItem, EarlierResult } from '../calcPlugin'
import { resolved, type Provenance } from '../provenance'
import { CA_NAMESPACE, caBlockSettings, completeCaState } from './createAdditionBlocks'
import { loadCaValues } from './createAdditionValues'
import { evaluatePower, formatFe, posKey, type PowerDevice, type PowerEvaluation, type RpmLookup } from './powerNetwork'

export const CA_POWER_PLUGIN_ID = 'createaddition-power'

export function createAdditionPowerPlugin(): CalcPlugin {
  return {
    id: CA_POWER_PLUGIN_ID,
    label: 'Crafts & Additions の電力',
    portKinds: [],
    supports: (bp: Blueprint, _pack: CalcModpack | null) => bp.namespaces.has(CA_NAMESPACE),
    run: (bp: Blueprint, ctx: CalcContext) => runCreateAdditionPower(bp, ctx),
    completeState: completeCaState,
    blockSettings: caBlockSettings,
    transformBlockEntity: transformCaBlockEntity,
  }
}

/** 先に走ったプラグインの回転（位置 → 符号付きの回転数。過負荷なら 0）。回転を出したプラグインがなければ null */
export function earlierRotations(earlier: readonly EarlierResult[] | undefined): RpmLookup | null {
  const withRotations = (earlier ?? []).filter((e) => e.result.rotations !== undefined)
  if (withRotations.length === 0) return null
  const rpm = new Map<string, number>()
  for (const e of withRotations) {
    for (const r of e.result.rotations!) {
      const key = posKey(r.pos)
      if (!rpm.has(key)) rpm.set(key, r.overloaded ? 0 : r.rpm)
    }
  }
  return (pos) => rpm.get(posKey(pos)) ?? null
}

export async function runCreateAdditionPower(bp: Blueprint, ctx: CalcContext): Promise<CalcResult> {
  const log = new AssumptionLog()
  const { values, notes } = await loadCaValues(ctx.pack, bp)
  for (const note of notes) log.add(note)
  const rotations = earlierRotations(ctx.earlier)
  if (!rotations) log.add('回転の計算の結果がないので、発電機は回っていないとみなした')
  else log.add('発電機の回転数は、回転の計算の結果を使った')
  const rpmAt: RpmLookup = rotations ?? (() => null)
  const evaluation = evaluatePower(bp, values, ctx.mode ?? 'saved', rpmAt, log)
  const source: Provenance = values.get('feAtMaxRpm').source
  return {
    summary: summarize(evaluation, source),
    issues: [...evaluation.issues],
    assumptions: log.list(),
    probes: probes(evaluation, source, rotations !== null),
  }
}

function feText(value: number): string {
  return value === Infinity ? 'いくらでも' : `${formatFe(value)} FE/t`
}

function summarize(e: PowerEvaluation, source: Provenance): CalcSummaryItem[] {
  if (e.networks.length === 0) return []
  const supply = e.networks.reduce((s, n) => s + n.supply, 0)
  const demand = e.networks.reduce((s, n) => s + n.demand, 0)
  const items: CalcSummaryItem[] = [{ label: '電力の合計', value: resolved(`発電 ${feText(supply)} / 使用 ${feText(demand)}`, source) }]
  for (const n of e.networks) {
    // CA-NET-SURPLUS。余りはまとめにだけ出す
    const surplus = n.supply - n.demand
    const rest = surplus > 0 && surplus !== Infinity ? `（余り ${formatFe(surplus)} FE/t）` : ''
    items.push({
      label: `電力 ${n.index}`,
      value: resolved(`発電 ${feText(n.supply)} / 使用 ${feText(n.demand)}${rest}`, source),
      pos: e.devices[n.devices[0]].pos,
      network: true,
    })
  }
  return items
}

function deviceValues(d: PowerDevice, source: Provenance, hasRotations: boolean): CalcSummaryItem[] {
  switch (d.kind) {
    case 'alternator':
      return [
        { label: '回転数', value: resolved(`${d.rpm} RPM`, hasRotations ? 'blueprint' : 'assumed', '回転の計算の結果') },
        { label: '作る量', value: resolved(feText(d.output), source) },
      ]
    case 'motor':
      return [
        { label: '設定の回転数', value: resolved(`${d.setSpeed} RPM`, 'blueprint') },
        { label: '使う量', value: resolved(feText(d.use), source) },
        { label: '状態', value: resolved(d.active ? '回っている' : '止まっている', 'blueprint') },
      ]
    case 'creative':
      return [{ label: '作る量', value: resolved('いくらでも', 'builtin') }]
    case 'accumulator':
      return [
        { label: '容量', value: resolved(`${formatFe(d.capacity)} FE`, source) },
        { label: '蓄えた量', value: resolved(`${formatFe(d.stored)} FE`, 'blueprint') },
      ]
    case 'connector': {
      const c = d.connector!
      const mode = c.mode === 'pull' ? '取り込む' : c.mode === 'push' ? '出す' : 'やりとりしない'
      const items: CalcSummaryItem[] = [
        { label: '付いたブロックと', value: resolved(mode, 'blueprint') },
        { label: '上限', value: resolved(`入力 ${formatFe(c.maxIn)} / 出力 ${formatFe(c.maxOut)} FE/t`, source) },
        { label: '電線の長さの上限', value: resolved(`${c.maxLength} ブロック`, source) },
      ]
      if (c.size === 'light') items.push({ label: '使う量', value: resolved(feText(d.use), source) })
      return items
    }
  }
}

function probes(e: PowerEvaluation, source: Provenance, hasRotations: boolean): CalcProbe[] {
  return e.devices.map((d) => {
    const network = e.networkAt.get(posKey(d.pos))!
    return { pos: d.pos, network, values: [{ label: 'ネットワーク', value: resolved(`電力 ${network}`, 'blueprint') }, ...deviceValues(d, source, hasRotations)] }
  })
}

/** 相対位置の電線を回す・反転する（CA-TF-NODES）。接続でなければ null */
export function transformCaBlockEntity(
  state: BlockState,
  nbt: RawNbt,
  t: BlockTransform,
  from: Vec3,
  _to: Vec3,
  source: Box,
): BlockEntityTransform | null {
  if (state.id.namespace !== CA_NAMESPACE) return null
  const tag = nbt.value.get('nodes')
  if (tag?.type !== 'list') return null
  let unresolved = false
  const rewritten = tag.value.map((item): NbtTag => {
    if (item.type !== 'compound') return item
    const get = (k: string): number | null => {
      const v = item.value.get(k)
      return v?.type === 'int' ? v.value : null
    }
    const x = get('x')
    const y = get('y')
    const z = get('z')
    if (x === null || y === null || z === null) return item
    if (!boxContains(source, addVec3(from, [x, y, z]))) unresolved = true
    const [nx, ny, nz] = transformVector(t, [x, y, z])
    const value = new Map(item.value)
    value.set('x', { type: 'int', value: nx })
    value.set('y', { type: 'int', value: ny })
    value.set('z', { type: 'int', value: nz })
    return { type: 'compound', value }
  })
  const value = new Map(nbt.value)
  value.set('nodes', { ...tag, value: rewritten })
  return { nbt: { type: 'compound', value }, unresolved }
}
