// Create の輸送量と処理時間（docs/create-throughput.md）。
// 前半は回転数などから tick を数える純粋な関数、後半はブロック1つ分のプローブの値を作る関数。
// 回転数は応力の計算（kineticGraph.ts）の結果を使う。

import type { Blueprint } from '../../domain/blueprint'
import type { NbtTag, RawNbt } from '../../domain/nbt'
import type { Vec3 } from '../../domain/vec3'
import type { ProcessingRecipe, ProcessingRecipeType, RecipeBook } from '../../io/modpack/recipes'
import type { AssumptionLog } from '../assumptionLog'
import type { CalcSummaryItem } from '../calcPlugin'
import { nbtNumber } from '../nbtValues'
import { resolved, type Provenance, type Resolved } from '../provenance'
import type { CreateValueResolver } from './createValueResolver'
import { formatNumber, weakerSource } from './kineticGraph'

/** 1秒の tick 数 */
export const TICKS_PER_SECOND = 20
/** 1つの山の最大の個数 */
export const STACK_SIZE = 64
/** シュートを重力で落ちる速さ（マス/秒） */
export const CHUTE_GRAVITY_SPEED = 4
/** プレスの1回の動き（PressingBehaviour.CYCLE） */
export const PRESS_CYCLE = 240
/** ミキサーの、下ろす・上げる動きの tick */
export const MIXER_MOVE_TICKS = 20
/** デプロイヤーの、伸びる・縮む・待つ量 */
const DEPLOYER_EXTEND = 1000
const DEPLOYER_WAIT = 500
/** 機械アームが1回の移動で進む量（chasedPointProgress が 1 で着く） */
const ARM_MOVE = 1024

/** レシピが分からないときの処理時間（Create のコードの初期値。ミキサーは r = 1 になる 100） */
export const DEFAULT_RECIPE_DURATION: Readonly<Record<ProcessingRecipeType, number>> = {
  milling: 100,
  crushing: 100,
  cutting: 50,
  mixing: 100,
  // プレスは処理時間を使わない（押す動きの速さだけで決まる）
  pressing: 0,
  compacting: 0,
}

/** 機械の名前（仮定の文と、律速の機械の名前に使う） */
export const RECIPE_MACHINE_NAMES: Readonly<Record<ProcessingRecipeType, string>> = {
  milling: '石臼',
  crushing: '粉砕ホイール',
  cutting: 'ソー',
  mixing: 'ミキサー',
  pressing: 'プレス',
  compacting: 'プレス（圧縮）',
}

// ---- 計算（純粋な関数）。回転数が 0 なら null（動かない） ----

/** ベルトの速さ（ブロック/秒）。1 tick に |rpm| / 480 ブロック */
export function beltSpeed(rpm: number): number {
  return Math.abs(rpm) / 24
}

/**
 * 機械アームの1往復の tick。移動2回と、置く先・取る先を探す2回。探す間も進み具合が 1 に着くまで待つので、
 * 移動1回分（N tick）ずつかかる。置く先を探すのは、11 tick ごとの見直しで N/2 で終わることもある（短くて 3.5N）。ここでは長い方の 4N
 */
export function armRoundTripTicks(rpm: number): number | null {
  const step = Math.min(256, Math.abs(rpm))
  if (step === 0) return null
  return 4 * ceil(ARM_MOVE / step)
}

/** ファンネルの輸送量の上限（個/秒） */
export function funnelItemsPerSecond(amount: number, timer: number): number {
  return (amount * TICKS_PER_SECOND) / Math.max(1, timer)
}

/** プレスが1 tick に進む量 */
export function pressTickSpeed(rpm: number): number {
  const s = Math.abs(rpm)
  if (s === 0) return 0
  return Math.floor(1 + (60 - 1) * Math.min(s / 512, 1))
}

/** プレスの1回の tick */
export function pressCycleTicks(rpm: number): number | null {
  const v = pressTickSpeed(rpm)
  return v === 0 ? null : Math.ceil(PRESS_CYCLE / v)
}

