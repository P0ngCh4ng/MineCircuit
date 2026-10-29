// Create の回転のつながり（docs/create-stress.md「つながりの規則と速度比」「計算の手順」）。
// KineticGraph.build で設計図からノードと辺を作り、evaluate で回転数・応力・容量を求める。
// 結果はプローブ（#31）などで使えるように、ノードごとの値も返す。

import type { BlockState } from '../../domain/blockState'
import type { Blueprint } from '../../domain/blueprint'
import { DIRECTIONS, directionVector, oppositeDirection, type Direction } from '../../domain/direction'
import type { RawNbt } from '../../domain/nbt'
import { addVec3, type Vec3 } from '../../domain/vec3'
import type { AssumptionLog } from '../assumptionLog'
import type { CalcIssue } from '../calcPlugin'
import { nbtBoolean, nbtNumber, nbtString } from '../nbtValues'
import { PROVENANCES, candidate, resolved, type Provenance, type Resolved } from '../provenance'
import type { VirtualPort } from '../virtualPort'
import {
  DEFAULT_SCROLL_SPEED,
  HAND_CRANK_SPEED,
  STEAM_ENGINE_BASE_SPEED,
  WATER_WHEEL_SPEED,
} from './createDefaults'
import type { CreateValueResolver } from './createValueResolver'
import {
  axisIndex,
  directionAxis,
  faceFactor,
  isCrank,
  isPositive,
  isKineticBlock,
  kineticShape,
  type Axis,
  type ChainInfo,
  type CogKind,
  type KineticShape,
} from './kineticBlocks'

export const CREATE_STRESS_PLUGIN_ID = 'create-stress'

export const OUT_OF_RANGE_NOTE = '範囲外は空気とみなした'

/** 動力源の値 */
export interface KineticSource {
  /** 生む回転数（符号付き） */
  readonly speed: Resolved<number>
  /** SU/RPM */
  readonly capacity: Resolved<number>
}

export interface KineticNode {
  readonly pos: Vec3
  /** 'create:shaft'。仮の入出力なら 'virtual:<kind>' */
  readonly id: string
  readonly axis: Axis
  readonly shaftFaces: readonly Direction[]
  readonly cog: CogKind
  readonly shape: KineticShape
  /** SU/RPM */
  readonly impact: Resolved<number>
  /** 回転数によらない応力（仮の負荷）。なければ null */
  readonly fixedStress: Resolved<number> | null
  readonly source: KineticSource | null
  /** 必要回転数。なければ 0 */
  readonly minSpeed: number
  /** 仮の入出力のノードなら、その id */
  readonly portId: string | null
}

export type KineticEdgeKind = 'shaft' | 'cog' | 'large-small' | 'large-large' | 'chain' | 'belt' | 'chain-conveyor'

export interface KineticEdge {
  readonly a: number
  readonly b: number
  /** b の回転数 = a の回転数 × ratio */
  readonly ratio: number
  readonly kind: KineticEdgeKind
}

export interface ControllerLink {
  /** 速度コントローラーのノード */
  readonly controller: number
  /** 真上の大歯車のノード */
  readonly cog: number
  /** ScrollValue */
  readonly target: Resolved<number>
}

/** 計算に使う設定 */
export interface KineticSettings {
  readonly maxRotationSpeed: number
  readonly disableStress: boolean
}

/** ノード1つ分の結果 */
export interface NodeResult {
  /** 実際の回転数。過負荷・衝突なら 0 */
  readonly speed: number
  /** 過負荷の前の回転数（応力はこれで数える） */
  readonly theoreticalSpeed: number
  /** 応力（SU） */
  readonly stress: number
  /** ネットワークの番号（networks の添字） */
  readonly network: number
  /** 回転数の出どころ（決めた動力源の出どころ） */
  readonly speedSource: Provenance
}

export interface NetworkResult {
  readonly nodes: readonly number[]
  readonly stress: number
  readonly capacity: number
  readonly overloaded: boolean
  /** 回転数の絶対値の範囲（回っていなければ 0） */
  readonly minSpeed: number
  readonly maxSpeed: number
  /** 使った値のうち一番信頼できない出どころ */
  readonly source: Provenance
  /** 動力源（仮の入出力を含む）か、消費があるノードを含む */
  readonly active: boolean
}

