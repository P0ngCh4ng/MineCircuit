// 物の通り道（docs/create-throughput.md「物の通り道（#127）」）。
// 仮の入出力「物の入口」から、どのブロックに、どの物が、1秒に何個届くかをたどる。
// 機械に届いたらレシピでできる物に変えて先へ進み、行き先が2つ以上なら数を等しく分ける。
// 回転数は応力の計算（kineticGraph.ts）の結果を rpmAt で受け取る。

import type { BlockState } from '../../domain/blockState'
import type { Blueprint } from '../../domain/blueprint'
import { directionVector, isDirection, oppositeDirection, type Direction } from '../../domain/direction'
import { addVec3, equalsVec3, type Vec3 } from '../../domain/vec3'
import type { ProcessingRecipeType, RecipeBook } from '../../io/modpack/recipes'
import type { AssumptionLog } from '../assumptionLog'
import type { CalcIssue, CalcSummaryItem } from '../calcPlugin'
import { nbtPos, nbtString } from '../nbtValues'
import { resolved, type Provenance } from '../provenance'
import type { VirtualPort } from '../virtualPort'
import { chooseRecipe, formatRate, machineCapacityPerMinute, RECIPE_MACHINE_NAMES, type RecipeChoice } from './createThroughput'
import { axisDirections, directionAxis } from './kineticBlocks'
import { ITEM_INPUT_PORT_KIND, nextBeltSegment, weakerSource } from './kineticGraph'

/** たどる場所の数の上限（1つの物の入口ごと） */
export const MAX_PATH_STEPS = 256
/** 空気の先へ落ちる物を探す深さ */
const FALL_DEPTH = 3
/** これより少ない数は届かないものとする（確率を掛けて小さくなった数など） */
const EPSILON = 1e-9

/** 1秒あたりの物の流れ */
interface Flow {
  readonly item: string
  /** 個/秒 */
  readonly rate: number
  /** 物の入口（'virtual'）、レシピ、仮定のうち、一番弱い出どころ */
  readonly source: Provenance
}

/** 届く物1つ分 */
export interface ItemArrival {
  readonly item: string
  /** 個/秒 */
  readonly rate: number
  /** どこから来たか。null は物の入口 */
  readonly from: Vec3 | null
  readonly source: Provenance
}

/** できる物1つ分 */
export interface ItemOutput {
  readonly item: string
  /** 個/秒 */
  readonly rate: number
  readonly source: Provenance
}

/** 機械で使ったレシピ */
export interface AppliedRecipe {
  readonly type: ProcessingRecipeType
  /** 材料（届いた物） */
  readonly input: string
  readonly choice: RecipeChoice
  readonly outputs: ItemOutput[]
}

/** 位置ごとの記録 */
export interface ItemPathRecord {
  readonly pos: Vec3
  readonly arrivals: ItemArrival[]
  readonly recipes: AppliedRecipe[]
  /** 先がなく溜まる物 */
  readonly sinks: ItemOutput[]
  /** レシピのない物 */
  readonly noRecipe: string[]
  /** Modpack のレシピがなく、レシピが分からなかった（noRecipe の物に、レシピがないとは限らない） */
  recipesUnknown: boolean
  /** 「止まっているので、物はここで止まる」など */
  readonly notes: string[]
  /** 機械が1分に処理できる数。機械でなければ null */
  capacityPerMinute: number | null
  /** レシピで処理した数（個/秒）の合計。処理できる数で頭打ちにするのに使う */
  processedRate: number
}

export interface ItemPathEnv {
  readonly bp: Blueprint
  /** Modpack のレシピ。なければ null */
  readonly recipes: RecipeBook | null
  readonly log: AssumptionLog
  /** 回るブロックの回転数（止まっている・過負荷・回転数が足りないなら 0）。回るブロックでなければ null */
  readonly rpmAt: (pos: Vec3) => number | null
  /** 設定の bulkPressing（プレスがスタックごと押すか） */
  readonly bulkPressing: boolean
}

/** 律速の機械。docs/create-throughput.md「律速（#168）」 */
export interface Bottleneck {
  readonly pos: Vec3
  /** 機械の名前（「石臼」など） */
  readonly machine: string
  /** 届く数（個/分） */
  readonly arrivingPerMinute: number
  /** 処理できる数（個/分） */
  readonly capacityPerMinute: number
  /** 届く数 ÷ 処理できる数 */
  readonly utilization: number
}

/** 生産ラインの流れ。物の入口をたどらなかったら null */
export interface LineFlow {
  /** 入る数（個/分）。たどった物の入口の合計 */
  readonly inputPerMinute: number
  /** 出る数（個/分）。溜まる所に届く数の合計 */
  readonly outputPerMinute: number
  /** 処理する機械がなければ null */
  readonly bottleneck: Bottleneck | null
  readonly source: Provenance
}

export interface ItemPathResult {
  readonly records: readonly ItemPathRecord[]
  /** 「処理が追いつかない」 */
  readonly issues: readonly CalcIssue[]
  readonly line: LineFlow | null
  /** その位置に届く物の ID（レシピを決めるのに使う。docs/create-throughput.md「どのレシピか」の 1） */
  itemsAt(pos: Vec3): string[]
}