/** ミキサーの混ぜる時間 P（tick）。duration はレシピの処理時間（0 なら r = 1） */
export function mixerMixingTicks(rpm: number, duration: number): number | null {
  const speed = Math.floor(Math.abs(rpm))
  if (speed === 0) return null
  const r = duration > 0 ? duration / 100 : 1
  const p = floorLog2(Math.floor(512 / speed)) * Math.ceil(r * 15) + 1
  return clamp(p, 1, 512)
}

/** ミキサーの1回の tick（下ろす + 混ぜる + 上げる） */
export function mixerCycleTicks(rpm: number, duration: number): number | null {
  const p = mixerMixingTicks(rpm, duration)
  return p === null ? null : MIXER_MOVE_TICKS + p + MIXER_MOVE_TICKS
}

/** 石臼が1個にかける tick */
export function millstoneTicks(rpm: number, duration: number): number | null {
  if (Math.abs(rpm) === 0) return null
  const step = clamp(Math.floor(Math.abs(rpm) / 16), 1, 512)
  return Math.max(1, Math.ceil(duration / step))
}

/** 粉砕ホイールが count 個のスタックを処理して外に出すまでの tick（1 tick ずつ数える） */
export function crushingTicks(rpm: number, duration: number, count: number): number | null {
  const s = (Math.abs(rpm) / 50) * 4
  if (s === 0) return null
  const log = floorLog2(Math.max(1, count))
  // log2(1) = 0 で割ると無限大になり、上限の 20 に切られる（Create と同じ）
  const before = clamp(log === 0 ? Infinity : s / log, 0.25, 20)
  const after = clamp(s, 0.25, 20)
  let remaining = duration
  let ticks = 0
  while (remaining >= 20) {
    remaining -= before
    ticks++
  }
  // 20 を切った tick に結果ができる。残りが 0 以下になったら次の tick から外に出す
  if (ticks === 0) {
    remaining -= before
    ticks++
  }
  do {
    remaining -= after
    ticks++
  } while (remaining > 0)
  return ticks
}

/** ソーが count 個のスタックを処理し終えるまでの tick */
export function sawTicks(rpm: number, duration: number, count: number): number | null {
  if (Math.abs(rpm) === 0) return null
  const step = clamp(Math.abs(rpm) / 24, 1, 128)
  let remaining = duration * Math.max(1, Math.floor(count / 5))
  let ticks = 0
  do {
    remaining -= step
    ticks++
  } while (remaining >= 5)
  remaining = 20
  do {
    remaining -= step
    ticks++
  } while (remaining > 0)
  return ticks
}

/** デプロイヤーの1回の動作の tick（伸びる・縮む・待つ） */
export function deployerCycleTicks(rpm: number): number | null {
  if (Math.abs(rpm) === 0) return null
  const v = Math.floor(clamp(Math.abs(rpm) * 2, 8, 512))
  return 2 * Math.ceil(DEPLOYER_EXTEND / v) + Math.ceil(DEPLOYER_WAIT / v)
}

/**
 * 入れ物から取り出すときの、ファンネルの1回の数。安山岩はフィルターが使えないので 1 個。
 * 真鍮はフィルターの数（FilterAmount。0 ならスタックの上限）、なければ 64
 */
export function funnelAmount(path: string, be: RawNbt | null): Resolved<number> {
  if (path !== 'brass_funnel') return resolved(1, 'builtin')
  const amount = nbtNumber(be, 'FilterAmount')
  if (amount !== null && amount > 0) return resolved(Math.min(STACK_SIZE, amount), 'blueprint')
  return resolved(STACK_SIZE, 'builtin')
}

// ---- レシピ ----

/**
 * 生データの中のアイテム（文字列の `id` と個数 `Count` / `count` を持つ compound）の ID を集める。
 * 入れ物の項目名は機械ごとに違うので、全体を探す
 */
