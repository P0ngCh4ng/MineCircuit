// Create Crafts & Additions の電力のネットワーク（docs/createaddition-power.md「電力の規則」）。
// 接続と電線からネットワークを作り、ネットワークごとに作る量と使う量を数える。

import type { BlockState } from '../../domain/blockState'
import type { Blueprint } from '../../domain/blueprint'
import { DIRECTIONS, directionVector } from '../../domain/direction'
import type { RawNbt } from '../../domain/nbt'
import { addVec3, type Vec3 } from '../../domain/vec3'
import type { AssumptionLog } from '../assumptionLog'
import type { CalcIssue, CalcMode } from '../calcPlugin'
import { nbtNumber } from '../nbtValues'
import { CA_NAMESPACE, caFacing, motorActive, motorSetSpeed } from './createAdditionBlocks'
import type { CaValues } from './createAdditionValues'

export type DeviceKind = 'motor' | 'alternator' | 'creative' | 'accumulator' | 'connector'

export type ConnectorSize = 'small' | 'large' | 'light'

export type ConnectorMode = 'none' | 'push' | 'pull'

/** ネットワークに入るブロック1つ分 */
export interface PowerDevice {
  readonly pos: Vec3
  readonly id: string
  readonly kind: DeviceKind
  /** 発電機の回転数（整数に切り捨てたもの）。発電機でなければ 0 */
  readonly rpm: number
  /** 作る量（FE/t）。クリエイティブの電源は Infinity */
  readonly output: number
  /** 使う量（FE/t） */
  readonly use: number
  /** モーターなら回っているか。それ以外は false */
  readonly active: boolean
  /** モーターなら設定の回転数 */
  readonly setSpeed: number
  /** 接続の大きさ・向き・上限・長さ。接続でなければ null */
  readonly connector: { readonly size: ConnectorSize; readonly mode: ConnectorMode; readonly maxIn: number; readonly maxOut: number; readonly maxLength: number } | null
  /** 蓄電池の1ブロックの容量と、蓄えた量（生データ） */
  readonly capacity: number
  readonly stored: number
}

/** ネットワーク1つ分の結果 */
export interface PowerNetwork {
  /** 1 から */
  readonly index: number
  readonly devices: readonly number[]
  /** 入る量（FE/t）。クリエイティブの電源があれば Infinity */
  readonly supply: number
  /** 出る量（FE/t） */
  readonly demand: number
  /** 電気を出せる蓄電池の容量と蓄えた量（FE） */
  readonly storageCapacity: number
  readonly storageStored: number
  /** 発電機・電源・電気を出せる蓄電池があるか */
  readonly hasSource: boolean
}

export interface PowerEvaluation {
  readonly devices: readonly PowerDevice[]
  readonly networks: readonly PowerNetwork[]
  /** 位置 → ネットワークの番号 */
  readonly networkAt: ReadonlyMap<string, number>
  readonly wires: number
  readonly issues: readonly CalcIssue[]
}

export function posKey(p: Vec3): string {
  return `${p[0]},${p[1]},${p[2]}`
}

/** 回転数の引き方。位置の回転数（符号付き）。分からなければ null */
export type RpmLookup = (pos: Vec3) => number | null