export interface KineticEvaluation {
  readonly nodes: readonly NodeResult[]
  readonly networks: readonly NetworkResult[]
  readonly issues: readonly CalcIssue[]
}

const SPEED_TOLERANCE = 1 / 65536

const UNPOWERED_MESSAGE = '動力源につながっていません。回りません。'
const STOPPED_MESSAGE = '回転数が 0 です。つながっている動力源が止まっています。'

/** 回るブロックなのに、回転軸を決めるブロック状態がないか読めないとき（docs/create-stress.md「手順」1.） */
function missingStateMessage(state: BlockState): string {
  const shown = Object.entries(state.properties).map(([k, v]) => `${k}=${v}`).join(',')
  return shown === ''
    ? 'ブロック状態がないので、回転軸が決まりません。計算に入れていません。向き（axis・facing など）を付けて置き直してください。'
    : `ブロック状態（${shown}）から回転軸が決まりません。計算に入れていません。向き（axis・facing など）を直してください。`
}

/** 出どころのうち、信頼できない方 */
export function weakerSource(a: Provenance, b: Provenance): Provenance {
  return PROVENANCES.indexOf(a) >= PROVENANCES.indexOf(b) ? a : b
}

function posKey(p: Vec3): string {
  return `${p[0]},${p[1]},${p[2]}`
}

/** 調べる相手の位置。6方向の隣と、斜めの12マス（差の2乗の和が 2） */
const NEIGHBOR_OFFSETS: readonly Vec3[] = (() => {
  const result: Vec3[] = []
  for (let x = -1; x <= 1; x++) {
    for (let y = -1; y <= 1; y++) {
      for (let z = -1; z <= 1; z++) {
        const n = x * x + y * y + z * z
        if (n === 1 || n === 2) result.push([x, y, z])
      }
    }
  }
  return result
})()

function unitDirection(diff: Vec3): Direction | null {
  for (const d of DIRECTIONS) {
    const v = directionVector(d)
    if (v[0] === diff[0] && v[1] === diff[1] && v[2] === diff[2]) return d
  }
  return null
}

function chainModifier(node: KineticNode, be: RawNbt | null): number {
  if (node.id !== 'create:adjustable_chain_gearshift') return 1
  const signal = nbtNumber(be, 'Signal') ?? 0
  return signal === 0 ? 1 : 1 + (signal + 1) / 16
}

export class KineticGraph {
  private constructor(
    readonly nodes: readonly KineticNode[],
    readonly edges: readonly KineticEdge[],
    readonly controllers: readonly ControllerLink[],
    private readonly log: AssumptionLog,
    /** build の中で見つけた問題（仮の入出力をつなげなかった、など） */
    private readonly buildIssues: readonly CalcIssue[],
  ) {}

