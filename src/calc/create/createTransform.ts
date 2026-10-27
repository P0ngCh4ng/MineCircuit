// Create のブロックの、範囲の回転・反転の規則（#132）。docs/create-stress.md「回転・反転」。
// ゲームが設計図を回して置くときと同じく、先に反転し、次に回す。各ブロックの rotate・mirror の規則を写した。

import { BlockState } from '../../domain/blockState'
import type { BlockTransform, MirrorAxis, QuarterTurns } from '../../domain/blockTransform'
import { transformVector } from '../../domain/blockTransform'
import { boxContains, type Box } from '../../domain/box'
import { DIRECTIONS, directionVector, isDirection, type Direction } from '../../domain/direction'
import type { NbtTag, RawNbt } from '../../domain/nbt'
import { addVec3, type Vec3 } from '../../domain/vec3'
import type { BlockEntityTransform } from '../../edit/regionTransform'
import { transformVanillaState } from '../../edit/stateTransform'

type Props = Record<string, string>

const NO_TURN = { translate: [0, 0, 0], pivot: [0, 0, 0] } as const

function flip(props: Props, name: string): void {
  if (props[name] === 'true') props[name] = 'false'
  else if (props[name] === 'false') props[name] = 'true'
}

function swapParts(props: Props, name = 'part'): void {
  if (props[name] === 'start') props[name] = 'end'
  else if (props[name] === 'end') props[name] = 'start'
}

// 向きが正の向き（east・up・south）か
function isPositive(d: string | undefined): boolean {
  return d === 'east' || d === 'up' || d === 'south'
}

// チェーンドライブの、つながる向きの軸（ChainDriveBlock.getConnectionAxis）
function chainConnectionAxis(props: Props): 'x' | 'y' | 'z' {
  const axis = props.axis
  return props.axis_along_first === 'true' ? (axis === 'x' ? 'y' : 'x') : axis === 'z' ? 'y' : 'z'
}

// 反転1回分の、Create 独自のプロパティ。before は反転の前、props はバニラの規則で変えたあと
function mirrorCreate(id: string, before: Props, props: Props, m: Exclude<MirrorAxis, 'none'>): void {
  // 鋸を上下に向けたときの flipped（SawBlock.mirror）
  if (id === 'mechanical_saw' && (before.facing === 'up' || before.facing === 'down')) {
    const alongX = before.axis_along_first === 'true'
    if ((alongX && m === 'x') || (!alongX && m === 'z')) flip(props, 'flipped')
  }
  // 歯車のケースの両側のシャフト（EncasedCogwheelBlock.mirror）
  if (before.top_shaft !== undefined && before.bottom_shaft !== undefined && before.axis === m) {
    props.top_shaft = before.bottom_shaft
    props.bottom_shaft = before.top_shaft
  }
  // チェーンドライブの part（つながる向きの正の端が負になるなら start ↔ end）
  if (isChainDrive(id) && chainConnectionAxis(before) === m) swapParts(props)
  // 液体タンクの窓
  const window = before.shape
  if (window?.startsWith('window_')) {
    const table: Readonly<Record<string, string>> =
      m === 'x'
        ? { window_ne: 'window_nw', window_nw: 'window_ne', window_se: 'window_sw', window_sw: 'window_se' }
        : { window_ne: 'window_se', window_se: 'window_ne', window_nw: 'window_sw', window_sw: 'window_nw' }
    props.shape = table[window] ?? window
  }
  // コントローラーレールの backwards（向きが逆になるなら）
  if (id === 'controller_rail') {
    const alongZ = before.shape === 'north_south'
    if ((m === 'z') === alongZ) flip(props, 'backwards')
  }
}

// 右回り1回分の窓の向き（FluidTankBlock.rotateOnce）
const WINDOW_TURN: Readonly<Record<string, string>> = {
  window_ne: 'window_se',
  window_se: 'window_sw',
  window_sw: 'window_nw',
  window_nw: 'window_ne',
}