/** 機械アームの取る先・置く先（設計図全体の座標） */
interface ArmInfo {
  readonly pos: Vec3
  readonly take: readonly Vec3[]
  readonly deposit: readonly Vec3[]
}

/** 物を出す先1つ分 */
interface Destination {
  /** 渡す先 */
  readonly to: Vec3
  /** 渡す先が受け取る面。null は入れ物に直接入れる（機械アーム・ファンネル） */
  readonly face: Direction | null
  /** 渡す元（ファンネル・機械アーム）。届く物として記録する */
  readonly via: Vec3 | null
  /** 出す元 */
  readonly from: Vec3
}

/** 物の入口からたどる。docs/create-throughput.md「物の通り道」 */
export function traceItemPaths(ports: readonly VirtualPort[], env: ItemPathEnv): ItemPathResult {
  const tracer = new ItemTracer(env)
  for (const port of ports) {
    if (port.kind !== ITEM_INPUT_PORT_KIND) continue
    const item = port.items?.item
    if (!item) {
      env.log.add('物の入口のアイテムが選ばれていない', port.pos)
      continue
    }
    const rate = port.params.rate ?? 0
    if (!(rate > 0)) continue
    tracer.tracePort(port.pos, port.face, { item, rate, source: 'virtual' })
  }
  return tracer.result()
}

/** 律速を決める。docs/create-throughput.md「律速（#168）」 */
function lineFlow(records: readonly ItemPathRecord[], inputRate: number): LineFlow | null {
  if (!(inputRate > 0)) return null
  let bottleneck: Bottleneck | null = null
  const sources: Provenance[] = []
  let output = 0
  for (const r of records) {
    for (const a of r.arrivals) sources.push(a.source)
    for (const s of r.sinks) {
      output += s.rate
      sources.push(s.source)
    }
    for (const applied of r.recipes) sources.push(applied.choice.duration.source)
    const recipe = r.recipes[0]
    if (r.capacityPerMinute === null || r.capacityPerMinute <= 0 || !recipe) continue
    const arriving = r.arrivals.reduce((sum, a) => sum + a.rate, 0) * 60
    const utilization = arriving / r.capacityPerMinute
    // 同じなら先にたどった方（物の入口に近い方）
    if (bottleneck && utilization <= bottleneck.utilization * (1 + 1e-9)) continue
    bottleneck = {
      pos: [r.pos[0], r.pos[1], r.pos[2]],
      machine: RECIPE_MACHINE_NAMES[recipe.type],
      arrivingPerMinute: arriving,
      capacityPerMinute: r.capacityPerMinute,
      utilization,
    }
  }
  return { inputPerMinute: inputRate * 60, outputPerMinute: output * 60, bottleneck, source: weakest(sources) }
}

/** 計算結果のまとめの「生産ライン」の行 */
export function lineSummary(line: LineFlow): CalcSummaryItem {
  const input = `入る ${formatRate(line.inputPerMinute)} 個/分`
  const output = `出る ${formatRate(line.outputPerMinute)} 個/分`
  const b = line.bottleneck
  if (!b) return { label: '生産ライン', value: resolved(`${input} → ${output}。処理する機械がない`, line.source) }
  const percent = `${formatRate(b.utilization * 100)}%`
  const over = b.utilization > 1 + 1e-9
  const middle = `律速 ${b.machine} ${formatRate(b.capacityPerMinute)} 個/分のうち ${formatRate(b.arrivingPerMinute)} 個/分（${percent}${over ? '、追いつかない' : ''}）`
  const more = over || b.utilization <= 0 ? '' : `。入る数は ${formatRate(line.inputPerMinute / b.utilization)} 個/分まで増やせる`
  return {
    label: '生産ライン',
    value: resolved(`${input} → ${middle} → ${output}${more}`, line.source),
    pos: [b.pos[0], b.pos[1], b.pos[2]],
  }
}

/** 律速の機械のプローブの値 */
export function bottleneckValue(line: LineFlow): CalcSummaryItem | null {
  const b = line.bottleneck
  if (!b) return null
  const over = b.utilization > 1 + 1e-9
  return {
    label: '律速',
    value: resolved(
      `生産ラインで一番忙しい機械。使用率 ${formatRate(b.utilization * 100)}%${over ? '（追いつかない）' : ''}`,
      line.source,
    ),
  }
}

class ItemTracer {
  private readonly records = new Map<string, ItemPathRecord>()
  private readonly arms: ArmInfo[]
  /** いまたどっている道の上の「位置|物」。同じものにまた届いたら輪になっている */
  private readonly ancestors = new Set<string>()
  private steps = 0
  /** たどった物の入口の数の合計（個/秒） */
  private inputRate = 0

  constructor(private readonly env: ItemPathEnv) {
    this.arms = findArms(env.bp)
  }

  tracePort(pos: Vec3, face: Direction, flow: Flow): void {
    this.steps = 0
    this.ancestors.clear()
    if (!this.env.bp.get(pos)) {
      this.env.log.add('物の入口の先にブロックがないので、物の通り道をたどらない', pos)
      return
    }
    this.inputRate += flow.rate
    this.deliver(pos, flow, null, face)
  }