export function findItemIds(data: RawNbt | null): string[] {
  const ids: string[] = []
  const visit = (tag: NbtTag): void => {
    if (tag.type === 'compound') {
      const id = tag.value.get('id')
      const count = nbtNumber(tag, 'Count') ?? nbtNumber(tag, 'count')
      if (id?.type === 'string' && count !== null && count > 0 && id.value !== 'minecraft:air' && !ids.includes(id.value)) {
        ids.push(id.value)
      }
      tag.value.forEach(visit)
    } else if (tag.type === 'list') {
      tag.value.forEach(visit)
    }
  }
  if (data) visit(data)
  return ids
}

/** 使うレシピの処理時間 */
export interface RecipeChoice {
  /** 処理時間（tick）。Modpack のレシピなら 'modpack'、初期値なら 'assumed' */
  readonly duration: Resolved<number>
  /** プローブの「レシピ」の文 */
  readonly text: string
  /** 仮定に載せる文（初期値を使ったとき、材料に合うレシピが2つ以上あったとき）。なければ null */
  readonly assumption: string | null
  /** 使うレシピ。決まらなければ null */
  readonly recipe: ProcessingRecipe | null
  /** レシピを決めた材料（アイテムの ID）。決まらなければ null */
  readonly item: string | null
}

/** ミキサーのレシピの処理時間 0（書いていない）は 100（r = 1）として扱う */
export function effectiveDuration(type: ProcessingRecipeType, duration: number): number {
  return type === 'mixing' && duration <= 0 ? 100 : duration
}

/** アイテムがレシピの材料か。ID と、タグ（book.itemTags で平らにしたもの）の両方で照らす */
export function recipeAccepts(recipe: ProcessingRecipe, item: string, book: RecipeBook | null): boolean {
  if (recipe.items.includes(item)) return true
  return recipe.tags.some((tag) => book?.itemTags[tag]?.includes(item) ?? false)
}

/**
 * どのレシピか（docs/create-throughput.md「どのレシピか」）。
 * itemIds は、物の通り道で届く物（1）があればそれを、なければ生データの物（2）を、優先する順に渡す。
 * 材料はアイテムの ID とタグで照らす（3）。合うレシピが2つ以上あれば ID の名前順で最初のものを使い、仮定に載せる（4）。
 * 決まらなければ、その種類のレシピの範囲と初期値（5）。Modpack がなければ初期値だけ（6）
 */
export function chooseRecipe(type: ProcessingRecipeType, itemIds: readonly string[], book: RecipeBook | null): RecipeChoice {
  const recipes = book?.recipes.filter((r) => r.type === type) ?? []
  const name = RECIPE_MACHINE_NAMES[type]
  for (const item of itemIds) {
    const matches = recipes.filter((r) => recipeAccepts(r, item, book)).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    const match = matches[0]
    if (match) {
      const d = effectiveDuration(type, match.duration)
      return {
        duration: resolved(d, 'modpack', match.id),
        text: `${match.id}（${item}、処理時間 ${formatNumber(d)} tick）`,
        assumption:
          matches.length > 1
            ? `${name}の材料 ${item} に合うレシピが ${matches.length} つあるので、ID の名前順で最初の ${match.id} を使った`
            : null,
        recipe: match,
        item,
      }
    }
  }
  const fallback = DEFAULT_RECIPE_DURATION[type]
  let range = ''
  if (recipes.length > 0) {
    const durations = recipes.map((r) => effectiveDuration(type, r.duration))
    const min = Math.min(...durations)
    const max = Math.max(...durations)
    range = min === max ? `${formatNumber(min)} tick` : `${formatNumber(min)}〜${formatNumber(max)} tick`
  }
  const rangeText = range ? `。Modpack の${name}のレシピは ${range}` : ''
  return {
    duration: resolved(fallback, 'assumed'),
    text: `分からない。処理時間 ${formatNumber(fallback)} tick とした${rangeText}`,
    assumption: `${name}のレシピが分からないので、処理時間を Create の初期値の ${formatNumber(fallback)} tick とした${rangeText}`,
    recipe: null,
    item: null,
  }
}

