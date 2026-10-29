// Create のブロックの回転軸・軸の口・歯車・面の係数（docs/create-stress.md「ブロックの回転軸と『軸の口』」
// 「面の係数」）。ブロック状態だけから決める。nbt を使う値（動力源の回転数など）は kineticGraph.ts で読む。

import type { BlockState } from '../../domain/blockState'
import { isDirection, oppositeDirection, type Direction } from '../../domain/direction'

export type Axis = 'x' | 'y' | 'z'
export type CogKind = 'none' | 'small' | 'large'

/** 向きの軸 */
export function directionAxis(d: Direction): Axis {
  return d === 'east' || d === 'west' ? 'x' : d === 'up' || d === 'down' ? 'y' : 'z'
}

/** 向きが軸の正の向き（east / up / south）なら true */
export function isPositive(d: Direction): boolean {
  return d === 'east' || d === 'up' || d === 'south'
}

/** 軸の正の向きと負の向き */
export function axisDirections(axis: Axis): [positive: Direction, negative: Direction] {
  return axis === 'x' ? ['east', 'west'] : axis === 'y' ? ['up', 'down'] : ['south', 'north']
}

/** 上から見て時計回りに 90° 回した向き。上下はそのまま */
export function clockwise(d: Direction): Direction {
  switch (d) {
    case 'north':
      return 'east'
    case 'east':
      return 'south'
    case 'south':
      return 'west'
    case 'west':
      return 'north'
    default:
      return d
  }
}

export const AXES: readonly Axis[] = ['x', 'y', 'z']

export function axisIndex(axis: Axis): 0 | 1 | 2 {
  return axis === 'x' ? 0 : axis === 'y' ? 1 : 2
}

/** ブロック状態から決まる、回転に関わる形 */
export interface KineticShape {
  readonly axis: Axis
  /** シャフトとしてつながる面 */
  readonly shaftFaces: readonly Direction[]
  readonly cog: CogKind
  /** 面ごとの係数。null ならすべて 1 */
  readonly faceFactors: Partial<Record<Direction, number>> | null
  /** チェーンドライブなら、チェーンのつながり */
  readonly chain: ChainInfo | null
  /** 仮定に載せること（シーケンスギアシフトを待機中とみなした、など） */
  readonly note?: string
}

export interface ChainInfo {
  /** チェーンがつながる向きの軸 */
  readonly connectionAxis: Axis
  /** 正の向きの隣とつながる */
  readonly positive: boolean
  /** 負の向きの隣とつながる */
  readonly negative: boolean
}

type Props = Readonly<Record<string, string>>

function propAxis(props: Props, key = 'axis'): Axis | null {
  const v = props[key]
  return v === 'x' || v === 'y' || v === 'z' ? v : null
}

function propFacing(props: Props): Direction | null {
  const v = props.facing
  return v !== undefined && isDirection(v) ? v : null
}

function bothSides(axis: Axis): Direction[] {
  return [...axisDirections(axis)]
}

function shape(axis: Axis, shaftFaces: readonly Direction[], cog: CogKind = 'none', extra: Partial<KineticShape> = {}): KineticShape {
  return { axis, shaftFaces, cog, faceFactors: null, chain: null, ...extra }
}

/** DirectionalAxisKineticBlock の回転軸（facing と axis_along_first） */
function directionalAxis(facing: Direction, alongFirst: boolean): Axis {
  switch (directionAxis(facing)) {
    case 'x':
      return alongFirst ? 'y' : 'z'
    case 'y':
      return alongFirst ? 'x' : 'z'
    case 'z':
      return alongFirst ? 'x' : 'y'
  }
}

/** ギアボックスの面の係数。a(e) × s(e の軸)。s は axis 以外の2軸を x, y, z の順に +1, −1 */
function gearboxFactors(axis: Axis): Partial<Record<Direction, number>> {
  const others = AXES.filter((a) => a !== axis)
  const factors: Partial<Record<Direction, number>> = {}
  others.forEach((a, i) => {
    const s = i === 0 ? 1 : -1
    const [pos, neg] = axisDirections(a)
    factors[pos] = s
    factors[neg] = -s
  })
  return factors
}

/** ブロックの面の係数 */
export function faceFactor(shape: KineticShape, face: Direction): number {
  return shape.faceFactors?.[face] ?? 1
}

const SHAFT_LIKE = new Set([
  'shaft',
  'powered_shaft',
  'metal_girder_encased_shaft',
  'flywheel',
  'crushing_wheel',
  'rope_pulley',
  'large_water_wheel',
])

/** 回すと軸の反対側（f'）だけに口があるもの */
const BACK_SHAFT = new Set([
  'hand_crank',
  'encased_fan',
  'mechanical_drill',
  'windmill_bearing',
  'mechanical_bearing',
  'clockwork_bearing',
  'cuckoo_clock',
  'mysterious_cuckoo_clock',
])

const DIRECTIONAL_AXIS = new Set(['deployer', 'mechanical_piston', 'sticky_mechanical_piston', 'speedometer', 'stressometer'])

/** ハンドル（hand_crank と色付きのバルブハンドル） */
export function isCrank(path: string): boolean {
  return path === 'hand_crank' || path.endsWith('valve_handle')
}

/**
 * Create のブロック（`create:` を外した名前）の形。回転に関わらないブロックや、
 * 必要なプロパティがないブロックは null。
 */
export function kineticShape(path: string, state: BlockState): KineticShape | null {
  return shapeFromProperties(path, state.properties)
}