  result(): ItemPathResult {
    const records = [...this.records.values()]
    const issues: CalcIssue[] = []
    for (const r of records) {
      if (r.capacityPerMinute === null) continue
      const perMinute = r.arrivals.reduce((sum, a) => sum + a.rate, 0) * 60
      if (perMinute > r.capacityPerMinute * (1 + 1e-9)) {
        issues.push({
          pos: [r.pos[0], r.pos[1], r.pos[2]],
          message: `処理が追いつきません。届く数は ${formatRate(perMinute)} 個/分、処理できるのは ${formatRate(r.capacityPerMinute)} 個/分です。入る数を減らすか、回転数を上げてください。`,
        })
      }
    }
    const byKey = this.records
    return {
      records,
      issues,
      line: lineFlow(records, this.inputRate),
      itemsAt(pos: Vec3): string[] {
        const r = byKey.get(posKey(pos))
        return r ? [...new Set(r.arrivals.map((a) => a.item))] : []
      },
    }
  }

  // ---- 受け取る ----

  /** pos のブロックに物が届く。face は受け取る面（null は入れ物に直接入れる） */
  private deliver(pos: Vec3, flow: Flow, from: Vec3 | null, face: Direction | null): void {
    if (flow.rate <= EPSILON) return
    const state = this.env.bp.get(pos)
    if (!state) return
    const key = `${posKey(pos)}|${flow.item}`
    if (this.ancestors.has(key)) {
      this.env.log.add('物の通り道が輪になっているので、同じ物が2回目に届いた所から先はたどらない', pos)
      return
    }
    if (++this.steps > MAX_PATH_STEPS) {
      this.env.log.add(`物の通り道が長いので、${MAX_PATH_STEPS} か所でたどるのをやめた`)
      return
    }
    this.ancestors.add(key)
    try {
      this.receive(pos, state, flow, from, face)
    } finally {
      this.ancestors.delete(key)
    }
  }

  private receive(pos: Vec3, state: BlockState, flow: Flow, from: Vec3 | null, face: Direction | null): void {
    const id = state.id.toString()
    switch (id) {
      case 'create:belt':
        return this.belt(pos, state, flow, from)
      case 'create:depot':
        return this.depot(pos, flow, from)
      case 'create:chute':
      case 'create:smart_chute':
        return this.chute(pos, state, flow, from, face)
      case 'create:millstone':
        return this.millstone(pos, flow, from)
      case 'create:crushing_wheel_controller':
        return this.crusher(pos, state, flow, from, face)
      case 'create:mechanical_saw':
        return this.saw(pos, state, flow, from)
      case 'create:basin':
        return this.basin(pos, state, flow, from)
      case 'create:andesite_funnel':
      case 'create:brass_funnel':
        return this.funnel(pos, state, flow, from, face)
      default:
        if (state.id.namespace === 'create' && !CREATE_INVENTORIES.has(id)) {
          // トンネル・イジェクター・扇風機など、この版で扱わないブロック（「扱わないもの」）
          this.arrive(pos, flow, from)
          this.stop(pos, `${id} に届いた物の行き先は扱わないので、物はここで止まるとした`, true)
          return
        }
        return this.inventory(pos, id, flow, from)
    }
  }

  /** ベルト。進む向きに、つながったベルトの端まで進む */
  private belt(pos: Vec3, state: BlockState, flow: Flow, from: Vec3 | null): void {
    this.arrive(pos, flow, from)
    const slope = state.properties.slope ?? 'horizontal'
    const facing = horizontalFacing(state)
    if (!facing || !BELT_SLOPES.has(slope)) {
      this.stop(pos, '縦・横向きのベルトは扱わないので、物はここで止まるとした', true)
      return
    }
    const rpm = this.env.rpmAt(pos) ?? 0
    if (rpm === 0) {
      this.stop(pos, '止まっているので、物はここで止まる')
      return
    }
    // 進む向きは facing の軸の上で、(回転数 < 0) XOR (軸が X) なら負の向き
    const axis = directionAxis(facing)
    const [positive, negative] = axisDirections(axis)
    const move = rpm < 0 !== (axis === 'x') ? negative : positive
    this.walkBelt(this.beltSegments(pos, state, move), 0, flow, move)
  }

  /** ベルトの区間 start から先を進む。ベルトのファンネル・2段上の機械・端の先 */
  private walkBelt(segments: readonly Vec3[], start: number, flow: Flow, move: Direction): void {
    for (let i = start; i < segments.length; i++) {
      const seg = segments[i]!
      const funnel = this.beltFunnelTaking(seg, move)
      if (funnel) {
        this.handOff(funnel.from, funnel.to, flow, null, funnel.via)
        return
      }
      if ((this.env.bp.get(seg)?.properties.slope ?? 'horizontal') !== 'horizontal') continue
      const result = this.processAbove(seg, flow)
      if (result === null) return
      if (result !== 'pass') {
        for (const out of result) this.walkBelt(segments, i + 1, out, move)
        return
      }
    }
    // 端の1つ先（高さは端の区間と同じ）
    const end = segments[segments.length - 1]!
    this.handOff(end, addVec3(end, directionVector(move)), flow, oppositeDirection(move), null)
  }