  /**
   * 設計図からノードと辺を作る。仮定（範囲外、nbt がない動力源など）は log に足す。
   * ports は 'create-stress' 宛ての仮の入出力。
   */
  static build(bp: Blueprint, ports: readonly VirtualPort[], values: CreateValueResolver, log: AssumptionLog): KineticGraph {
    const nodes: KineticNode[] = []
    const byPos = new Map<string, number>()
    const blockEntities: (RawNbt | null)[] = []
    const issues: CalcIssue[] = []
    const mediumSpeed = values.mediumSpeed().value

    // 1. ノードを作る（リージョンが重なる位置は先のリージョンを使う）
    for (const region of bp.regions) {
      region.forEachBlock((x, y, z, state, be) => {
        const pos = addVec3([x, y, z], region.offset)
        const key = posKey(pos)
        if (byPos.has(key) || bp.locate(pos)?.region !== region) return
        const node = makeNode(pos, state, be, values, log, mediumSpeed, issues)
        if (!node) return
        byPos.set(key, nodes.length)
        nodes.push(node)
        blockEntities.push(be)
      })
    }
    const realCount = nodes.length
    const at = (p: Vec3): number | undefined => byPos.get(posKey(p))
    const inside = (p: Vec3): boolean => bp.locate(p) !== null

    // 2. 辺を作る
    const edges: KineticEdge[] = []
    const connected = new Set<string>()
    const addEdge = (a: number, b: number, ratio: number, kind: KineticEdgeKind): void => {
      const key = a < b ? `${a}|${b}` : `${b}|${a}`
      if (connected.has(key)) return
      connected.add(key)
      edges.push({ a, b, ratio, kind })
    }
    for (let a = 0; a < realCount; a++) {
      const A = nodes[a]
      for (const off of NEIGHBOR_OFFSETS) {
        const b = at(addVec3(A.pos, off))
        if (b === undefined || b <= a) continue
        const B = nodes[b]
        let link = connection(A, B, blockEntities[a], blockEntities[b])
        if (!link) {
          const back = connection(B, A, blockEntities[b], blockEntities[a])
          if (back) link = { ratio: 1 / back.ratio, kind: back.kind }
        }
        if (link) addEdge(a, b, link.ratio, link.kind)
      }
    }

    // ベルト：part=start から end までたどる
    for (let a = 0; a < realCount; a++) {
      const node = nodes[a]
      if (node.id !== 'create:belt' || bp.get(node.pos)?.properties.part !== 'start') continue
      let prev = a
      for (let step = 0; step < realCount; step++) {
        const state = bp.get(nodes[prev].pos)
        if (!state || state.properties.part === 'end') break
        const next = nextBeltSegment(nodes[prev].pos, state)
        if (!next) break
        if (!inside(next)) {
          log.add('ベルトの続きが設計図の外にある。範囲外は空気とみなした', nodes[prev].pos)
          break
        }
        const b = at(next)
        if (b === undefined || nodes[b].id !== 'create:belt') break
        addEdge(prev, b, 1, 'belt')
        prev = b
      }
    }

    // チェーンコンベア（6.0）：nbt の Connections
    for (let a = 0; a < realCount; a++) {
      if (nodes[a].id !== 'create:chain_conveyor') continue
      for (const rel of chainConveyorConnections(blockEntities[a])) {
        const target = addVec3(nodes[a].pos, rel)
        if (!inside(target)) {
          log.add('チェーンコンベアのつながる先が設計図の外にある。範囲外は空気とみなした', nodes[a].pos)
          continue
        }
        const b = at(target)
        if (b !== undefined && nodes[b].id === 'create:chain_conveyor') addEdge(a, b, 1, 'chain-conveyor')
      }
    }

    // 仮の入出力：面の向こうにノードを置き、シャフトとして r = 1 でつなぐ
    const portFaces = new Set<string>()
    for (const port of ports) {
      // 物の入口（#127）は回転とつながないので、軸の口は要らない
      if (port.kind === ITEM_INPUT_PORT_KIND) continue
      const target = at(port.pos)
      const node = target === undefined ? null : nodes[target]
      if (target === undefined || !node || !node.shaftFaces.includes(port.face)) {
        issues.push({
          pos: [port.pos[0], port.pos[1], port.pos[2]],
          message: `仮の入出力${port.label ? `「${port.label}」` : ''}をつなげません。軸の口がある面に置いてください。`,
        })
        continue
      }
      const virtual = makePortNode(port, log)
      if (!virtual) continue
      portFaces.add(`${posKey(port.pos)}|${port.face}`)
      const v = nodes.length
      nodes.push(virtual)
      // virtual の回転数 = node の回転数 × faceFactor(node, face)
      addEdge(target, v, faceFactor(node.shape, port.face), 'shaft')
    }

    // 3. 範囲外を記録する
    for (let a = 0; a < realCount; a++) {
      const node = nodes[a]
      const outside = node.shaftFaces.some(
        (f) => !inside(addVec3(node.pos, directionVector(f))) && !portFaces.has(`${posKey(node.pos)}|${f}`),
      )
      // 歯車は、回転軸に垂直な面の上の隣と斜めにかみ合う
      const cogOutside =
        node.cog !== 'none' &&
        NEIGHBOR_OFFSETS.some((off) => off[axisIndex(node.axis)] === 0 && !inside(addVec3(node.pos, off)))
      if (outside || cogOutside) log.add(OUT_OF_RANGE_NOTE, node.pos)
    }

    // 速度コントローラー：真上の大歯車（軸が水平で、コントローラーの軸と違う）
    const controllers: ControllerLink[] = []
    for (let c = 0; c < realCount; c++) {
      const ctrl = nodes[c]
      if (ctrl.id !== 'create:rotation_speed_controller') continue
      const g = at(addVec3(ctrl.pos, [0, 1, 0]))
      if (g === undefined) continue
      const cog = nodes[g]
      if (cog.cog !== 'large' || cog.axis === 'y' || cog.axis === ctrl.axis) continue
      const scroll = nbtNumber(blockEntities[c], 'ScrollValue')
      const target = scroll === null ? resolved(DEFAULT_SCROLL_SPEED, 'builtin') : resolved(scroll, 'blueprint')
      controllers.push({ controller: c, cog: g, target })
    }

    return new KineticGraph(nodes, edges, controllers, log, issues)
  }

