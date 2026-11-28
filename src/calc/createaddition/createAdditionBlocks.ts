// Create Crafts & Additions のブロックの規則（docs/createaddition-power.md「ブロック」「Create の回転とのやりとり」）。
// 回るブロック（モーター・発電機・圧延機）は、Create のアドオンの表と同じ形（CREATE_ADDITION_KINETICS）で Create の計算に渡す。
// Create の場所は import しない。形が同じなので、登録の場所（calc/builtinPlugins.ts）でそのまま渡せる。

import { BlockState } from '../../domain/blockState'
import type { Blueprint } from '../../domain/blueprint'
import { isDirection, oppositeDirection, type Direction } from '../../domain/direction'
import { nbt, type RawNbt } from '../../domain/nbt'
import type { BlockSettingField, BlockSettings } from '../blockSettings'
import type { CalcMode, CalcModpack } from '../calcPlugin'
import { nbtBoolean, nbtNumber } from '../nbtValues'
import { resolved, type Resolved } from '../provenance'
import { loadCaValues, type CaValues } from './createAdditionValues'

export const CA_NAMESPACE = 'createaddition'

/** 設定の回転数の初期値（ElectricMotorBlockEntity.addBehaviours） */
export const DEFAULT_MOTOR_SPEED = 32

export type Axis = 'x' | 'y' | 'z'

export function directionAxis(d: Direction): Axis {
  return d === 'east' || d === 'west' ? 'x' : d === 'up' || d === 'down' ? 'y' : 'z'
}

/** 向きが軸の負の向き（down・north・west）なら true */
function isNegative(d: Direction): boolean {
  return d === 'down' || d === 'north' || d === 'west'
}

/** C&A のブロックの facing。なければ・読めなければ null */
export function caFacing(state: BlockState): Direction | null {
  const f = state.properties.facing
  return f !== undefined && isDirection(f) ? f : null
}

/** モーターの設定の回転数（CA-MOTOR-SPEED。符号は設定のまま） */
export function motorSetSpeed(be: RawNbt | null): Resolved<number> {
  const scroll = nbtNumber(be, 'ScrollValue')
  return scroll === null ? resolved(DEFAULT_MOTOR_SPEED, 'builtin') : resolved(scroll, 'blueprint')
}

/** モーターが回っているか（CA-MOTOR-ACTIVE）。note は仮定に載せること */
export function motorActive(state: BlockState, be: RawNbt | null, mode: CalcMode): { active: boolean; note: string | null } {
  if (mode === 'running') {
    if (state.properties.powered === 'true') return { active: false, note: null }
    return { active: true, note: '動かしたときなので、電気モーターは電気が足りるものとして回した（足りるかは電力の計算で見る）' }
  }
  const saved = nbtBoolean(be, 'active')
  if (saved !== null) return { active: saved, note: null }
  return { active: true, note: '電気モーターの生データに active がないので、回っているとみなした' }
}

/** Create のアドオンの表の、回るブロック1つ分（calc/create/createAddons.ts の CreateAddonKineticBlock と同じ形） */
export interface CaKineticBlock {
  readonly axis: Axis
  readonly shaftFaces: readonly Direction[]
  readonly impact: Resolved<number>
  readonly source: { readonly speed: Resolved<number>; readonly capacity: Resolved<number> } | null
  readonly notes: readonly string[]
}

/** 1 RPM あたりの応力（max_stress / 256）。モーターの供給と発電機の消費 */
export function stressPerRpm(values: CaValues): Resolved<number> {
  const max = values.get('maxStress')
  return { ...max, value: max.value / 256 }
}