  /** entry から move の向きに、つながったベルトの区間（entry を含む） */
  private beltSegments(entry: Vec3, state: BlockState, move: Direction): Vec3[] {
    const segments: Vec3[] = [entry]
    let cur = entry
    let curState = state
    for (let n = 0; n < MAX_PATH_STEPS; n++) {
      const next = this.nextBelt(cur, curState, move)
      if (!next || segments.some((s) => equalsVec3(s, next))) break
      segments.push(next)
      cur = next
      curState = this.env.bp.get(next)!
    }
    return segments
  }

  /** ベルトの区間 pos から move の向きの次の区間。端なら null */
  private nextBelt(pos: Vec3, state: BlockState, move: Direction): Vec3 | null {
    const facing = horizontalFacing(state)
    if (!facing) return null
    const isBelt = (p: Vec3): BlockState | null => {
      const s = this.env.bp.get(p)
      return s && s.id.toString() === 'create:belt' && s.properties.facing === facing ? s : null
    }
    if (move === facing) {
      if (state.properties.part === 'end') return null
      const next = nextBeltSegment(pos, state)
      return next && isBelt(next) ? next : null
    }
    if (state.properties.part === 'start') return null
    // 前の区間は、次の区間が pos になるベルト
    const back = addVec3(pos, directionVector(oppositeDirection(facing)))
    for (const dy of [0, -1, 1]) {
      const cand = addVec3(back, [0, dy, 0])
      const s = isBelt(cand)
      const next = s ? nextBeltSegment(cand, s) : null
      if (next && equalsVec3(next, pos)) return cand
    }
    return null
  }

  /**
   * ベルトの区間の1段上の、下を通る物を取り込むベルトのファンネル。`shape=pulling`、
   * または押し出さない形で `facing` が進む向きの逆なら取り込み、`facing` の反対側の入れ物に入れる
   */
  private beltFunnelTaking(seg: Vec3, move: Direction): Destination | null {
    const f = addVec3(seg, [0, 1, 0])
    const s = this.env.bp.get(f)
    if (!s || !BELT_FUNNELS.has(s.id.toString()) || s.properties.powered === 'true') return null
    const facing = horizontalFacing(s)
    if (!facing) return null
    const shape = s.properties.shape
    if (shape !== 'pulling' && !(facing === oppositeDirection(move) && shape !== 'pushing')) return null
    return { to: addVec3(f, directionVector(oppositeDirection(facing))), face: null, via: f, from: seg }
  }

  /**
   * 2段上のプレス・デプロイヤー（ベルト・デポの上）。間の1段に当たり判定のあるブロックがあれば処理しない。
   * 当たり判定は調べられないので、空気とベルトのファンネル以外はすべて当たり判定があるとみなす。
   * プレスなら、できる物（レシピがなければ null）。デプロイヤー・機械なし・止まっているなら 'pass'（物は変わらない。
   * ゲームでも、止まっている機械はベルトの上の物を処理せず通す）
   */
  private processAbove(base: Vec3, flow: Flow): Flow[] | null | 'pass' {
    const between = this.env.bp.get(addVec3(base, [0, 1, 0]))
    if (between && !BELT_FUNNELS.has(between.id.toString())) return 'pass'
    const mpos = addVec3(base, [0, 2, 0])
    const m = this.env.bp.get(mpos)
    const id = m?.id.toString()
    const isPress = id === 'create:mechanical_press'
    const isDeployer = id === 'create:deployer' && m?.properties.facing === 'down'
    if (!isPress && !isDeployer) return 'pass'
    const rpm = this.env.rpmAt(mpos) ?? 0
    if (rpm === 0) {
      this.note(mpos, '止まっているので、下を通る物を処理しない')
      return 'pass'
    }
    this.arrive(mpos, flow, base)
    if (isDeployer) {
      // デプロイヤーは物を変えず、通ったことだけ出す（手の物のレシピは扱わない）
      this.record(mpos).capacityPerMinute = machineCapacityPerMinute('deployer', rpm, 0, this.env.bulkPressing)
      return 'pass'
    }
    return this.process(mpos, 'pressing', flow, 'mechanical_press', rpm)
  }

  /** デポ。2段上のプレス・デプロイヤーで処理し、1段上の pulling のベルトのファンネル・取り出すファンネル・機械アームで先へ */
  private depot(pos: Vec3, flow: Flow, from: Vec3 | null): void {
    this.arrive(pos, flow, from)
    const result = this.processAbove(pos, flow)
    if (result === null) return
    for (const out of result === 'pass' ? [flow] : result) this.emit(pos, out, { beltFunnelAbove: true })
  }

  /** シュート。上から受け取り、真下（斜めなら pos.below().relative(facing の反対)）へ */
  private chute(pos: Vec3, state: BlockState, flow: Flow, from: Vec3 | null, face: Direction | null): void {
    if (face !== null && face !== 'up') {
      this.refuse(pos, 'シュートは上からしか受け取らないので、物はここで止まる')
      return
    }
    this.arrive(pos, flow, from)
    const fan = [1, -1].some((dy) => this.env.bp.get(addVec3(pos, [0, dy, 0]))?.id.toString() === 'create:encased_fan')
    if (fan) this.env.log.add('シュートに扇風機がつながっているが、物は下へ流れるとした', pos)
    const below = addVec3(pos, [0, -1, 0])
    const facing = state.properties.facing
    const target =
      facing && isDirection(facing) && directionAxis(facing) !== 'y'
        ? addVec3(below, directionVector(oppositeDirection(facing)))
        : below
    this.handOff(pos, target, fan ? { ...flow, source: 'assumed' } : flow, 'up', null)
  }