/** C&A のブロックから、ネットワークに入るものを作る。入らなければ null */
function makeDevice(
  pos: Vec3,
  state: BlockState,
  be: RawNbt | null,
  values: CaValues,
  mode: CalcMode,
  rpmAt: RpmLookup,
  log: AssumptionLog,
  issues: CalcIssue[],
): PowerDevice | null {
  const base = { pos, id: state.id.toString(), rpm: 0, output: 0, use: 0, active: false, setSpeed: 0, connector: null, capacity: 0, stored: 0 }
  switch (state.id.path) {
    case 'alternator': {
      // CA-ALT-OUTPUT。回転数は整数に切り捨ててから使う
      const raw = rpmAt(pos)
      const rpm = Math.trunc(Math.abs(raw ?? 0))
      const output = Math.floor((values.value('feAtMaxRpm') * rpm) / 256 * values.value('alternatorEfficiency'))
      // CA-ALT-IDLE
      if (rpm === 0) issues.push({ pos, severity: 'warning', message: '発電機が回っていないので、電気を作りません。' })
      return { ...base, kind: 'alternator', rpm, output }
    }
    case 'electric_motor': {
      // CA-MOTOR-USE・CA-MOTOR-ACTIVE。使う量は設定の回転数で決まる
      const set = motorSetSpeed(be).value
      const { active, note } = motorActive(state, be, mode)
      if (note) log.add(note, pos)
      const use = active ? Math.floor(Math.max((values.value('feAtMaxRpm') * Math.abs(set)) / 256, values.value('motorMinConsumption'))) : 0
      return { ...base, kind: 'motor', use, active, setSpeed: set }
    }
    case 'creative_energy':
      // CA-CREATIVE
      return { ...base, kind: 'creative', output: Infinity }
    case 'modular_accumulator':
    case 'accumulator':
      return { ...base, kind: 'accumulator', capacity: values.value('accumulatorCapacity'), stored: nbtNumber(be, 'EnergyContent') ?? 0 }
    case 'connector':
    case 'large_connector':
    case 'small_light_connector': {
      const size: ConnectorSize = state.id.path === 'connector' ? 'small' : state.id.path === 'large_connector' ? 'large' : 'light'
      const m = state.properties.mode
      const connectorMode: ConnectorMode = m === 'push' || m === 'pull' ? m : 'none'
      const large = size === 'large'
      const connector = {
        size,
        mode: connectorMode,
        maxIn: values.value(large ? 'largeConnectorMaxInput' : 'smallConnectorMaxInput'),
        maxOut: values.value(large ? 'largeConnectorMaxOutput' : 'smallConnectorMaxOutput'),
        maxLength: values.value(large ? 'largeConnectorWireLength' : 'smallConnectorWireLength'),
      }
      // CA-LIGHT-USE
      const use = size === 'light' ? values.value('lightConnectorConsumption') : 0
      return { ...base, kind: 'connector', connector, use }
    }
    default:
      // CA-UNKNOWN-BLOCK。回るだけのブロック（圧延機）は Create の計算で扱う
      if (state.id.path !== 'rolling_mill') log.add(`${state.id.toString()} の電気の出入りは計算に入れていない`, pos)
      return null
  }
}

class UnionFind {
  private readonly parent: number[]

  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i)
  }

  find(i: number): number {
    while (this.parent[i] !== i) {
      this.parent[i] = this.parent[this.parent[i]]
      i = this.parent[i]
    }
    return i
  }

  union(a: number, b: number): void {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra !== rb) this.parent[Math.max(ra, rb)] = Math.min(ra, rb)
  }
}

/** 接続の生データの電線（CA-WIRE-NODES）。相手の位置（この接続からの相対）と電線の種類 */
export function wireNodes(be: RawNbt | null): { offset: Vec3; type: number }[] {
  const tag = be?.value.get('nodes')
  if (tag?.type !== 'list') return []
  const result: { offset: Vec3; type: number }[] = []
  for (const item of tag.value) {
    if (item.type !== 'compound') continue
    const x = nbtNumber(item, 'x')
    const y = nbtNumber(item, 'y')
    const z = nbtNumber(item, 'z')
    if (x === null || y === null || z === null) continue
    result.push({ offset: [x, y, z], type: nbtNumber(item, 'type') ?? 0 })
  }
  return result
}

/** 銅（0）と飾り（3）の電線。大きい接続どうしには張れない（CA-WIRE-LARGE） */
function isLowCurrentWire(type: number): boolean {
  return type === 0 || type === 3
}

export function formatFe(value: number): string {
  return new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 2 }).format(value)
}

