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

/** 3D で当たった所 */
export interface PlacementHit {
  readonly pos: Vec3
  readonly face: Direction
  /** 当たった点（ワールド座標） */
  readonly point: Vec3
}

/**
 * 向きを、ブロックの中心から当たった点へのベクトルに近い順に並べる（Create の IPlacementHelper.orderedByDistance と同じ）。
 * include で選んだ向きだけ。同じ近さなら DIRECTIONS の順
 */
function orderedByDistance(hit: PlacementHit, include: (d: Direction) => boolean): Direction[] {
  const c = [hit.point[0] - hit.pos[0] - 0.5, hit.point[1] - hit.pos[1] - 0.5, hit.point[2] - hit.pos[2] - 0.5]
  return DIRECTIONS.filter(include)
    .map((d) => {
      const v = directionVector(d)
      return { d, dist: Math.hypot(v[0] - c[0]!, v[1] - c[1]!, v[2] - c[2]!) }
    })
    .sort((a, b) => a.dist - b.dist)
    .map((x) => x.d)
}

/** 歯車の真ん中の軸（6 画素の太さの柱）に当たったか。当たったら補助は使わない */
function hitOnShaft(hit: PlacementHit, axis: 'x' | 'y' | 'z'): boolean {
  const ai = axis === 'x' ? 0 : axis === 'y' ? 1 : 2
  const eps = 0.001
  for (let i = 0; i < 3; i++) {
    if (i === ai) continue
    const local = hit.point[i]! - hit.pos[i]!
    if (local < 5 / 16 - eps || local > 11 / 16 + eps) return false
  }
  return true
}

function plus(pos: Vec3, ...dirs: Direction[]): Vec3 {
  const out: [number, number, number] = [pos[0], pos[1], pos[2]]
  for (const d of dirs) {
    const v = directionVector(d)
    out[0] += v[0]
    out[1] += v[1]
    out[2] += v[2]
  }
  return out
}

/**
 * 置き方の補助（#123）。Create の歯車の placement helper（CogwheelBlockItem）と同じ。
 * 歯車（ケース入りでないもの）を置くとき、歯車をクリックしたら、噛み合う位置と向きを返す。使わないなら null
 */
export function placementHelper(bp: Blueprint, hit: PlacementHit, state: BlockState): { pos: Vec3; state: BlockState } | null {
  const path = state.id.namespace === 'create' ? state.id.path : ''
  const placing: CogSize | null = path === 'cogwheel' ? 'small' : path === 'large_cogwheel' ? 'large' : null
  const clicked = bp.get(hit.pos)
  const clickedSize = clicked ? cogSize(clicked) : null
  const axis = clicked?.properties.axis
  if (!placing || !clicked || !clickedSize || (axis !== 'x' && axis !== 'y' && axis !== 'z')) return null
  if (hitOnShaft(hit, axis)) return null

  const free = (pos: Vec3) => bp.locate(pos) !== null && bp.get(pos) === null
  const withAxis = (a: string) => new BlockState(state.id, { ...state.properties, axis: a })
  const tryAt = (pos: Vec3, a: string): { pos: Vec3; state: BlockState } | null => {
    const s = withAxis(a)
    return free(pos) && placementProblem(bp, pos, s) === null ? { pos, state: s } : null
  }
  const exceptAxis = orderedByDistance(hit, (d) => directionAxis(d) !== axis)

  // 小さい歯車で小さい歯車：軸に垂直な向きの隣に、同じ軸で
  if (placing === 'small' && clickedSize === 'small') {
    for (const d of exceptAxis) {
      const r = tryAt(plus(hit.pos, d), axis)
      if (r) return r
    }
    return null
  }
  // 大きい歯車で大きい歯車：軸の向き（当たった点に近い側）と、軸に垂直な向きを足した位置に、その垂直な向きの軸で
  if (placing === 'large' && clickedSize === 'large') {
    const side = orderedByDistance(hit, (d) => directionAxis(d) === axis)[0]!
    for (const d of exceptAxis) {
      const r = tryAt(plus(hit.pos, d, side), directionAxis(d))
      if (r) return r
    }
    return null
  }
  // 大きさが違う：軸に垂直な向きのうち一番近い向きと、それと別の軸の向きを足した斜めに、同じ軸で
  const closest = exceptAxis[0]!
  for (const d of exceptAxis.filter((x) => directionAxis(x) !== directionAxis(closest))) {
    const r = tryAt(plus(hit.pos, d, closest), axis)
    if (r) return r
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