  /** 石臼。できた物は下のシュート・取り出すファンネル・機械アームで先へ */
  private millstone(pos: Vec3, flow: Flow, from: Vec3 | null): void {
    this.arrive(pos, flow, from)
    const rpm = this.env.rpmAt(pos) ?? 0
    if (rpm === 0) {
      this.stop(pos, '止まっているので、物はここで止まる')
      return
    }
    const outs = this.process(pos, 'milling', flow, 'millstone', rpm)
    for (const out of outs ?? []) this.emit(pos, out, { chuteBelow: true })
  }

  /** 粉砕ホイールの中心（facing=down）。上から受け取り、できた物は真下へ */
  private crusher(pos: Vec3, state: BlockState, flow: Flow, from: Vec3 | null, face: Direction | null): void {
    if (state.properties.facing !== undefined && state.properties.facing !== 'down') {
      this.arrive(pos, flow, from)
      this.stop(pos, '横向きの粉砕ホイール（ベルトの上の粉砕）は扱わないので、物はここで止まるとした', true)
      return
    }
    if (face !== null && face !== 'up') {
      this.refuse(pos, '粉砕ホイールは上からしか受け取らないので、物はここで止まる')
      return
    }
    this.arrive(pos, flow, from)
    // 回転数は、隣の粉砕ホイールのもの。どれかが止まっていれば処理しない
    const wheels = HORIZONTAL_OFFSETS.map((d) => addVec3(pos, d)).filter(
      (p) => this.env.bp.get(p)?.id.toString() === 'create:crushing_wheel',
    )
    const speeds = wheels.map((p) => Math.abs(this.env.rpmAt(p) ?? 0))
    const rpm = speeds.length > 0 ? Math.min(...speeds) : 0
    if (rpm === 0) {
      this.stop(pos, '粉砕ホイールが止まっているので、物はここで止まる')
      return
    }
    const outs = this.process(pos, 'crushing', flow, 'crushing_wheel', rpm)
    for (const out of outs ?? []) this.handOff(pos, addVec3(pos, [0, -1, 0]), out, 'up', null)
  }

  /**
   * ソー（facing=up）。できた物は、回転軸が Z（axis_along_first=false）なら回転数 > 0 で +X、
   * 軸が X なら回転数 > 0 で −Z の隣へ。プロパティの名前は Create のコードの `axis_along_first`
   */
  private saw(pos: Vec3, state: BlockState, flow: Flow, from: Vec3 | null): void {
    this.arrive(pos, flow, from)
    if (state.properties.facing !== 'up') {
      this.stop(pos, '上向きでないソーは扱わないので、物はここで止まるとした', true)
      return
    }
    const rpm = this.env.rpmAt(pos) ?? 0
    if (rpm === 0) {
      this.stop(pos, '止まっているので、物はここで止まる')
      return
    }
    const outs = this.process(pos, 'cutting', flow, 'mechanical_saw', rpm)
    const alongX = state.properties.axis_along_first === 'true'
    const dir: Direction = alongX ? (rpm > 0 ? 'north' : 'south') : rpm > 0 ? 'east' : 'west'
    for (const out of outs ?? []) this.handOff(pos, addVec3(pos, directionVector(dir)), out, oppositeDirection(dir), null)
  }

  /** ベイスン。2段上がミキサーなら mixing、プレスなら compacting */
  private basin(pos: Vec3, state: BlockState, flow: Flow, from: Vec3 | null): void {
    this.arrive(pos, flow, from)
    const mpos = addVec3(pos, [0, 2, 0])
    const mid = this.env.bp.get(mpos)?.id.toString()
    const type: ProcessingRecipeType | null =
      mid === 'create:mechanical_mixer' ? 'mixing' : mid === 'create:mechanical_press' ? 'compacting' : null
    if (type === null) {
      // 処理する機械がなければ、ただの入れ物
      this.basinOutput(pos, state, flow)
      return
    }
    const rpm = this.env.rpmAt(mpos) ?? 0
    if (rpm === 0) {
      this.stop(pos, '上の機械が止まっているので、物はここで止まる')
      return
    }
    const outs = this.process(pos, type, flow, type === 'mixing' ? 'mechanical_mixer' : 'mechanical_press', rpm)
    for (const out of outs ?? []) this.basinOutput(pos, state, out)
  }

  /**
   * ベイスンが出す先。`facing` が水平なら pos.relative(facing).below()、down なら取り出すファンネル・機械アーム・下のシュート。
   * 水平で出す先が空気なら、ゲームでは出せずにベイスンに残るので、溜まる物とする
   */
  private basinOutput(pos: Vec3, state: BlockState, flow: Flow): void {
    const facing = horizontalFacing(state)
    if (!facing) {
      this.emit(pos, flow, { chuteBelow: true })
      return
    }
    const target = addVec3(addVec3(pos, directionVector(facing)), [0, -1, 0])
    if (!this.env.bp.get(target)) {
      this.env.log.add('ベイスンの出す先に入れ物がないので、できた物はベイスンに溜まるとした', pos)
      this.sink(pos, { ...flow, source: 'assumed' })
      return
    }
    this.deliver(target, flow, pos, null)
  }