/** 電力のネットワークを作って数える */
export function evaluatePower(bp: Blueprint, values: CaValues, mode: CalcMode, rpmAt: RpmLookup, log: AssumptionLog): PowerEvaluation {
  const issues: CalcIssue[] = []
  const devices: PowerDevice[] = []
  const byPos = new Map<string, number>()
  for (const region of bp.regions) {
    region.forEachBlock((x, y, z, state, be) => {
      if (state.id.namespace !== CA_NAMESPACE) return
      const pos = addVec3([x, y, z], region.offset)
      const key = posKey(pos)
      if (byPos.has(key) || bp.locate(pos)?.region !== region) return
      const device = makeDevice(pos, state, be, values, mode, rpmAt, log, issues)
      if (!device) return
      byPos.set(key, devices.length)
      devices.push(device)
    })
  }
  const at = (p: Vec3): number | undefined => byPos.get(posKey(p))
  const uf = new UnionFind(devices.length)

  // 電線（CA-WIRE-NODES・CA-WIRE-LENGTH・CA-WIRE-LARGE）。両端に同じ電線があるので、組で数える
  const wires = new Set<string>()
  devices.forEach((d, i) => {
    if (!d.connector) return
    for (const node of wireNodes(bp.blockEntityAt(d.pos))) {
      const target = addVec3(d.pos, node.offset)
      if (!bp.locate(target)) {
        issues.push({ pos: d.pos, severity: 'warning', message: `電線の先（${target.join(', ')}）が設計図の範囲の外なので、計算に入れていません。` })
        continue
      }
      const j = at(target)
      const other = j === undefined ? null : devices[j]
      if (j === undefined || !other?.connector) {
        issues.push({ pos: d.pos, severity: 'warning', message: `電線の先（${target.join(', ')}）に接続がありません。` })
        continue
      }
      const key = i < j ? `${i}-${j}` : `${j}-${i}`
      if (wires.has(key)) continue
      wires.add(key)
      const limit = Math.min(d.connector.maxLength, other.connector.maxLength)
      const distSq = node.offset[0] ** 2 + node.offset[1] ** 2 + node.offset[2] ** 2
      if (distSq > limit * limit) {
        issues.push({
          pos: d.pos,
          positions: [d.pos, other.pos],
          message: `電線が長すぎます（${formatFe(Math.sqrt(distSq))} ブロック。上限 ${limit}）。ゲームではこの電線を張れません。`,
        })
      }
      if (d.connector.size === 'large' && other.connector.size === 'large' && isLowCurrentWire(node.type)) {
        issues.push({
          pos: d.pos,
          positions: [d.pos, other.pos],
          message: '大きい接続どうしは、銅の電線ではつなげません。金かエレクトラムの電線にしてください。',
        })
      }
      uf.union(i, j)
    }
  })

  // 接続が付いているブロック（CA-CONNECTOR-SIDE・CA-CONNECTOR-MODE）
  /** 機械ごとの、電線から受け取れる量・電線へ出せる量の上限 */
  const pushLimit = new Map<number, number>()
  const pullLimit = new Map<number, number>()
  devices.forEach((d, i) => {
    if (!d.connector || d.connector.mode === 'none') return
    const facing = caFacing(bp.get(d.pos)!)
    if (!facing) return
    const j = at(addVec3(d.pos, directionVector(facing)))
    if (j === undefined || devices[j].kind === 'connector') return
    uf.union(i, j)
    const limits = d.connector.mode === 'push' ? pushLimit : pullLimit
    limits.set(j, (limits.get(j) ?? 0) + (d.connector.mode === 'push' ? d.connector.maxOut : d.connector.maxIn))
  })

  // 発電機・電源から隣へ（CA-ADJ-OUTPUT）。隣のモーター・蓄電池へ直接出す
  const direct = new Set<number>()
  devices.forEach((d, i) => {
    if (d.kind !== 'alternator' && d.kind !== 'creative') return
    for (const dir of DIRECTIONS) {
      const j = at(addVec3(d.pos, directionVector(dir)))
      if (j === undefined || (devices[j].kind !== 'motor' && devices[j].kind !== 'accumulator')) continue
      uf.union(i, j)
      direct.add(i)
      direct.add(j)
    }
  })

  // 積んだ蓄電池（CA-NET-GROUP）。隣り合う modular_accumulator を1つにする
  let stacked = false
  devices.forEach((d, i) => {
    if (d.id !== `${CA_NAMESPACE}:modular_accumulator`) return
    for (const dir of DIRECTIONS) {
      const j = at(addVec3(d.pos, directionVector(dir)))
      if (j === undefined || devices[j].id !== d.id) continue
      uf.union(i, j)
      stacked = true
    }
  })
  if (stacked) log.add('隣り合う蓄電池は、1つに積んだものとみなした（生データの Controller は見ていない）')

  // ネットワークごとに数える
  const groups = new Map<number, number[]>()
  devices.forEach((_d, i) => {
    const r = uf.find(i)
    groups.set(r, [...(groups.get(r) ?? []), i])
  })
  const networks: PowerNetwork[] = []
  const networkAt = new Map<string, number>()
  for (const members of groups.values()) {
    const index = networks.length + 1
    let supply = 0
    let demand = 0
    let storageCapacity = 0
    let storageStored = 0
    let hasSource = false
    // 蓄電池のまとまりが電気を出せるか（電線へ出す接続があるか）
    const accumulatorOut = members.some((i) => devices[i].kind === 'accumulator' && pullLimit.has(i))
    for (const i of members) {
      const d = devices[i]
      networkAt.set(posKey(d.pos), index)
      if (d.kind === 'alternator' || d.kind === 'creative') {
        hasSource = true
        // CA-NET-SUPPLY。接続を通すものは入力の上限で頭打ち
        const limit = direct.has(i) ? Infinity : (pullLimit.get(i) ?? 0)
        const through = Math.min(d.output, limit)
        if (d.output > limit && d.output !== Infinity) {
          // CA-CONNECTOR-LIMIT
          issues.push({ pos: d.pos, severity: 'warning', message: `接続の入力の上限（${formatFe(limit)} FE/t）より多く作っています。上限までしか電線に入りません。` })
        }
        supply += through
      }
      if (d.kind === 'accumulator' && accumulatorOut) {
        hasSource = true
        storageCapacity += d.capacity
        storageStored += d.stored
      }
      if (d.kind === 'motor' && d.active) {
        // CA-NET-DEMAND。接続を通すものは出力の上限で頭打ち
        const limit = direct.has(i) ? Infinity : (pushLimit.get(i) ?? 0)
        if (limit === 0) {
          issues.push({ pos: d.pos, severity: 'warning', message: '電気モーターに電気が来ていません。接続（電線から出す向き）か発電機をつないでください。' })
          continue
        }
        if (d.use > limit) {
          issues.push({ pos: d.pos, severity: 'warning', message: `電気モーターの使う量（${formatFe(d.use)} FE/t）が、接続の出力の上限（${formatFe(limit)} FE/t）を超えています。` })
        }
        demand += Math.min(d.use, limit)
      }
      if (d.connector?.size === 'light') demand += d.use
    }
    networks.push({ index, devices: members, supply, demand, storageCapacity, storageStored, hasSource })
  }

  for (const net of networks) {
    const motors = net.devices.filter((i) => devices[i].kind === 'motor' && devices[i].active).map((i) => devices[i].pos)
    if (net.demand === 0 || net.supply >= net.demand) continue
    if (!net.hasSource) {
      // CA-MOTOR-NO-POWER
      for (const pos of motors) {
        issues.push({ pos, severity: 'warning', message: '電気モーターが、発電機・蓄電池・電源のどれにもつながっていません。' })
      }
      continue
    }
    const deficit = net.demand - net.supply
    const first = devices[net.devices[0]].pos
    const positions = motors.length > 0 ? motors : [first]
    if (net.storageCapacity > 0) {
      // CA-NET-SHORTAGE（蓄電池あり）
      const minutes = net.storageCapacity / deficit / 20 / 60
      issues.push({
        pos: positions[0],
        positions,
        severity: 'warning',
        message: `電力 ${net.index}：作る量より ${formatFe(deficit)} FE/t 多く使います。蓄電池が満タンからおよそ ${formatFe(Math.round(minutes * 10) / 10)} 分で空になり、モーターが止まります。`,
      })
    } else {
      // CA-NET-SHORTAGE
      issues.push({
        pos: positions[0],
        positions,
        message: `電力 ${net.index}：電気が足りません（作る ${formatFe(net.supply)} FE/t、使う ${formatFe(net.demand)} FE/t）。ゲームではモーターが止まります。`,
      })
    }
  }

  return { devices, networks, networkAt, wires: wires.size, issues }
}