/** 回るブロックの形と値（CA-KIN-*）。回らないブロック、向きが読めないブロックは null */
export function caKineticBlock(state: BlockState, be: RawNbt | null, mode: CalcMode, values: CaValues): CaKineticBlock | null {
  if (state.id.namespace !== CA_NAMESPACE) return null
  const facing = caFacing(state)
  if (!facing) return null
  const axis = directionAxis(facing)
  const both = [facing, oppositeDirection(facing)]
  switch (state.id.path) {
    case 'electric_motor': {
      // CA-KIN-MOTOR・CA-MOTOR-SPEED・CA-MOTOR-ACTIVE
      const set = motorSetSpeed(be)
      const { active, note } = motorActive(state, be, mode)
      const signed = isNegative(facing) ? -set.value : set.value
      const speed = active ? resolved(signed === 0 ? 0 : signed, set.source) : resolved(0, 'blueprint')
      return { axis, shaftFaces: [facing], impact: resolved(0, 'builtin'), source: { speed, capacity: stressPerRpm(values) }, notes: note ? [note] : [] }
    }
    case 'alternator':
      // CA-KIN-ALTERNATOR。Fabric 1.18.2 版は facing の面だけ
      return { axis, shaftFaces: values.profile === '1.7' ? both : [facing], impact: stressPerRpm(values), source: null, notes: [] }
    case 'rolling_mill':
      // CA-KIN-ROLLING-MILL
      return { axis, shaftFaces: both, impact: values.get('rollingMillStress'), source: null, notes: [] }
    default:
      return null
  }
}

/** Create の計算に渡すアドオンの表（calc/create/createAddons.ts の CreateKineticAddon と同じ形） */
export const CREATE_ADDITION_KINETICS = {
  namespace: CA_NAMESPACE,
  async load(pack: CalcModpack | null, bp: Blueprint) {
    const { values } = await loadCaValues(pack, bp)
    return {
      notes: [] as readonly string[],
      block: (state: BlockState, be: RawNbt | null, mode: CalcMode) => caKineticBlock(state, be, mode, values),
    }
  },
}

/** 足りないときに補うプロパティ（どの版にもあるものだけ。docs/createaddition-power.md「ブロック」） */
const DEFAULT_PROPERTIES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  electric_motor: { facing: 'north', powered: 'false' },
  alternator: { facing: 'north' },
  rolling_mill: { facing: 'north' },
  connector: { facing: 'down', mode: 'none' },
  large_connector: { facing: 'down', mode: 'none' },
  small_light_connector: { facing: 'down', mode: 'none', powered: 'false' },
  modular_accumulator: { top: 'true', bottom: 'true' },
  accumulator: { facing: 'north' },
}

/** 足りない状態を補う（completeState）。知らないブロックなら null */
export function completeCaState(state: BlockState): { state: BlockState; problem: string | null } | null {
  if (state.id.namespace !== CA_NAMESPACE || !Object.hasOwn(DEFAULT_PROPERTIES, state.id.path)) return null
  const defaults = DEFAULT_PROPERTIES[state.id.path]
  const props = { ...state.properties }
  let changed = false
  for (const [k, v] of Object.entries(defaults)) {
    if (props[k] === undefined) {
      props[k] = v
      changed = true
    }
  }
  const next = changed ? new BlockState(state.id, props) : state
  if (defaults.facing !== undefined && !caFacing(next)) {
    return { state, problem: `${state.key} は向き（facing）が読めないため、計算から外れます。置くブロックの状態を選び直してください。` }
  }
  return { state: next, problem: null }
}

const MOTOR_SPEED: BlockSettingField = {
  key: 'ScrollValue',
  label: '回転数',
  unit: 'RPM',
  min: -256,
  max: 256,
  defaultValue: DEFAULT_MOTOR_SPEED,
  hint: '向き（facing）が下・北・西のときは、出る回転の符号が逆になります。使う電力は回転数の大きさで決まります。',
}

/** 画面から変えられる設定（blockSettings）。電気モーターの回転数だけ */
export function caBlockSettings(state: BlockState): BlockSettings | null {
  if (state.id.namespace !== CA_NAMESPACE || state.id.path !== 'electric_motor') return null
  return {
    fields: [MOTOR_SPEED],
    // 設計図の生データは位置を持たないので、id だけを入れる。ゲームがこの形を読めるかは未確認
    initialBlockEntity: (): RawNbt => nbt.compound({ id: nbt.string('createaddition:electric_motor') }),
  }
}