  /** ファンネル。入れるファンネルは口の前から受け取り、facing の反対側の入れ物に入れる */
  private funnel(pos: Vec3, state: BlockState, flow: Flow, from: Vec3 | null, face: Direction | null): void {
    const facing = state.properties.facing
    if (!facing || !isDirection(facing)) {
      this.refuse(pos, 'ファンネルの向きが分からないので、物はここで止まる')
      return
    }
    if (state.properties.extracting === 'true') {
      this.refuse(pos, '取り出すファンネルは物を受け取らないので、物はここで止まる')
      return
    }
    if (face !== null && face !== facing) {
      this.refuse(pos, 'ファンネルは口の前からしか受け取らないので、物はここで止まる')
      return
    }
    if (state.properties.powered === 'true') {
      this.refuse(pos, 'ファンネルにレッドストーンの信号が入っていて動かないので、物はここで止まる')
      return
    }
    this.arrive(pos, flow, from)
    const container = addVec3(pos, directionVector(oppositeDirection(facing)))
    if (!this.env.bp.get(container)) {
      this.stop(pos, 'ファンネルの後ろに入れ物がないので、物はここで止まる')
      return
    }
    this.deliver(container, flow, pos, null)
  }

  /** ほかのブロック（チェストなど）。入れ物とみなし、取り出すファンネルと機械アームで先へ */
  private inventory(pos: Vec3, id: string, flow: Flow, from: Vec3 | null): void {
    this.arrive(pos, flow, from)
    if (!this.env.bp.blockEntityAt(pos)) this.env.log.add(`${id} を物の入れ物とみなした`, pos)
    this.emit(pos, flow, {})
  }

  // ---- 出す ----

  /**
   * 入れ物・機械から先へ出す。取り出すファンネル、TAKE の点がここの機械アーム、
   * chuteBelow なら下のシュート、beltFunnelAbove なら1段上の pulling のベルトのファンネル。
   * 行き先が2つ以上なら数を等しく分け、どれもなければ溜まる
   */
  private emit(pos: Vec3, flow: Flow, opts: { chuteBelow?: boolean; beltFunnelAbove?: boolean }): void {
    const dests: Destination[] = []
    const bp = this.env.bp
    if (opts.chuteBelow) {
      const below = addVec3(pos, [0, -1, 0])
      const id = bp.get(below)?.id.toString()
      if (id === 'create:chute' || id === 'create:smart_chute') dests.push({ to: below, face: 'up', via: null, from: pos })
    }
    if (opts.beltFunnelAbove) {
      const f = addVec3(pos, [0, 1, 0])
      const s = bp.get(f)
      const facing = s ? horizontalFacing(s) : null
      if (s && facing && BELT_FUNNELS.has(s.id.toString()) && s.properties.shape === 'pulling' && s.properties.powered !== 'true') {
        dests.push({ to: addVec3(f, directionVector(oppositeDirection(facing))), face: null, via: f, from: f })
      }
    }
    // 取り出すファンネル（facing の反対側がここ。powered=false）
    for (const d of ALL_OFFSETS) {
      const n = addVec3(pos, d)
      const s = bp.get(n)
      if (!s || !FUNNELS.has(s.id.toString()) || s.properties.extracting !== 'true' || s.properties.powered === 'true') continue
      const facing = s.properties.facing
      if (!facing || !isDirection(facing)) continue
      if (!equalsVec3(addVec3(n, directionVector(oppositeDirection(facing))), pos)) continue
      dests.push({ to: addVec3(n, directionVector(facing)), face: oppositeDirection(facing), via: n, from: n })
    }
    // 機械アーム：TAKE の点がここなら、すべての DEPOSIT の点へ
    for (const arm of this.arms) {
      if (!arm.take.some((t) => equalsVec3(t, pos)) || arm.deposit.length === 0) continue
      if ((this.env.rpmAt(arm.pos) ?? 0) === 0) {
        this.note(arm.pos, '止まっているので、物を運ばない')
        continue
      }
      for (const dep of arm.deposit) dests.push({ to: dep, face: null, via: arm.pos, from: arm.pos })
    }
    if (dests.length === 0) {
      this.sink(pos, flow)
      return
    }
    const share: Flow = { ...flow, rate: flow.rate / dests.length }
    for (const d of dests) {
      if (d.via) this.arrive(d.via, share, pos)
      this.handOff(d.from, d.to, share, d.face, null)
    }
  }

