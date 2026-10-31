// 力の流れの表示に使うつながり（#207、docs/ui.md「力の流れ」）。
// 回転のつながりは応力の計算（kineticGraph.ts）の辺と速度コントローラーから、
// 物の向きはベルトの進む向き（docs/create-throughput.md「物の通り道」と同じ規則）から作る。

import type { Blueprint } from '../../domain/blueprint'
import { directionVector, isDirection, type Direction } from '../../domain/direction'
import { addVec3, type Vec3 } from '../../domain/vec3'
import type { CalcLink } from '../calcPlugin'
import { axisDirections, directionAxis } from './kineticBlocks'
import type { KineticGraph } from './kineticGraph'

const BELT_SLOPES = new Set(['horizontal', 'upward', 'downward'])

export interface FlowLinks {
  readonly links: CalcLink[]
  readonly sources: Vec3[]
}

/**
 * 回転のつながり・ベルトの物の向き・動力源の位置。
 * rpmAt は動いているときの回転数（過負荷・回転数が足りないなら 0）。仮の入出力のノードは、付けたブロックの位置で表す
 */
export function flowLinks(bp: Blueprint, graph: KineticGraph, rpmAt: (pos: Vec3) => number | null): FlowLinks {
  const nodes = graph.nodes
  const links: CalcLink[] = []
  for (const e of graph.edges) {
    const a = nodes[e.a]!
    const b = nodes[e.b]!
    if (a.portId !== null || b.portId !== null) continue
    links.push({ from: copy(a.pos), to: copy(b.pos), kind: 'power' })
  }
  for (const c of graph.controllers) {
    links.push({ from: copy(nodes[c.controller]!.pos), to: copy(nodes[c.cog]!.pos), kind: 'power' })
  }

  // ベルト：辺は後ろの区間から次の区間（facing の向き）へ張ってある
  const moves = new Map<string, Direction>()
  const beltMove = (pos: Vec3): Direction | null => {
    const key = pos.join(',')
    if (moves.has(key)) return moves.get(key)!
    const state = bp.get(pos)
    const facing = state?.properties.facing
    const rpm = rpmAt(pos) ?? 0
    if (!state || !facing || !isDirection(facing) || directionAxis(facing) === 'y') return null
    if (!BELT_SLOPES.has(state.properties.slope ?? 'horizontal') || rpm === 0) return null
    // 進む向きは facing の軸の上で、(回転数 < 0) XOR (軸が X) なら負の向き
    const axis = directionAxis(facing)
    const [positive, negative] = axisDirections(axis)
    const move = rpm < 0 !== (axis === 'x') ? negative : positive
    moves.set(key, move)
    return move
  }
  const hasNext = new Set<string>()
  const belts: Vec3[] = []
  for (const e of graph.edges) {
    if (e.kind !== 'belt') continue
    const back = nodes[e.a]!.pos
    const front = nodes[e.b]!.pos
    const move = beltMove(back)
    if (!move || beltMove(front) !== move) continue
    const facing = bp.get(back)!.properties.facing
    const [from, to] = move === facing ? [back, front] : [front, back]
    links.push({ from: copy(from), to: copy(to), kind: 'item' })
    hasNext.add(from.join(','))
    belts.push(back, front)
  }
  // 端：次の区間がない区間から、端の1つ先（高さは端の区間と同じ）にブロックがあれば渡す
  const ends = new Set<string>()
  for (const pos of belts) {
    const key = pos.join(',')
    if (hasNext.has(key) || ends.has(key)) continue
    ends.add(key)
    const next = addVec3(pos, directionVector(beltMove(pos)!))
    if (bp.get(next)) links.push({ from: copy(pos), to: next, kind: 'item' })
  }

  const sources: Vec3[] = []
  const seen = new Set<string>()
  for (const node of nodes) {
    const key = node.pos.join(',')
    if (!node.source || seen.has(key)) continue
    seen.add(key)
    sources.push(copy(node.pos))
  }
  return { links, sources }
}

function copy(p: Vec3): Vec3 {
  return [p[0], p[1], p[2]]
}