/**
 * 機械が1分に処理できる個数（docs/create-throughput.md「機械の処理時間」）。物の通り道で「処理が追いつかない」を調べるのに使う。
 * 粉砕ホイール・ソーは、まとめて入れたときの方が速いので、上限として 64 個まとめての値を使う。
 * 機械でない・止まっているなら null
 */
export function machineCapacityPerMinute(path: string, rpm: number, duration: number, bulkPressing: boolean): number | null {
  const per = (ticks: number | null, count = 1): number | null => (ticks === null ? null : perMinuteOf(ticks) * count)
  switch (path) {
    case 'mechanical_press':
      return per(pressCycleTicks(rpm), bulkPressing ? STACK_SIZE : 1)
    case 'deployer':
      return per(deployerCycleTicks(rpm))
    case 'mechanical_mixer':
      return per(mixerCycleTicks(rpm, duration))
    case 'millstone':
      return per(millstoneTicks(rpm, duration))
    case 'crushing_wheel':
      return per(crushingTicks(rpm, duration, STACK_SIZE), STACK_SIZE)
    case 'mechanical_saw':
      return per(sawTicks(rpm, duration, STACK_SIZE), STACK_SIZE)
    default:
      return null
  }
}

// ---- プローブの値 ----

/** プローブの値を作るのに使うもの */
export interface ThroughputEnv {
  readonly bp: Blueprint
  readonly values: CreateValueResolver
  /** Modpack のレシピ。なければ null */
  readonly recipes: RecipeBook | null
  readonly log: AssumptionLog
  /**
   * 物の通り道（createItemPath.ts）でその位置に届く物。レシピを決めるとき、生データの物より優先する（「どのレシピか」の 1）。
   * 物の入口がなければ省略
   */
  readonly pathItems?: (pos: Vec3) => readonly string[]
}

/** 回るブロックの回転（止まっている・過負荷なら 0） */
export interface KineticInput {
  readonly rpm: number
  readonly source: Provenance
  /** 必要回転数。なければ 0 */
  readonly minSpeed: number
}

/** ブロックの名前（`create:` を外したもの）。Create のブロックでなければ null */
function createPath(id: string): string | null {
  return id.startsWith('create:') ? id.slice('create:'.length) : null
}

