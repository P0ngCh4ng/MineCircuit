// 選んだブロックから力の流れをたどる（#207、docs/ui.md「力の流れ」）。
// 計算プラグインが返したつながり（CalcLink）と動力源の位置だけを使うので、Mod によらない。

import type { Vec3 } from '../domain/vec3'
import type { CalcLink } from './calcPlugin'

/** 向きの決まった矢印1本 */
export interface FlowArrow {
  readonly from: Vec3
  readonly to: Vec3
  readonly kind: CalcLink['kind']
}

export interface FlowTrace {
  readonly arrows: readonly FlowArrow[]
  /** 矢印が通るブロックの位置（回る向きの印を付ける所） */
  readonly blocks: readonly Vec3[]
}

const key = (p: Vec3): string => `${p[0]},${p[1]},${p[2]}`

/**
 * pos のブロックに関わる流れ。たどれなければ null。
 * - 物のつながりがあるブロック（動いているベルト）：つながった物の向きすべて
 * - 動力源：動力源から外へ、回転のつながりの先すべて
 * - 回転でつながるほかのブロック：一番近い動力源からそのブロックまでの道
 */
export function traceFlow(links: readonly CalcLink[], sources: readonly Vec3[], pos: Vec3): FlowTrace | null {
  const start = key(pos)
  const items = links.filter((l) => l.kind === 'item')
  if (items.some((l) => key(l.from) === start || key(l.to) === start)) return itemChain(items, start)

  const at = new Map<string, Vec3>()
  const adjacency = new Map<string, string[]>()
  const connect = (a: Vec3, b: Vec3): void => {
    at.set(key(a), a)
    at.set(key(b), b)
    adjacency.set(key(a), [...(adjacency.get(key(a)) ?? []), key(b)])
    adjacency.set(key(b), [...(adjacency.get(key(b)) ?? []), key(a)])
  }
  for (const l of links) if (l.kind === 'power') connect(l.from, l.to)
  const sourceKeys = new Set(sources.map(key))
  if (!adjacency.has(start)) return null

  // 幅優先で、たどり着いたつながりの元（parent）を覚える
  const bfs = (roots: readonly string[]): Map<string, string | null> => {
    const parent = new Map<string, string | null>(roots.map((r) => [r, null]))
    const queue = [...roots]
    for (let i = 0; i < queue.length; i++) {
      for (const next of adjacency.get(queue[i]!) ?? []) {
        if (parent.has(next)) continue
        parent.set(next, queue[i]!)
        queue.push(next)
      }
    }
    return parent
  }
  const arrow = (from: string, to: string): FlowArrow => ({ from: at.get(from)!, to: at.get(to)!, kind: 'power' })

  if (sourceKeys.has(start)) {
    const parent = bfs([start])
    const arrows: FlowArrow[] = []
    for (const [child, p] of parent) if (p !== null) arrows.push(arrow(p, child))
    return { arrows, blocks: [...parent.keys()].map((k) => at.get(k)!) }
  }

  const parent = bfs([...sourceKeys].filter((s) => adjacency.has(s)))
  if (!parent.has(start)) return null
  const arrows: FlowArrow[] = []
  const blocks: Vec3[] = [at.get(start)!]
  for (let cur = start, p = parent.get(cur); p !== null && p !== undefined; cur = p, p = parent.get(cur)) {
    arrows.unshift(arrow(p, cur))
    blocks.unshift(at.get(p)!)
  }
  return { arrows, blocks }
}

/** start を含む、物のつながりのまとまり（向きは問わずにたどる） */
function itemChain(items: readonly CalcLink[], start: string): FlowTrace {
  const reached = new Set([start])
  const chosen = new Set<CalcLink>()
  let grew = true
  while (grew) {
    grew = false
    for (const l of items) {
      if (chosen.has(l) || !(reached.has(key(l.from)) || reached.has(key(l.to)))) continue
      chosen.add(l)
      reached.add(key(l.from))
      reached.add(key(l.to))
      grew = true
    }
  }
  const arrows = items.filter((l) => chosen.has(l)).map((l) => ({ from: l.from, to: l.to, kind: l.kind }))
  const blocks = new Map<string, Vec3>()
  for (const a of arrows) {
    blocks.set(key(a.from), a.from)
    blocks.set(key(a.to), a.to)
  }
  return { arrows, blocks: [...blocks.values()] }
}