  /** 回転数・応力・容量を求める */
  evaluate(settings: KineticSettings): KineticEvaluation {
    const n = this.nodes.length
    const issues: CalcIssue[] = [...this.buildIssues]
    const issueKeys = new Set<string>()
    const addIssue = (pos: Vec3, message: string, severity?: 'warning'): void => {
      const key = `${posKey(pos)}|${message}`
      if (issueKeys.has(key)) return
      issueKeys.add(key)
      issues.push(severity ? { pos: [pos[0], pos[1], pos[2]], message, severity } : { pos: [pos[0], pos[1], pos[2]], message })
    }

    // 4. 剛体のまとまりに分け、5. 比 k を決める
    const adjacency: { to: number; ratio: number }[][] = Array.from({ length: n }, () => [])
    for (const e of this.edges) {
      adjacency[e.a].push({ to: e.b, ratio: e.ratio })
      adjacency[e.b].push({ to: e.a, ratio: 1 / e.ratio })
    }
    const group = new Array<number>(n).fill(-1)
    const k = new Array<number>(n).fill(0)
    const groups: number[][] = []
    const broken: boolean[] = []
    for (let start = 0; start < n; start++) {
      if (group[start] !== -1) continue
      const g = groups.length
      const members = [start]
      group[start] = g
      k[start] = 1
      let isBroken = false
      for (let i = 0; i < members.length; i++) {
        const a = members[i]
        for (const { to, ratio } of adjacency[a]) {
          const expected = k[a] * ratio
          if (group[to] === -1) {
            group[to] = g
            k[to] = expected
            members.push(to)
            continue
          }
          if (Math.sign(expected) !== Math.sign(k[to])) {
            isBroken = true
            this.conflict(addIssue, a, to, '回転の向きがぶつかっています。ゲームではブロックが壊れます。')
          } else if (Math.abs(expected - k[to]) > SPEED_TOLERANCE * Math.max(Math.abs(expected), Math.abs(k[to]))) {
            isBroken = true
            this.conflict(addIssue, a, to, '回転数がぶつかっています（つながり方で回転数が1つに決まりません）。ゲームではブロックが壊れます。')
          }
        }
      }
      groups.push(members)
      broken.push(isBroken)
    }

    // 6. 7. まとまりの倍率 x を決める（速度コントローラーは依存の順に）
    const incoming: ControllerLink[][] = groups.map(() => [])
    const outgoing: number[][] = groups.map(() => [])
    for (const link of this.controllers) {
      incoming[group[link.cog]].push(link)
      outgoing[group[link.controller]].push(group[link.cog])
    }
    const order = this.topologicalOrder(groups.length, incoming, outgoing, group)
    const factor = new Array<number>(groups.length).fill(0)
    const factorSource = new Array<Provenance>(groups.length).fill('builtin')
    const solved = new Array<boolean>(groups.length).fill(false)
    for (const g of order) {
      solved[g] = true
      if (broken[g]) continue
      const candidates: { x: number; source: Provenance; pos: Vec3 }[] = []
      for (const m of groups[g]) {
        const src = this.nodes[m].source
        if (!src || src.speed.value === 0 || k[m] === 0) continue
        candidates.push({ x: src.speed.value / k[m], source: src.speed.source, pos: this.nodes[m].pos })
      }
      for (const link of incoming[g]) {
        const input = group[link.controller]
        if (!solved[input] || input === g) continue
        const controllerSpeed = factor[input] * k[link.controller]
        if (controllerSpeed === 0 || link.target.value === 0) continue
        candidates.push({
          x: link.target.value / k[link.cog],
          source: weakerSource(link.target.source, factorSource[input]),
          pos: this.nodes[link.cog].pos,
        })
      }
      if (candidates.length === 0) continue
      const sign = Math.sign(candidates[0].x)
      if (candidates.some((c) => Math.sign(c.x) !== sign)) {
        for (const c of candidates) addIssue(c.pos, '動力源の回転の向きがぶつかっています。ゲームではブロックが壊れます。')
        continue
      }
      let best = candidates[0]
      for (const c of candidates) if (Math.abs(c.x) > Math.abs(best.x)) best = c
      factor[g] = best.x
      factorSource[g] = best.source
    }
    const theoretical = k.map((kn, i) => factor[group[i]] * kn)

    // 8. 速度の上限
    for (let i = 0; i < n; i++) {
      if (this.nodes[i].portId !== null) continue
      if (Math.abs(theoretical[i]) > settings.maxRotationSpeed) {
        addIssue(
          this.nodes[i].pos,
          `回転が速すぎます（${formatNumber(Math.abs(theoretical[i]))} RPM、上限 ${formatNumber(settings.maxRotationSpeed)} RPM）。ゲームではブロックが壊れます。`,
        )
      }
    }

    // 9. ネットワークに分ける（まとまりを速度コントローラーでつなぐ）
    const parent = groups.map((_, i) => i)
    const find = (i: number): number => {
      while (parent[i] !== i) {
        parent[i] = parent[parent[i]]
        i = parent[i]
      }
      return i
    }
    for (const link of this.controllers) parent[find(group[link.controller])] = find(group[link.cog])
    const networkOf = new Map<number, number>()
    const networkNodes: number[][] = []
    for (let i = 0; i < n; i++) {
      const root = find(group[i])
      let net = networkOf.get(root)
      if (net === undefined) {
        net = networkNodes.length
        networkOf.set(root, net)
        networkNodes.push([])
      }
      networkNodes[net].push(i)
    }

    // 10. 応力と容量を足す、11. 判定する
    const stressOf = (i: number): number => {
      const node = this.nodes[i]
      const fixed = node.fixedStress && theoretical[i] !== 0 ? node.fixedStress.value : 0
      return node.impact.value * Math.abs(theoretical[i]) + fixed
    }
    const nodeNetwork = new Array<number>(n).fill(0)
    const networks: NetworkResult[] = networkNodes.map((members, net) => {
      let stress = 0
      let capacity = 0
      let source: Provenance = 'blueprint'
      let active = false
      for (const i of members) {
        nodeNetwork[i] = net
        const node = this.nodes[i]
        const s = stressOf(i)
        stress += s
        if (s !== 0) source = weakerSource(source, node.impact.source)
        if (node.impact.value !== 0 || node.fixedStress) active = true
        if (node.source) {
          active = true
          const add = node.source.capacity.value * Math.abs(node.source.speed.value)
          capacity += add
          if (add !== 0) source = weakerSource(source, weakerSource(node.source.capacity.source, node.source.speed.source))
        }
      }
      const overloaded = !settings.disableStress && capacity < stress
      const speeds = members.map((i) => Math.abs(theoretical[i])).filter((s) => s !== 0)
      return {
        nodes: members,
        stress,
        capacity,
        overloaded,
        minSpeed: speeds.length ? Math.min(...speeds) : 0,
        maxSpeed: speeds.length ? Math.max(...speeds) : 0,
        source,
        active,
      }
    })

    const nodes: NodeResult[] = this.nodes.map((_node, i) => {
      const net = networks[nodeNetwork[i]]
      const speed = net.overloaded ? 0 : theoretical[i]
      return {
        speed,
        theoreticalSpeed: theoretical[i],
        stress: stressOf(i),
        network: nodeNetwork[i],
        speedSource: factorSource[group[i]],
      }
    })

    for (const net of networks) {
      if (net.overloaded) {
        const message = `応力が足りません（使用 ${formatNumber(net.stress)} SU / 供給 ${formatNumber(net.capacity)} SU）。ネットワーク全体が止まります。`
        for (const i of net.nodes) if (this.nodes[i].portId === null) addIssue(this.nodes[i].pos, message)
        continue
      }
      for (const i of net.nodes) {
        const node = this.nodes[i]
        const s = Math.abs(theoretical[i])
        if (s !== 0 && s < node.minSpeed) {
          addIssue(
            node.pos,
            `回転数が足りません（${formatNumber(s)} RPM。${formatNumber(node.minSpeed)} RPM 以上が必要）。機械が動きません。`,
          )
        }
      }
    }

    // 12. 止まっているブロック（#148）。過負荷と衝突のまとまりは、もう問題に出しているので除く
    for (const net of networks) {
      if (net.overloaded) continue
      const powered = net.nodes.some((m) => this.nodes[m].source !== null)
      const warning = powered ? STOPPED_MESSAGE : UNPOWERED_MESSAGE
      for (const m of net.nodes) {
        if (this.nodes[m].portId !== null || theoretical[m] !== 0 || broken[group[m]]) continue
        addIssue(this.nodes[m].pos, warning, 'warning')
      }
    }

    return { nodes, networks, issues }
  }

