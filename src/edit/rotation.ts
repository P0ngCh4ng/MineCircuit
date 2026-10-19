import { BlockState } from '../domain/blockState'
import { HORIZONTAL_DIRECTIONS, isDirection } from '../domain/direction'

/**
 * ブロックの properties ごとに取りうる値の一覧。
 * Modpack のブロック状態の定義（blockstates/*.json）から作る（#27）。
 * 一覧にない property は、値を制限しない。
 */
export type PropertyValueOptions = Readonly<Record<string, readonly string[]>>

/** 回転の対象にする property の名前。設計書の「回転の規則」の表と同じ */
export const ROTATABLE_PROPERTIES = ['axis', 'facing', 'horizontal_facing'] as const

type RotatableProperty = (typeof ROTATABLE_PROPERTIES)[number]

/** 1回分の回転。値を変えられないときは同じ値を返す */
type RotationStep = (value: string) => string

// R（水平）: 上から見て時計回り。north → east → south → west → north
function turnHorizontal(value: string): string {
  if (!isDirection(value)) return value
  const i = HORIZONTAL_DIRECTIONS.indexOf(value)
  if (i < 0) return value // up / down は水平の回転では変えない
  return HORIZONTAL_DIRECTIONS[(i + 1) % HORIZONTAL_DIRECTIONS.length] ?? value
}

const HORIZONTAL_STEPS: Readonly<Record<RotatableProperty, RotationStep>> = {
  // x ↔ z。y は変えない
  axis: (v) => (v === 'x' ? 'z' : v === 'z' ? 'x' : v),
  facing: turnHorizontal,
  horizontal_facing: turnHorizontal,
}

const VERTICAL_STEPS: Readonly<Record<RotatableProperty, RotationStep>> = {
  // y にする。y なら x に戻す
  axis: (v) => (v === 'y' ? 'x' : v === 'x' || v === 'z' ? 'y' : v),
  // up → down → north。水平の向きなら up にする
  facing: (v) => {
    if (v === 'up') return 'down'
    if (v === 'down') return 'north'
    return isDirection(v) ? 'up' : v
  },
  // 水平の向きしか持たないので変えない
  horizontal_facing: (v) => v,
}

// 取りうる値の一覧にない値を飛ばしながら回す。一周しても見つからなければ元の値
function stepWithin(value: string, step: RotationStep, allowed: readonly string[] | undefined): string {
  if (allowed === undefined) return step(value)
  const seen = new Set<string>([value])
  let next = step(value)
  while (!seen.has(next)) {
    if (allowed.includes(next)) return next
    seen.add(next)
    next = step(next)
  }
  return value
}

/**
 * ブロック状態を1回回した結果を返す。元の状態は変えない。
 * vertical が false なら R（水平）、true なら Shift+R（縦）の規則を使う。
 * options があれば、その範囲の値だけを使う。null なら規則のとおりに回す。
 * 回せる property がなければ、元と同じ状態（equals が true）を返す。
 */
export function rotateState(
  state: BlockState,
  vertical: boolean,
  options: PropertyValueOptions | null = null,
): BlockState {
  const steps = vertical ? VERTICAL_STEPS : HORIZONTAL_STEPS
  const properties: Record<string, string> = { ...state.properties }
  let changed = false
  for (const name of ROTATABLE_PROPERTIES) {
    const value = properties[name]
    if (value === undefined) continue
    const next = stepWithin(value, steps[name], options?.[name])
    if (next !== value) {
      properties[name] = next
      changed = true
    }
  }
  return changed ? new BlockState(state.id, properties) : state
}

/** 回すと状態が変わるなら true。false のときは画面で「回せる向きがない」と出す */
export function canRotate(
  state: BlockState,
  vertical: boolean,
  options: PropertyValueOptions | null = null,
): boolean {
  return !rotateState(state, vertical, options).equals(state)
}