/** 回るブロックの輸送量・処理時間。関係しないブロックなら空 */
export function kineticThroughputValues(pos: Vec3, id: string, rotation: KineticInput, env: ThroughputEnv): CalcSummaryItem[] {
  const path = createPath(id)
  if (path === null || !KINETIC_THROUGHPUT_BLOCKS.has(path)) return []
  const rpm = rotation.rpm
  const be = env.bp.blockEntityAt(pos)
  const label = TRANSPORT_BLOCKS.has(path) ? '輸送量' : '処理時間'
  if (rpm === 0) return [{ label, value: resolved('止まっているので動かない', rotation.source) }]
  if (rotation.minSpeed > 0 && Math.abs(rpm) < rotation.minSpeed) {
    return [
      { label, value: resolved(`回転数が足りないので動かない（${formatNumber(rotation.minSpeed)} RPM 以上が必要）`, rotation.source) },
    ]
  }

  switch (path) {
    case 'belt': {
      const speed = beltSpeed(rpm)
      return [
        {
          label,
          value: resolved(
            `${formatNumber(speed)} ブロック/秒（1個ずつ ${formatRate(speed)} 個/秒、64 個ずつ ${formatRate(speed * STACK_SIZE)} 個/秒）`,
            rotation.source,
          ),
        },
      ]
    }
    case 'mechanical_arm': {
      const ticks = armRoundTripTicks(rpm)!
      const perSecond = TICKS_PER_SECOND / ticks
      return [
        {
          label,
          value: resolved(
            `1往復 ${seconds(ticks)} 秒（${ticks} tick）。1個ずつ ${formatRate(perSecond)} 個/秒、64 個ずつ ${formatRate(perSecond * STACK_SIZE)} 個/秒`,
            rotation.source,
          ),
        },
      ]
    }
    case 'mechanical_press': {
      const ticks = pressCycleTicks(rpm)!
      const bulk = env.values.bulkPressing()
      const unit = bulk.value ? '1スタック（最大 64 個）' : '1個'
      const perMinute = perMinuteOf(ticks) * (bulk.value ? STACK_SIZE : 1)
      return [
        {
          label,
          value: resolved(`${ticksText(ticks)}で${unit}。${formatRate(perMinute)} 個/分`, weakerSource(rotation.source, bulk.source)),
        },
      ]
    }
    case 'deployer': {
      const ticks = deployerCycleTicks(rpm)!
      return [{ label, value: resolved(`${ticksText(ticks)}で1回。${formatRate(perMinuteOf(ticks))} 回/分`, rotation.source) }]
    }
    case 'mechanical_mixer': {
      // レシピは2つ下のバサンの中身で決まる
      const basin = env.bp.blockEntityAt([pos[0], pos[1] - 2, pos[2]])
      const basinPos: Vec3 = [pos[0], pos[1] - 2, pos[2]]
      const recipe = recipeFor('mixing', itemsFor([basinPos], () => [...findItemIds(basin), ...findItemIds(be)], env), pos, env)
      const ticks = mixerCycleTicks(rpm, recipe.duration.value)!
      return [
        {
          label,
          value: resolved(
            `${ticksText(ticks)}で1回。${formatRate(perMinuteOf(ticks))} 回/分`,
            weakerSource(rotation.source, recipe.duration.source),
          ),
        },
        recipeItem(recipe),
      ]
    }
    case 'millstone': {
      const recipe = recipeFor('milling', itemsFor([pos], () => findItemIds(be), env), pos, env)
      const ticks = millstoneTicks(rpm, recipe.duration.value)!
      return [
        {
          label,
          value: resolved(
            `${ticksText(ticks)}で1個。${formatRate(perMinuteOf(ticks))} 個/分`,
            weakerSource(rotation.source, recipe.duration.source),
          ),
        },
        recipeItem(recipe),
      ]
    }
    case 'crushing_wheel': {
      // 中身は2つのホイールの間（隣の crushing_wheel_controller）にある
      const items = [...findItemIds(be)]
      const controllers: Vec3[] = []
      for (const d of NEIGHBORS) {
        const p: Vec3 = [pos[0] + d[0], pos[1] + d[1], pos[2] + d[2]]
        if (env.bp.get(p)?.id.toString() === 'create:crushing_wheel_controller') {
          controllers.push(p)
          items.push(...findItemIds(env.bp.blockEntityAt(p)))
        }
      }
      const recipe = recipeFor('crushing', itemsFor(controllers, () => items, env), pos, env)
      return [stackItem(label, crushingTicks(rpm, recipe.duration.value, 1)!, crushingTicks(rpm, recipe.duration.value, STACK_SIZE)!, rotation.source, recipe), recipeItem(recipe)]
    }
    case 'mechanical_saw': {
      const recipe = recipeFor('cutting', itemsFor([pos], () => findItemIds(be), env), pos, env)
      return [stackItem(label, sawTicks(rpm, recipe.duration.value, 1)!, sawTicks(rpm, recipe.duration.value, STACK_SIZE)!, rotation.source, recipe), recipeItem(recipe)]
    }
    default:
      return []
  }
}

/** 回らないブロック（ファンネル・シュート）の輸送量。関係しないブロックなら null */
export function staticThroughputValues(pos: Vec3, id: string, env: ThroughputEnv): CalcSummaryItem[] | null {
  const path = createPath(id)
  if (path === 'andesite_funnel' || path === 'brass_funnel') {
    const amount = funnelAmount(path, env.bp.blockEntityAt(pos))
    const timer = env.values.extractionTimer()
    const perSecond = funnelItemsPerSecond(amount.value, timer.value)
    return [
      {
        label: '輸送量',
        value: resolved(
          `${formatRate(perSecond)} 個/秒（入れ物から取り出すとき。${formatNumber(timer.value)} tick ごとに ${formatNumber(amount.value)} 個）`,
          weakerSource(amount.source, timer.source),
        ),
      },
    ]
  }
  if (path === 'chute' || path === 'smart_chute') {
    const fan = [1, -1].some((dy) => env.bp.get([pos[0], pos[1] + dy, pos[2]])?.id.toString() === 'create:encased_fan')
    if (fan) env.log.add('シュートに扇風機がつながっているが、風は計算せず、重力で落ちる速さで出した', pos)
    return [
      {
        label: '輸送量',
        value: resolved(
          `${formatNumber(CHUTE_GRAVITY_SPEED)} マス/秒（重力で落ちるとき。1個ずつ ${formatRate(CHUTE_GRAVITY_SPEED)} 個/秒、64 個ずつ ${formatRate(CHUTE_GRAVITY_SPEED * STACK_SIZE)} 個/秒）`,
          fan ? 'assumed' : 'builtin',
        ),
      },
    ]
  }
  return null
}