/** ブロック状態を問わず回転に関わるブロックの値の見本。これで形が決まれば、回るブロックの名前 */
const SAMPLE_PROPERTIES: Props = { axis: 'y', facing: 'north' }

/**
 * 回転に関わる Create のブロックか（`create:` を外した名前）。
 * true なのに kineticShape が null なら、回転軸を決めるブロック状態がないか読めない（#148）
 */
export function isKineticBlock(path: string): boolean {
  return shapeFromProperties(path, SAMPLE_PROPERTIES) !== null
}

function shapeFromProperties(path: string, props: Props): KineticShape | null {
  const axis = propAxis(props)
  const facing = propFacing(props)

  if (SHAFT_LIKE.has(path) || path.endsWith('_encased_shaft')) return axis ? shape(axis, bothSides(axis)) : null
  if (path === 'cogwheel') return axis ? shape(axis, bothSides(axis), 'small') : null
  if (path === 'large_cogwheel') return axis ? shape(axis, bothSides(axis), 'large') : null
  if (path.endsWith('_encased_cogwheel') || path.endsWith('_encased_large_cogwheel')) {
    if (!axis) return null
    const [pos, neg] = axisDirections(axis)
    const faces: Direction[] = []
    if (props.top_shaft === 'true') faces.push(pos)
    if (props.bottom_shaft === 'true') faces.push(neg)
    return shape(axis, faces, path.endsWith('_large_cogwheel') ? 'large' : 'small')
  }
  if (path === 'gearbox') {
    if (!axis) return null
    const faces = AXES.filter((a) => a !== axis).flatMap((a) => bothSides(a))
    return shape(axis, faces, 'none', { faceFactors: gearboxFactors(axis) })
  }
  if (path === 'gearshift') {
    if (!axis) return null
    const [pos, neg] = axisDirections(axis)
    const powered = props.powered === 'true'
    return shape(axis, bothSides(axis), 'none', { faceFactors: powered ? { [pos]: 1, [neg]: -1 } : null })
  }
  if (path === 'clutch') {
    if (!axis) return null
    // つながっているときは両面、切れているときは片側だけ（クラッチ自身の応力は 0 なので、どちら側でも結果は同じ）
    return shape(axis, props.powered === 'true' ? [axisDirections(axis)[0]] : bothSides(axis))
  }
  if (path === 'sequenced_gearshift') {
    const a = props.vertical === 'true' ? 'y' : axis
    if (!a) return null
    return shape(a, [axisDirections(a)[0]], 'none', {
      note: 'シーケンスギアシフトは待機中（出力側が切れている）とみなした',
    })
  }
  if (path === 'encased_chain_drive' || path === 'adjustable_chain_gearshift') {
    if (!axis) return null
    const alongFirst = props.axis_along_first === 'true'
    const connectionAxis: Axis = alongFirst ? (axis === 'x' ? 'y' : 'x') : axis === 'z' ? 'y' : 'z'
    const part = props.part ?? 'none'
    return shape(axis, bothSides(axis), 'none', {
      chain: {
        connectionAxis,
        positive: part === 'start' || part === 'middle',
        negative: part === 'end' || part === 'middle',
      },
    })
  }
  if (path === 'rotation_speed_controller') return axis ? shape(axis, bothSides(axis)) : null
  if (path === 'creative_motor') return facing ? shape(directionAxis(facing), [facing]) : null
  if (path === 'water_wheel' || path === 'mechanical_press' || path === 'gantry_shaft') {
    return facing ? shape(directionAxis(facing), bothSides(directionAxis(facing))) : null
  }
  if (BACK_SHAFT.has(path) || isCrank(path)) {
    return facing ? shape(directionAxis(facing), [oppositeDirection(facing)]) : null
  }
  if (path === 'mechanical_saw') {
    if (!facing) return null
    if (directionAxis(facing) !== 'y') return shape(directionAxis(facing), [oppositeDirection(facing)])
    const a = directionalAxis(facing, props.axis_along_first === 'true')
    return shape(a, bothSides(a))
  }
  if (DIRECTIONAL_AXIS.has(path)) {
    if (!facing) return null
    const a = directionalAxis(facing, props.axis_along_first === 'true')
    return shape(a, bothSides(a))
  }
  if (path === 'weighted_ejector' || path === 'elevator_pulley') {
    return facing ? shape(directionAxis(clockwise(facing)), bothSides(directionAxis(clockwise(facing)))) : null
  }
  if (path === 'hose_pulley') return facing ? shape(directionAxis(clockwise(facing)), [clockwise(facing)]) : null
  if (path === 'belt') {
    if (!facing) return null
    const a: Axis = props.slope === 'sideways' ? 'y' : directionAxis(clockwise(facing))
    return shape(a, props.part === 'middle' ? [] : bothSides(a))
  }
  if (path === 'millstone') return shape('y', ['down'], 'small')
  if (path === 'turntable') return shape('y', ['down'])
  if (path === 'mechanical_mixer' || path === 'mechanical_arm') return shape('y', [], 'small')
  if (path === 'chain_conveyor') return shape('y', ['up', 'down'])
  if (path === 'mechanical_crafter' || path === 'display_board' || path === 'mechanical_pump') {
    return facing ? shape(directionAxis(facing), [], 'small') : null
  }
  if (path === 'copper_backtank' || path === 'netherite_backtank') return shape('y', ['up'])
  return null
}