  private conflict(addIssue: (pos: Vec3, message: string) => void, a: number, b: number, message: string): void {
    for (const i of [a, b]) if (this.nodes[i].portId === null) addIssue(this.nodes[i].pos, message)
  }

  /** 速度コントローラーの依存の順。輪になったまとまりは最後に回し、仮定に載せる */
  private topologicalOrder(
    count: number,
    incoming: readonly ControllerLink[][],
    outgoing: readonly number[][],
    group: readonly number[],
  ): number[] {
    const indegree = incoming.map((links) => links.filter((l) => group[l.controller] !== group[l.cog]).length)
    const order: number[] = []
    const queue: number[] = []
    for (let g = 0; g < count; g++) if (indegree[g] === 0) queue.push(g)
    const done = new Array<boolean>(count).fill(false)
    while (queue.length > 0) {
      const g = queue.shift() as number
      done[g] = true
      order.push(g)
      for (const to of outgoing[g]) {
        if (to === g) continue
        indegree[to]--
        if (indegree[to] === 0) queue.push(to)
      }
    }
    for (let g = 0; g < count; g++) {
      if (done[g]) continue
      order.push(g)
      for (const link of incoming[g]) {
        this.log.add('速度コントローラーの出力が入力に戻っているので、このコントローラーは計算に入れていない', this.nodes[link.controller].pos)
      }
    }
    for (const link of this.controllers) {
      if (group[link.controller] === group[link.cog]) {
        this.log.add('速度コントローラーの出力が入力に戻っているので、このコントローラーは計算に入れていない', this.nodes[link.controller].pos)
      }
    }
    return order
  }
}