  /**
   * from から target へ渡す。target が空気なら、その下（3段まで）の最初のブロックに落ちるとして仮定に載せる。
   * via は間のファンネル（届く物として記録する）
   */
  private handOff(from: Vec3, target: Vec3, flow: Flow, face: Direction | null, via: Vec3 | null): void {
    const bp = this.env.bp
    if (via) this.arrive(via, flow, from)
    const src = via ?? from
    if (!bp.locate(target)) {
      this.env.log.add('物が設計図の外に出るので、その先はたどらない', src)
      return
    }
    if (bp.get(target)) {
      this.deliver(target, flow, src, face)
      return
    }
    for (let dy = 1; dy <= FALL_DEPTH; dy++) {
      const below = addVec3(target, [0, -dy, 0])
      if (!bp.locate(below)) break
      if (bp.get(below)) {
        this.env.log.add(`出す先（${posText(target)}）が空気なので、物は下の ${posText(below)} に落ちるとした`, src)
        this.deliver(below, { ...flow, source: 'assumed' }, src, 'up')
        return
      }
    }
    this.env.log.add(`出す先（${posText(target)}）が空気で、${FALL_DEPTH} 段下までにブロックがないので、その先はたどらない`, src)
  }

  // ---- レシピ ----

  /**
   * 機械でレシピを当てて、できる物を返す（数は 個数 × 確率 を掛ける）。レシピがなければ null（そこで止める）。
   * 材料が2つ以上のレシピは、届いた物の1個ごとに1回とし、ほかの材料はあるものとして仮定に載せる
   */
  private process(pos: Vec3, type: ProcessingRecipeType, flow: Flow, machine: string, rpm: number): Flow[] | null {
    const book = this.env.recipes
    const choice = chooseRecipe(type, [flow.item], book)
    const rec = this.record(pos)
    if (book?.scriptsChangeRecipes) {
      this.env.log.add('KubeJS のスクリプトがレシピを変えているが、スクリプトのレシピは読めないので、物の通り道に入れていない')
    }
    const recipe = choice.recipe
    if (!recipe) {
      if (!rec.noRecipe.includes(flow.item)) rec.noRecipe.push(flow.item)
      if (!book) rec.recipesUnknown = true
      if (!book) this.env.log.add('Modpack のレシピがないので、機械でできる物が分からず、物の通り道は機械で止まる')
      return null
    }
    if (choice.assumption) this.env.log.add(choice.assumption, pos)
    if (recipe.items.length + recipe.tags.length > 1) {
      this.env.log.add(`レシピ ${recipe.id} のほかの材料は、あるものとした`, pos)
    }
    rec.capacityPerMinute = machineCapacityPerMinute(machine, rpm, choice.duration.value, this.env.bulkPressing)
    const source = weakerSource(flow.source, choice.duration.source)
    // 処理できる数を超えた分は処理されない（機械の前で詰まる）。できる物は処理できた数から計算する
    const capacityPerSecond = rec.capacityPerMinute === null ? Infinity : rec.capacityPerMinute / 60
    const processed = Math.max(0, Math.min(flow.rate, capacityPerSecond - rec.processedRate))
    rec.processedRate += processed
    if (processed <= EPSILON) return null
    // 同じ物が2つの結果に出るレシピ（小麦 → 小麦粉 と 小麦粉（25%））は、まとめて1つの流れにする
    const outs: ItemOutput[] = []
    for (const r of recipe.results) addOutput(outs, { item: r.item, rate: processed * r.count * r.chance, source })
    outs.splice(0, outs.length, ...outs.filter((o) => o.rate > EPSILON))
    const existing = rec.recipes.find((a) => a.choice.recipe?.id === recipe.id && a.input === flow.item)
    if (existing) {
      for (const o of outs) addOutput(existing.outputs, o)
    } else {
      rec.recipes.push({ type, input: flow.item, choice, outputs: outs.map((o) => ({ ...o })) })
    }
    if (outs.length === 0) {
      this.stop(pos, `レシピ ${recipe.id} にできる物がないので、物はここで止まる`)
      return null
    }
    return outs
  }

  // ---- 記録 ----

  private record(pos: Vec3): ItemPathRecord {
    const key = posKey(pos)
    let r = this.records.get(key)
    if (!r) {
      r = { pos: [pos[0], pos[1], pos[2]], arrivals: [], recipes: [], sinks: [], noRecipe: [], recipesUnknown: false, notes: [], capacityPerMinute: null, processedRate: 0 }
      this.records.set(key, r)
    }
    return r
  }

  private arrive(pos: Vec3, flow: Flow, from: Vec3 | null): void {
    const list = this.record(pos).arrivals
    const i = list.findIndex(
      (a) => a.item === flow.item && (a.from === null ? from === null : from !== null && equalsVec3(a.from, from)),
    )
    if (i < 0) {
      list.push({ item: flow.item, rate: flow.rate, from: from ? [from[0], from[1], from[2]] : null, source: flow.source })
      return
    }
    const a = list[i]!
    list[i] = { ...a, rate: a.rate + flow.rate, source: weakerSource(a.source, flow.source) }
  }

  private sink(pos: Vec3, flow: Flow): void {
    addOutput(this.record(pos).sinks, flow)
  }

  private note(pos: Vec3, message: string): void {
    const notes = this.record(pos).notes
    if (!notes.includes(message)) notes.push(message)
  }

  /** そこで止める。assume なら仮定にも載せる */
  private stop(pos: Vec3, message: string, assume = false): void {
    this.note(pos, message)
    if (assume) this.env.log.add(message, pos)
  }

