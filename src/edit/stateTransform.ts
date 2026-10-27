// ブロック状態の向きを、範囲の回転・反転に合わせて変える（docs/design.md「範囲の編集」の StateTransformer、#132）。
// バニラの向きのプロパティの規則。規則の表は docs/design.md「ブロック状態の回転・反転」。

import { BlockState } from '../domain/blockState'
import { flipsHandedness, transformDirection, type BlockTransform } from '../domain/blockTransform'
import { HORIZONTAL_DIRECTIONS, isDirection } from '../domain/direction'

/**
 * ブロック状態を変換に合わせて変える関数。edit の範囲の操作に渡す。
 * 画面は計算プラグインの規則（Mod 独自のプロパティ）を先に聞き、なければ transformVanillaState を使う
 */
export type StateTransformer = (state: BlockState, t: BlockTransform) => BlockState

const STAIR_SHAPES = new Set(['straight', 'inner_left', 'inner_right', 'outer_left', 'outer_right'])

// left ↔ right（扉の hinge、チェストの type、階段の shape）
function swapLeftRight(v: string): string {
  if (v.endsWith('left')) return `${v.slice(0, -4)}right`
  if (v.endsWith('right')) return `${v.slice(0, -5)}left`
  return v
}

// 向きの名前を "_" でつないだ値（レールの south_east・ascending_north、ジグソーの orientation の up_east）の各向きを変える。
// 向きでない語（ascending）はそのまま。向きが1つもなければ null
function transformDirectionWords(t: BlockTransform, v: string): string[] | null {
  const words = v.split('_')
  if (!words.some(isDirection)) return null
  return words.map((w) => (isDirection(w) ? transformDirection(t, w) : w))
}

// レールの shape。2つの水平の向きなら、north / south を先に、east / west を後に並べ直す（north_south・east_west・south_east など）
function transformRailShape(t: BlockTransform, v: string): string {
  const words = transformDirectionWords(t, v)
  if (!words) return v
  if (words.length !== 2 || !words.every(isDirection)) return words.join('_')
  const order = ['north', 'south', 'east', 'west']
  const [a, b] = [...words].sort((p, q) => order.indexOf(p) - order.indexOf(q)) as [string, string]
  return `${a}_${b}`
}

/**
 * バニラの向きのプロパティを変換に合わせて変える。元の状態は変えない。変わらなければ元の状態を返す。
 * - axis：90° の奇数回で x ↔ z
 * - facing・horizontal_facing：水平の向きを反転してから回す。up / down は変えない
 * - rotation（0〜15。看板・旗・頭）：反転で x なら 16 − r、z なら 8 − r（16 の剰余）、回転で +4 ずつ
 * - north・east・south・west（柵・壁・ガラス板・レッドストーンの接続、ツタ）：値をその向きの行き先へ移す
 * - shape：階段（straight など）は反転で left ↔ right。レールは向きの語を変える
 * - hinge（扉）・type（チェストの left / right）：反転で left ↔ right
 * - orientation（ジグソー・クラフター。down_east など）：向きの語を変える
 */
export function transformVanillaState(state: BlockState, t: BlockTransform): BlockState {
  const from = state.properties
  const props: Record<string, string> = { ...from }
  const mirrored = flipsHandedness(t)

  const axis = from.axis
  if (axis !== undefined && t.quarterTurns % 2 === 1) props.axis = axis === 'x' ? 'z' : axis === 'z' ? 'x' : axis

  for (const name of ['facing', 'horizontal_facing']) {
    const v = from[name]
    if (v !== undefined && isDirection(v)) props[name] = transformDirection(t, v)
  }

  const rotation = from.rotation
  if (rotation !== undefined && /^\d+$/.test(rotation)) {
    let r = Number(rotation) % 16
    if (t.mirror === 'x') r = (16 - r) % 16
    if (t.mirror === 'z') r = (24 - r) % 16
    props.rotation = String((r + 4 * t.quarterTurns) % 16)
  }

  // 接続のプロパティは、全部を読んでから書く（入れ替わるので）
  const sides = HORIZONTAL_DIRECTIONS.filter((d) => from[d] !== undefined)
  for (const d of sides) delete props[d]
  for (const d of sides) props[transformDirection(t, d)] = from[d]!

  const shape = from.shape
  if (shape !== undefined) {
    if (STAIR_SHAPES.has(shape)) {
      if (mirrored) props.shape = swapLeftRight(shape)
    } else {
      props.shape = transformRailShape(t, shape)
    }
  }

  if (mirrored) {
    for (const name of ['hinge', 'type']) {
      const v = from[name]
      if (v === 'left' || v === 'right') props[name] = swapLeftRight(v)
    }
  }

  const orientation = from.orientation
  if (orientation !== undefined) props.orientation = transformDirectionWords(t, orientation)?.join('_') ?? orientation

  const keys = new Set([...Object.keys(props), ...Object.keys(from)])
  const changed = [...keys].some((k) => props[k] !== from[k])
  return changed ? new BlockState(state.id, props) : state
}