/** 輸送量・処理時間を出す回るブロック */
const KINETIC_THROUGHPUT_BLOCKS = new Set([
  'belt',
  'mechanical_arm',
  'mechanical_press',
  'mechanical_mixer',
  'millstone',
  'crushing_wheel',
  'mechanical_saw',
  'deployer',
])
const TRANSPORT_BLOCKS = new Set(['belt', 'mechanical_arm'])

const NEIGHBORS: readonly Vec3[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
]

/** レシピを決める物。物の通り道で positions のどれかに届く物があればそれ、なければ生データの物 */
function itemsFor(positions: readonly Vec3[], fromNbt: () => string[], env: ThroughputEnv): string[] {
  const arrived = new Set<string>()
  for (const p of positions) for (const item of env.pathItems?.(p) ?? []) arrived.add(item)
  return arrived.size > 0 ? [...arrived] : fromNbt()
}

function recipeFor(type: ProcessingRecipeType, items: readonly string[], pos: Vec3, env: ThroughputEnv): RecipeChoice {
  const choice = chooseRecipe(type, items, env.recipes)
  if (choice.assumption) env.log.add(choice.assumption, pos)
  if (env.recipes?.scriptsChangeRecipes) {
    env.log.add('KubeJS のスクリプトがレシピを変えているが、スクリプトのレシピは読めないので、処理時間に入れていない')
  }
  return choice
}

function recipeItem(recipe: RecipeChoice): CalcSummaryItem {
  return { label: 'レシピ', value: resolved(recipe.text, recipe.duration.source) }
}

/** 1個ずつと 64 個まとめての処理時間（粉砕ホイール・ソー） */
function stackItem(label: string, one: number, stack: number, rpmSource: Provenance, recipe: RecipeChoice): CalcSummaryItem {
  return {
    label,
    value: resolved(
      `1個なら ${ticksText(one)}（${formatRate(perMinuteOf(one))} 個/分）、64 個まとめてなら ${ticksText(stack)}（${formatRate(perMinuteOf(stack) * STACK_SIZE)} 個/分）`,
      weakerSource(rpmSource, recipe.duration.source),
    ),
  }
}

/** 「30 tick（1.5 秒）」 */
function ticksText(ticks: number): string {
  return `${formatNumber(ticks)} tick（${seconds(ticks)} 秒）`
}

function seconds(ticks: number): string {
  return formatNumber(ticks / TICKS_PER_SECOND)
}

/** 1回が ticks のとき、1分の回数 */
function perMinuteOf(ticks: number): number {
  return (60 * TICKS_PER_SECOND) / ticks
}

/** 個数の速さ。10 以上は整数、それより小さいと小数2桁まで */
export function formatRate(value: number): string {
  return formatNumber(value >= 10 ? Math.round(value) : value)
}

/** ⌊log2(n)⌋（Minecraft の Mth.log2）。n が 0 以下なら 0 */
function floorLog2(n: number): number {
  return n <= 0 ? 0 : Math.floor(Math.log2(n))
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

/** 浮動小数の誤差（1024 / 64 が 16.000001 になるなど）で1つ多くならないようにする切り上げ */
function ceil(v: number): number {
  return Math.ceil(v - 1e-9)
}
