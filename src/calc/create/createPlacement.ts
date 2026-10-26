// 置くときの向き（docs/ui.md「編集」、#119）。隣の Create の回るブロックと、回転がつながる向きに合わせる。
// - シャフトの口どうしが向き合えばつながる（シャフトの端にシャフト、モーターの軸をシャフトへ）
// - 小さい歯車どうしは、同じ軸で、軸に垂直な向きに隣り合えば噛み合う
// 向きの候補は、ブロック状態の axis（x・y・z）か facing（6方向）を変えたもの。いちばん多くつながる候補を選ぶ。
// from（3D でクリックした面の側）でつながる候補を優先する。つながる相手がなければ変えない。
// 置けない向き（placementProblem）は候補から外す。
//
// 置けるか（placementProblem、#121）：Create の歯車の規則（CogWheelBlock.isValidCogwheelPosition）。
// 軸に垂直な4方向の隣を調べ、隣が大きい歯車なら置けない。自分が大きい歯車で、隣が小さい歯車でも置けない。
// ただし、隣のブロックの axis がその方向の軸なら問題ない。軸の両端の隣は調べない。ケース入りの歯車も同じ。
// ゲームでは「その場所に残れるか」の判定なので、あとから隣に置かれても外れて落ちる。

import type { Blueprint } from '../../domain/blueprint'
import { BlockState } from '../../domain/blockState'
import { DIRECTIONS, directionVector, oppositeDirection, type Direction } from '../../domain/direction'
import type { Vec3 } from '../../domain/vec3'
import { AXES, directionAxis, kineticShape, type KineticShape } from './kineticBlocks'

/** 向きの候補。今の状態を先頭にする（同じだけつながるなら、今の向きのまま） */
function orientations(state: BlockState): BlockState[] {
  const props = state.properties
  let values: readonly string[] = []
  let name: string | null = null
  if (props.axis !== undefined) {
    name = 'axis'
    values = AXES
  } else if (props.facing !== undefined) {
    name = 'facing'
    values = DIRECTIONS
  }
  if (name === null) return [state]
  const key = name
  const current = props[key]!
  return [current, ...values.filter((v) => v !== current)].map((v) => new BlockState(state.id, { ...props, [key]: v }))
}

type CogSize = 'small' | 'large'

/** 歯車の大きさ（ケース入りを含む）。歯車でなければ null */
function cogSize(state: BlockState): CogSize | null {
  if (state.id.namespace !== 'create') return null
  const path = state.id.path
  if (path === 'large_cogwheel' || path.endsWith('_encased_large_cogwheel')) return 'large'
  if (path === 'cogwheel' || path.endsWith('_encased_cogwheel')) return 'small'
  return null
}

/** 隣に大きい歯車があって置けないとき */
export const NEXT_TO_LARGE_COG = '大きい歯車の横には歯車を置けません（ゲームでは外れて落ちます）。噛み合わせるときは斜めに置きます。'
/** 大きい歯車を、小さい歯車の横に置こうとしたとき */
export const LARGE_COG_NEXT_TO_SMALL = '大きい歯車は小さい歯車の横に置けません（ゲームでは外れて落ちます）。噛み合わせるときは斜めに置きます。'

/** pos に state を置けるか。置けないなら理由、置けるなら null */
export function placementProblem(bp: Blueprint, pos: Vec3, state: BlockState): string | null {
  const size = cogSize(state)
  const axis = state.properties.axis
  if (!size || (axis !== 'x' && axis !== 'y' && axis !== 'z')) return null
  for (const d of DIRECTIONS) {
    const dAxis = directionAxis(d)
    if (dAxis === axis) continue
    const v = directionVector(d)
    const n = bp.get([pos[0] + v[0], pos[1] + v[1], pos[2] + v[2]])
    if (!n || n.properties.axis === dAxis) continue
    const other = cogSize(n)
    if (other === 'large') return NEXT_TO_LARGE_COG
    if (size === 'large' && other === 'small') return LARGE_COG_NEXT_TO_SMALL
  }
  return null
}

function shapeOf(state: BlockState): KineticShape | null {
  return state.id.namespace === 'create' ? kineticShape(state.id.path, state) : null
}

/** 置く状態と隣のブロックが、d の向きでつながる強さ。シャフトの口は 2、歯車の噛み合いは 1、つながらなければ 0 */
function linkStrength(shape: KineticShape, d: Direction, neighbor: KineticShape): number {
  if (shape.shaftFaces.includes(d) && neighbor.shaftFaces.includes(oppositeDirection(d))) return 2
  if (shape.cog === 'small' && neighbor.cog === 'small' && shape.axis === neighbor.axis && directionAxis(d) !== shape.axis) return 1
  return 0
}

/**
 * pos に state を置くときの向き。隣とつながる向きに変えた状態を返す。変えないなら null。
 * Create のブロックで、axis か facing を持つものだけを変える
 */
export function orientForPlacement(bp: Blueprint, pos: Vec3, state: BlockState, from: Direction | null): BlockState | null {
  if (state.id.namespace !== 'create') return null
  const candidates = orientations(state)
  if (candidates.length <= 1) return null

  const neighbors: { d: Direction; shape: KineticShape }[] = []
  for (const d of DIRECTIONS) {
    const v = directionVector(d)
    const n = bp.get([pos[0] + v[0], pos[1] + v[1], pos[2] + v[2]])
    const shape = n ? shapeOf(n) : null
    if (shape) neighbors.push({ d, shape })
  }
  if (neighbors.length === 0) return null

  let best: BlockState | null = null
  let bestScore = 0
  for (const c of candidates) {
    const shape = shapeOf(c)
    if (!shape || placementProblem(bp, pos, c) !== null) continue
    let score = 0
    for (const n of neighbors) {
      const link = linkStrength(shape, n.d, n.shape)
      // クリックした面の側でつながるものを優先する
      score += link > 0 && n.d === from ? link + 4 : link
    }
    // 同じ点なら先の候補（今の向き）のまま
    if (score > bestScore) {
      best = c
      bestScore = score
    }
  }
  return best && best.key !== state.key ? best : null
}