/** 数を画面に出す形にする（3桁区切り、小数は2桁まで） */
export function formatNumber(value: number): string {
  return new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 2 }).format(value === 0 ? 0 : value)
}

/** A から B へのつながり（docs/create-stress.md の規則 1〜5）。つながらなければ null */
function connection(
  A: KineticNode,
  B: KineticNode,
  beA: RawNbt | null,
  beB: RawNbt | null,
): { ratio: number; kind: KineticEdgeKind } | null {
  const diff: Vec3 = [B.pos[0] - A.pos[0], B.pos[1] - A.pos[1], B.pos[2] - A.pos[2]]
  const d = unitDirection(diff)

  // 1. シャフト同士
  if (d && A.shaftFaces.includes(d) && B.shaftFaces.includes(oppositeDirection(d))) {
    return { ratio: faceFactor(A.shape, d) / faceFactor(B.shape, oppositeDirection(d)), kind: 'shaft' }
  }
  // 2. チェーンドライブ同士
  if (d && A.shape.chain && B.shape.chain && chainConnects(A.shape.chain, B.shape.chain, d)) {
    return { ratio: chainModifier(A, beA) / chainModifier(B, beB), kind: 'chain' }
  }
  // 3. 大歯車同士（直角に組んだ斜め）
  if (A.cog === 'large' && B.cog === 'large' && A.axis !== B.axis) {
    const ia = axisIndex(A.axis)
    const ib = axisIndex(B.axis)
    const rest = 3 - ia - ib
    if (diff[ia] !== 0 && diff[ib] !== 0 && diff[rest] === 0) {
      return { ratio: diff[ia] > 0 !== diff[ib] > 0 ? -1 : 1, kind: 'large-large' }
    }
  }
  // 4. 大歯車と小歯車（同じ面の斜め）
  if (A.cog !== 'none' && B.cog !== 'none' && A.cog !== B.cog && A.axis === B.axis) {
    const ia = axisIndex(A.axis)
    const others = [0, 1, 2].filter((i) => i !== ia)
    if (diff[ia] === 0 && others.every((i) => Math.abs(diff[i]) === 1)) {
      return { ratio: A.cog === 'large' ? -2 : -0.5, kind: 'large-small' }
    }
  }
  // 5. 小歯車同士
  if (d && A.cog === 'small' && B.cog === 'small' && A.axis === B.axis && directionAxis(d) !== A.axis) {
    return { ratio: -1, kind: 'cog' }
  }
  return null
}