  /** 受け取らない。届く物は記録しない */
  private refuse(pos: Vec3, message: string): void {
    this.env.log.add(message, pos)
  }
}

function addOutput(list: ItemOutput[], flow: ItemOutput): void {
  const i = list.findIndex((o) => o.item === flow.item)
  if (i < 0) {
    list.push({ item: flow.item, rate: flow.rate, source: flow.source })
    return
  }
  const o = list[i]!
  list[i] = { item: o.item, rate: o.rate + flow.rate, source: weakerSource(o.source, flow.source) }
}

/** 設計図の中の機械アームと、生データの InteractionPoints（Pos はアームからの相対座標、Mode は TAKE・DEPOSIT） */
function findArms(bp: Blueprint): ArmInfo[] {
  const arms: ArmInfo[] = []
  bp.regions.forEach((region) => {
    const [ox, oy, oz] = region.offset
    region.forEachBlock((x, y, z, state) => {
      if (state.id.toString() !== 'create:mechanical_arm') return
      const pos: Vec3 = [x + ox, y + oy, z + oz]
      const tag = bp.blockEntityAt(pos)?.value.get('InteractionPoints')
      const take: Vec3[] = []
      const deposit: Vec3[] = []
      if (tag?.type === 'list') {
        for (const point of tag.value) {
          if (point.type !== 'compound') continue
          const rel = nbtPos(point, 'Pos')
          if (!rel) continue
          const mode = nbtString(point, 'Mode')
          if (mode === 'TAKE') take.push(addVec3(pos, rel))
          else if (mode === 'DEPOSIT') deposit.push(addVec3(pos, rel))
        }
      }
      arms.push({ pos, take, deposit })
    })
  })
  return arms
}

// ---- プローブ ----

/** 位置ごとの記録から、プローブの値（「届く物」「レシピ」「溜まる物」「物の通り道」）を作る */
export function itemPathValues(record: ItemPathRecord): CalcSummaryItem[] {
  const values: CalcSummaryItem[] = []
  if (record.arrivals.length > 0) {
    values.push({
      label: '届く物',
      value: resolved(
        record.arrivals.map((a) => `${a.item} ${formatRate(a.rate)} 個/秒（${a.from ? posText(a.from) : '物の入口'}から）`).join('、'),
        weakest(record.arrivals.map((a) => a.source)),
      ),
    })
  }
  if (record.recipes.length > 0) {
    values.push({
      label: 'レシピ',
      value: resolved(
        record.recipes
          .map((r) => {
            const outs = r.outputs.map((o) => `${o.item} ${formatRate(o.rate)} 個/秒`).join('、')
            return `${r.choice.recipe?.id ?? ''}（${r.input} → ${outs || 'できる物なし'}）`
          })
          .join('、'),
        weakest(record.recipes.flatMap((r) => [weakerSource('virtual', r.choice.duration.source), ...r.outputs.map((o) => o.source)])),
      ),
    })
  } else if (record.noRecipe.length > 0) {
    const items = record.noRecipe.join('、')
    const text = record.recipesUnknown
      ? `Modpack を読んでいないので、レシピが分からない（${items}）。上のバーで Modpack を選ぶと、できる物をたどる`
      : `Modpack にこの物のレシピがない（${items}）`
    values.push({ label: 'レシピ', value: resolved(text, 'virtual') })
  }
  if (record.sinks.length > 0) {
    values.push({
      label: '溜まる物',
      value: resolved(
        record.sinks.map((s) => `${s.item} ${formatRate(s.rate)} 個/秒`).join('、'),
        weakest(record.sinks.map((s) => s.source)),
      ),
    })
  }
  if (record.notes.length > 0) {
    values.push({ label: '物の通り道', value: resolved(record.notes.join('。'), 'virtual') })
  }
  return values
}

function weakest(sources: readonly Provenance[]): Provenance {
  return sources.reduce<Provenance>((a, b) => weakerSource(a, b), 'virtual')
}

// ---- 小さな関数 ----

const BELT_SLOPES = new Set(['horizontal', 'upward', 'downward'])
const FUNNELS = new Set(['create:andesite_funnel', 'create:brass_funnel'])
const BELT_FUNNELS = new Set(['create:andesite_belt_funnel', 'create:brass_belt_funnel'])
/** Create のブロックのうち、ただの入れ物とみなすもの */
const CREATE_INVENTORIES = new Set(['create:item_vault'])

const ALL_OFFSETS: readonly Vec3[] = [
  [0, -1, 0],
  [0, 1, 0],
  [0, 0, -1],
  [0, 0, 1],
  [-1, 0, 0],
  [1, 0, 0],
]
const HORIZONTAL_OFFSETS: readonly Vec3[] = [
  [0, 0, -1],
  [0, 0, 1],
  [-1, 0, 0],
  [1, 0, 0],
]

function horizontalFacing(state: BlockState): Direction | null {
  const f = state.properties.facing
  return f && isDirection(f) && directionAxis(f) !== 'y' ? f : null
}

function posKey(p: Vec3): string {
  return `${p[0]},${p[1]},${p[2]}`
}

/** 「(1, 2, 3)」 */
function posText(p: Vec3): string {
  return `(${p[0]}, ${p[1]}, ${p[2]})`
}
