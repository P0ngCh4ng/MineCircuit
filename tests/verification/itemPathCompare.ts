// 物の通り道を、まわす・反転する前と後で比べるための道具（docs/create-verification.md「2. 状態の組み合わせ」）。
// createItemPathStates.test.ts（真ん中に置いて6つの面にチェスト）と createItemPathLayouts.test.ts（ブロックごとの置き方）で使う。
import type { CalcResult } from '../../src/calc/calcPlugin'
import { axisDirections, kineticShape } from '../../src/calc/create/kineticBlocks'
import type { BlockState } from '../../src/domain/blockState'
import { transformDirection, transformPoint, transformPos, type BlockTransform } from '../../src/domain/blockTransform'
import { DIRECTIONS } from '../../src/domain/direction'
import type { Vec3 } from '../../src/domain/vec3'
import { blockEntityTypes } from './createBlockCatalog'
import { ITEM_PATH_ROLES } from './itemPathRoles'

/**
 * 真ん中に置いて6つの面にチェストを並べる置き方（createItemPathStates.test.ts）で、物が流れるはずのブロック。
 * ほかのたどるブロックは、ブロックごとの置き方（createItemPathLayouts.test.ts）で確かめる
 */
export const FLOWS_HERE: readonly string[] = [
  'create:belt',
  'create:andesite_funnel',
  'create:brass_funnel',
  'create:chute',
  'create:smart_chute',
  'create:weighted_ejector',
]

/** 物の通り道でたどるブロック（ITEM_PATH_ROLES が traced の種類のブロック） */
export function tracedBlocks(): string[] {
  const ids = new Set<string>()
  for (const [type, blocks] of blockEntityTypes()) {
    if (ITEM_PATH_ROLES[type.replace(/^create:/, '')]?.role === 'traced') for (const b of blocks) ids.add(b)
  }
  return [...ids].sort()
}

/**
 * まわした・反転したあとも同じ向きに回るための、仮の動力源の回転数の符号。
 * 回転数は「軸の正の向きから見て」なので、軸の正の向きが負の向きに移れば符号が変わる。反転は回る向きを逆にする
 */
export function rpmSign(state: BlockState, t: BlockTransform): number {
  const shape = kineticShape(state.id.path, state)
  if (!shape) return 1
  const moved = transformDirection(t, axisDirections(shape.axis)[0])
  const positive = DIRECTIONS.indexOf(moved) % 2 === 1
  return (positive ? 1 : -1) * (t.mirror === 'none' ? 1 : -1)
}

const key = (v: Vec3): string => v.join(',')

/** 物のつながり（from → to）。t があれば、位置をまわしてから並べる */
export function itemLinks(r: CalcResult, t?: BlockTransform): string[] {
  const move = (v: Vec3): Vec3 => (t ? transformPos(t, v) : v)
  return (r.links ?? [])
    .filter((l) => l.kind === 'item')
    .map((l) => `${key(move(l.from))}→${key(move(l.to))}`)
    .sort()
}

/** 小数の誤差をならす */
const num = (n: number): string => (Math.round(n * 1e6) / 1e6).toString()

/**
 * 物の動き（どこからどこへ、何を、何個/秒、移動の秒数、止まる秒数、道の形）。t があれば、位置と道の点をまわしてから並べる
 */
export function itemMoves(r: CalcResult, t?: BlockTransform): string[] {
  const pos = (v: Vec3): Vec3 => (t ? transformPos(t, v) : v)
  const point = (v: Vec3): string => (t ? transformPoint(t, v) : v).map(num).join(',')
  return (r.itemMoves ?? [])
    .map((m) => {
      const path = m.path ? ` 道 ${m.path.map((p) => `${num(p.t)}@${point(p.pos)}`).join(' ')}` : ''
      return `${key(pos(m.from))}→${key(pos(m.to))} ${m.item} ${num(m.rate)}個/秒 ${num(m.seconds)}秒 止まる${num(m.hold)}秒${path}`
    })
    .sort()
}