function chainConnects(a: ChainInfo, b: ChainInfo, d: Direction): boolean {
  if (a.connectionAxis !== b.connectionAxis || directionAxis(d) !== a.connectionAxis) return false
  return isPositive(d) ? a.positive : a.negative
}

/** ベルトの次の区間の位置（BeltBlock.nextSegmentPosition の規則） */
export function nextBeltSegment(pos: Vec3, state: BlockState): Vec3 | null {
  const facing = state.properties.facing
  const dir = (['north', 'south', 'east', 'west'] as const).find((f) => f === facing)
  if (!dir) return null
  const slope = state.properties.slope
  if (slope === 'vertical') return addVec3(pos, [0, isPositive(dir) ? 1 : -1, 0])
  const next = addVec3(pos, directionVector(dir))
  if (slope === 'upward') return addVec3(next, [0, 1, 0])
  if (slope === 'downward') return addVec3(next, [0, -1, 0])
  return next
}

/** チェーンコンベアの Connections（相対位置の一覧）。int 配列と {X, Y, Z} の両方を読む */
function chainConveyorConnections(be: RawNbt | null): Vec3[] {
  const tag = be?.value.get('Connections')
  if (!tag || tag.type !== 'list') return []
  const result: Vec3[] = []
  for (const item of tag.value) {
    if (item.type === 'intArray' && item.value.length === 3) result.push([item.value[0], item.value[1], item.value[2]])
    else if (item.type === 'compound') {
      const x = nbtNumber(item, 'X')
      const y = nbtNumber(item, 'Y')
      const z = nbtNumber(item, 'Z')
      if (x !== null && y !== null && z !== null) result.push([x, y, z])
    }
  }
  return result
}

/** 設計図のブロック1つからノードを作る。回転に関わらなければ null */
function makeNode(
  pos: Vec3,
  state: BlockState,
  be: RawNbt | null,
  values: CreateValueResolver,
  log: AssumptionLog,
  mediumSpeed: number,
  issues: CalcIssue[],
): KineticNode | null {
  const ns = state.id.namespace
  const path = state.id.path
  if (ns !== 'create') {
    // Create の追加 Mod（createaddition、create_enchantment_industry など）は自分の設定で値を持つ。対象外
    if (ns.startsWith('create')) log.add(`${state.id.toString()} は Create の追加 Mod のブロックなので、計算に入れていない`, pos)
    return null
  }
  if (path === 'gantry_carriage') {
    log.add('ガントリーのキャリッジは計算に入れていない', pos)
    return null
  }
  const shape = kineticShape(path, state)
  if (!shape) {
    if (isKineticBlock(path)) issues.push({ pos, message: missingStateMessage(state) })
    return null
  }
  if (shape.note) log.add(shape.note, pos)
  const facing = state.properties.facing
  const negativeFacing = facing === 'down' || facing === 'north' || facing === 'west'
  return {
    pos,
    id: state.id.toString(),
    axis: shape.axis,
    shaftFaces: shape.shaftFaces,
    cog: shape.cog,
    shape,
    impact: values.impact(path),
    fixedStress: null,
    source: makeSource(path, be, negativeFacing, values, log, pos),
    minSpeed: path === 'mechanical_mixer' || path === 'display_board' ? mediumSpeed : 0,
    portId: null,
  }
}