// 回転1回分の、Create 独自のプロパティ。turns は 1（右）・2（180°）・3（左）
function rotateCreate(id: string, before: Props, props: Props, turns: QuarterTurns): void {
  const odd = turns % 2 === 1
  if (isChainDrive(id)) {
    rotateChainDrive(before, props, turns)
  } else if (odd && before.axis_along_first !== undefined) {
    // 機械の向きと回転の軸（DirectionalAxisKineticBlock.rotate）
    flip(props, 'axis_along_first')
  }
  if (odd && before.horizontal_axis !== undefined) {
    props.horizontal_axis = before.horizontal_axis === 'x' ? 'z' : before.horizontal_axis === 'z' ? 'x' : before.horizontal_axis
  }
  // 鋸を上下に向けたときの flipped（SawBlock.rotate）
  if (id === 'mechanical_saw' && (before.facing === 'up' || before.facing === 'down')) {
    if (odd && (turns === 1) !== (before.axis_along_first === 'true')) flip(props, 'flipped')
    if (turns === 2) flip(props, 'flipped')
  }
  // 歯車のケースの両側のシャフト（EncasedCogwheelBlock.swapShaftsForRotation、y 軸まわり）
  if (before.top_shaft !== undefined && before.bottom_shaft !== undefined && before.axis !== 'y') {
    const swap = turns === 2 || (turns === 3 && before.axis === 'x') || (turns === 1 && before.axis === 'z')
    if (swap) {
      props.top_shaft = before.bottom_shaft
      props.bottom_shaft = before.top_shaft
    }
  }
  // 液体タンクの窓
  if (before.shape?.startsWith('window_')) {
    let shape = before.shape
    for (let i = 0; i < turns; i++) shape = WINDOW_TURN[shape] ?? shape
    props.shape = shape
  }
  // コントローラーレールの backwards
  if (id === 'controller_rail') {
    const alongZ = before.shape === 'north_south'
    if (turns === 2 || (odd && alongZ === (turns === 3))) flip(props, 'backwards')
  }
}

function isChainDrive(id: string): boolean {
  return id === 'encased_chain_drive' || id === 'adjustable_chain_gearshift'
}

// チェーンドライブの回転（ChainDriveBlock.rotate(state, rot, Axis.Y)）。軸とつながる向きを回し、正の端が負になれば start ↔ end
function rotateChainDrive(before: Props, props: Props, turns: QuarterTurns): void {
  const t: BlockTransform = { ...NO_TURN, quarterTurns: turns, mirror: 'none' }
  const connection = axisOf(transformVector(t, unitOf(chainConnectionAxis(before))))
  const normal = axisOf(transformVector(t, unitOf((before.axis ?? 'y') as 'x' | 'y' | 'z')))
  if (connection.negative) swapParts(props)
  props.axis = normal.axis
  props.axis_along_first = String(
    (normal.axis === 'x' && connection.axis === 'y') || (normal.axis !== 'x' && connection.axis === 'x'),
  )
}

function unitOf(axis: 'x' | 'y' | 'z'): Vec3 {
  return axis === 'x' ? [1, 0, 0] : axis === 'y' ? [0, 1, 0] : [0, 0, 1]
}

function axisOf(v: Vec3): { axis: 'x' | 'y' | 'z'; negative: boolean } {
  const i = v.findIndex((n) => n !== 0)
  return { axis: (['x', 'y', 'z'] as const)[i]!, negative: v[i]! < 0 }
}

// 縦のベルトの part（BeltBlock.rotate）。向きの正負が変わったら start ↔ end。反転も 180° の回転として同じ
function fixVerticalBelt(id: string, before: Props, props: Props): void {
  if (id !== 'belt' || before.slope !== 'vertical') return
  const was = before.horizontal_facing ?? before.facing
  const now = props.horizontal_facing ?? props.facing
  if (isPositive(was) !== isPositive(now)) swapParts(props)
}

// ブロックを貼るときの面（シャーシの sticky_north など）を、向きの行き先へ移す
function moveSticky(before: Props, props: Props, t: BlockTransform): void {
  const sides = Object.keys(before).filter((k) => k.startsWith('sticky_') && isDirection(k.slice(7)))
  for (const k of sides) delete props[k]
  for (const k of sides) {
    const dir = k.slice(7) as Direction
    const v = transformVector(t, directionVector(dir))
    const next = DIRECTIONS.find((d) => {
      const u = directionVector(d)
      return u[0] === v[0] && u[1] === v[1] && u[2] === v[2]
    })
    props[`sticky_${next ?? dir}`] = before[k]!
  }
}

// 1段分（反転だけ、または回転だけ）
function step(state: BlockState, t: BlockTransform): BlockState {
  const id = state.id.path
  const before = state.properties
  const props: Props = { ...transformVanillaState(state, t).properties }
  if (t.mirror !== 'none') mirrorCreate(id, before, props, t.mirror)
  if (t.quarterTurns !== 0) rotateCreate(id, before, props, t.quarterTurns)
  fixVerticalBelt(id, before, props)
  moveSticky(before, props, t)
  return new BlockState(state.id, props)
}

/**
 * Create のブロック状態を、範囲の回転・反転に合わせて変える（バニラの向きのプロパティも含む）。Create のブロックでなければ null
 */
export function transformCreateState(state: BlockState, t: BlockTransform): BlockState | null {
  if (state.id.namespace !== 'create') return null
  let s = state
  if (t.mirror !== 'none') s = step(s, { ...NO_TURN, quarterTurns: 0, mirror: t.mirror })
  if (t.quarterTurns !== 0) s = step(s, { ...NO_TURN, quarterTurns: t.quarterTurns, mirror: 'none' })
  return s.equals(state) ? state : s
}

// 位置の値（1.20.5 からの int 配列 [x, y, z]、それより前の compound {X, Y, Z}）を読む・同じ形で書く
function readPos(tag: NbtTag | undefined): Vec3 | null {
  if (!tag) return null
  if (tag.type === 'intArray' && tag.value.length === 3) return [tag.value[0]!, tag.value[1]!, tag.value[2]!]
  if (tag.type === 'compound') {
    const xyz = (['X', 'Y', 'Z'] as const).map((k) => tag.value.get(k))
    if (xyz.every((n) => n?.type === 'int')) return xyz.map((n) => (n as { value: number }).value) as unknown as Vec3
  }
  return null
}

function writePos(like: NbtTag, v: Vec3): NbtTag {
  if (like.type === 'intArray') return { type: 'intArray', value: Int32Array.from(v) }
  if (like.type !== 'compound') return like
  const value = new Map(like.value)
  ;(['X', 'Y', 'Z'] as const).forEach((k, i) => value.set(k, { type: 'int', value: v[i]! }))
  return { type: 'compound', value }
}

/** 相対位置を書き直す道具。範囲の外を指していたものを数える */
class RelativeRewriter {
  unresolved = false

  constructor(
    private readonly t: BlockTransform,
    private readonly from: Vec3,
    private readonly source: Box,
  ) {}

  /** 相対位置の値を回して返す。読めなければ元のまま */
  pos(tag: NbtTag): NbtTag {
    const v = readPos(tag)
    if (!v) return tag
    if (!boxContains(this.source, addVec3(this.from, v))) this.unresolved = true
    return writePos(tag, transformVector(this.t, v))
  }

  /** compound の中の key の相対位置を回す */
  field(compound: RawNbt, key: string): RawNbt {
    const tag = compound.value.get(key)
    if (!tag) return compound
    const value = new Map(compound.value)
    value.set(key, this.pos(tag))
    return { type: 'compound', value }
  }

  /** compound の中の key のリストの各要素を map で書き直す */
  list(compound: RawNbt, key: string, map: (tag: NbtTag) => NbtTag): RawNbt {
    const tag = compound.value.get(key)
    if (tag?.type !== 'list') return compound
    const value = new Map(compound.value)
    value.set(key, { ...tag, value: tag.value.map(map) } as NbtTag)
    return { type: 'compound', value }
  }
}

/**
 * Create の生データの中の相対位置を、ブロックの変換に合わせて書き直す。Create のブロックでなく、位置の項目もなければ null。
 * - 機械アーム：InteractionPoints の各 Pos
 * - ディスプレイリンク：TargetOffset
 * - メカニカルクラフター：ConnectedInput の Data の各位置
 * - チェーンコンベア（6.0）：Connections の各位置
 * 範囲の外を指す位置は、回しても相手が一緒に動かないので unresolved にする。
 * ベルトの Controller などワールド座標の項目は、ゲームが置くときに作り直すので変えない
 */
export function transformCreateBlockEntity(
  state: BlockState,
  nbt: RawNbt,
  t: BlockTransform,
  from: Vec3,
  _to: Vec3,
  source: Box,
): BlockEntityTransform | null {
  if (state.id.namespace !== 'create') return null
  const r = new RelativeRewriter(t, from, source)
  let out = nbt
  switch (state.id.path) {
    case 'mechanical_arm':
      out = r.list(out, 'InteractionPoints', (p) => (p.type === 'compound' ? r.field(p, 'Pos') : p))
      break
    case 'display_link':
      out = r.field(out, 'TargetOffset')
      break
    case 'mechanical_crafter': {
      const input = out.value.get('ConnectedInput')
      if (input?.type === 'compound') {
        const value = new Map(out.value)
        value.set('ConnectedInput', r.list(input, 'Data', (p) => r.pos(p)))
        out = { type: 'compound', value }
      }
      break
    }
    case 'chain_conveyor':
      out = r.list(out, 'Connections', (p) => r.pos(p))
      break
    default:
      return null
  }
  return out === nbt ? null : { nbt: out, unresolved: r.unresolved }
}