/** 動力源の生む回転数と容量（docs/create-stress.md「動力源の回転数」）。動力源でなければ null */
function makeSource(
  path: string,
  be: RawNbt | null,
  negativeFacing: boolean,
  values: CreateValueResolver,
  log: AssumptionLog,
  pos: Vec3,
): KineticSource | null {
  if (path === 'creative_motor') {
    const scroll = nbtNumber(be, 'ScrollValue')
    const base = scroll === null ? resolved(DEFAULT_SCROLL_SPEED, 'builtin') : resolved(scroll, 'blueprint')
    const speed = negativeFacing ? -base.value : base.value
    return { speed: resolved(speed === 0 ? 0 : speed, base.source), capacity: values.capacity(path) }
  }
  if (path === 'water_wheel' || path === 'large_water_wheel') {
    const flow = log.resolve(
      [candidate('blueprint', () => nbtNumber(be, 'FlowScore'))],
      resolved(1, 'assumed', '水車の水の流れ（FlowScore）がないので、正の向きに流れているとみなした'),
      pos,
    )
    const size = path === 'large_water_wheel' ? 2 : 1
    const speed = (Math.max(-1, Math.min(1, flow.value)) * WATER_WHEEL_SPEED) / size
    return { speed: resolved(speed === 0 ? 0 : speed, flow.source), capacity: values.capacity(path) }
  }
  if (path === 'windmill_bearing') {
    const running = nbtBoolean(be, 'Running')
    const last = nbtNumber(be, 'LastGenerated')
    const speed =
      running !== null && last !== null
        ? resolved(running ? last : 0, 'blueprint')
        : log.resolve([], resolved(0, 'assumed', '風車が回っているかが分からないので、止まっているとみなした'), pos)
    return { speed, capacity: values.capacity(path) }
  }
  if (isCrank(path)) {
    log.add('ハンドルは回しているとみなした', pos)
    const backwards = nbtBoolean(be, 'Backwards')
    const sign = (backwards ? -1 : 1) * (negativeFacing ? -1 : 1)
    return {
      speed: resolved(sign * HAND_CRANK_SPEED, 'assumed'),
      // 色付きのバルブハンドルは copper_valve_handle の値を使う
      capacity: values.capacity(path === 'hand_crank' ? path : 'copper_valve_handle'),
    }
  }
  if (path === 'powered_shaft') {
    const efficiency = nbtNumber(be, 'EnginePower')
    const direction = nbtNumber(be, 'Direction')
    if (efficiency === null || direction === null) {
      log.add('蒸気エンジンの状態（EnginePower・Direction）がないので、止まっているとみなした', pos)
      return { speed: resolved(0, 'assumed'), capacity: resolved(0, 'assumed') }
    }
    if (efficiency <= 0 || direction === 0) return { speed: resolved(0, 'blueprint'), capacity: resolved(0, 'blueprint') }
    const k = efficiency >= 1 ? 4 : 1 + Math.min(2, Math.floor(efficiency * 4))
    const engineType = nbtString(be, 'EngineType') ?? 'create:steam_engine'
    const engineName = engineType.startsWith('create:') ? engineType.slice('create:'.length) : engineType
    const base = values.capacity(engineName)
    return {
      speed: resolved(Math.sign(direction) * STEAM_ENGINE_BASE_SPEED * k, 'blueprint'),
      capacity: resolved((efficiency * base.value) / k, weakerSource('blueprint', base.source)),
    }
  }
  return null
}

/** 仮の入出力のノード。面の向こうに置き、その面の軸に沿って回る */
function makePortNode(port: VirtualPort, log: AssumptionLog): KineticNode | null {
  const face = port.face
  const axis = directionAxis(face)
  const shape: KineticShape = { axis, shaftFaces: [oppositeDirection(face)], cog: 'none', faceFactors: null, chain: null }
  const base = {
    pos: addVec3(port.pos, directionVector(face)),
    id: `virtual:${port.kind}`,
    axis,
    shaftFaces: shape.shaftFaces,
    cog: 'none' as const,
    shape,
    minSpeed: 0,
    portId: port.id,
  }
  if (port.kind === 'rotation-source') {
    const rpm = port.params.rpm ?? 0
    const capacity = port.params.capacity ?? 0
    return {
      ...base,
      impact: resolved(0, 'virtual'),
      fixedStress: null,
      source: {
        speed: resolved(rpm, 'virtual'),
        capacity: resolved(rpm === 0 ? 0 : capacity / Math.abs(rpm), 'virtual'),
      },
    }
  }
  if (port.kind === 'rotation-load') {
    const stress = port.params.stress
    const impact = port.params.impact
    return {
      ...base,
      impact: resolved(stress === undefined ? (impact ?? 0) : 0, 'virtual'),
      fixedStress: stress === undefined ? null : resolved(stress, 'virtual'),
      source: null,
    }
  }
  // 物の入口（#127）は回転と関係ない。物の通り道の計算（createItemPath.ts）で使う
  if (port.kind === ITEM_INPUT_PORT_KIND) return null
  log.add(`仮の入出力の種類 ${port.kind} は Create の応力では使えないので、計算に入れていない`, port.pos)
  return null
}

/** 仮の入出力「物の入口」の種類（#127） */
export const ITEM_INPUT_PORT_KIND = 'item-input'

