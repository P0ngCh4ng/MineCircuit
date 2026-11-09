// 物の流れの表示（#231、docs/ui.md「物の流れ」）。計算プラグインが返した物の動きから、ある時刻の物の印の位置を求める。
// 今の計算と同じ一定の流れの見た目で、詰まりや満杯は扱わない。Mod によらない。

import type { Vec3 } from '../domain/vec3'
import type { CalcItemMove } from './calcPlugin'

/** 一度に出す印の上限。超えた分は描かない */
export const MAX_ITEM_DOTS = 2000
/** 1ブロックに出す印の上限。届く数が多くて重なるときは間引く */
export const MAX_DOTS_PER_BLOCK = 4

/** 物の印1つ。pos はブロック座標の連続値（ブロック p の中心は p + 0.5） */
export interface ItemDot {
  readonly pos: Vec3
  readonly item: string
}

/** 時間を割り当てた物の動き */
export interface TimedItemMove {
  readonly move: CalcItemMove
  /** 物の入口を出てから、この動きの始めに着くまでの秒数 */
  readonly start: number
  /** この動きにかかる秒数 */
  readonly duration: number
  /** 間引いたあとの 個/秒 */
  readonly shownRate: number
}

const key = (p: Vec3): string => `${p[0]},${p[1]},${p[2]}`

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
}

/**
 * それぞれの動きに、物の入口から着くまでの時間を割り当てる。
 * どの動きの行き先にもなっていない位置から順にたどる。輪の中だけの動きは 0 から始める
 */
export function timeItemMoves(moves: readonly CalcItemMove[]): TimedItemMove[] {
  const durations = moves.map((m) => distance(m.from, m.to) / m.speed)
  const outgoing = new Map<string, number[]>()
  const destinations = new Set<string>()
  moves.forEach((m, i) => {
    outgoing.set(key(m.from), [...(outgoing.get(key(m.from)) ?? []), i])
    destinations.add(key(m.to))
  })
  const starts = new Array<number | null>(moves.length).fill(null)
  const queue: number[] = []
  const walk = (): void => {
    while (queue.length > 0) {
      const i = queue.shift()!
      for (const next of outgoing.get(key(moves[i]!.to)) ?? []) {
        if (starts[next] !== null) continue
        starts[next] = starts[i]! + durations[i]!
        queue.push(next)
      }
    }
  }
  moves.forEach((m, i) => {
    if (destinations.has(key(m.from))) return
    starts[i] = 0
    queue.push(i)
  })
  walk()
  moves.forEach((_, i) => {
    if (starts[i] !== null) return
    starts[i] = 0
    queue.push(i)
    walk()
  })
  return moves.map((move, i) => ({
    move,
    start: starts[i]!,
    duration: durations[i]!,
    shownRate: Math.min(move.rate, move.speed * MAX_DOTS_PER_BLOCK),
  }))
}

/**
 * 時刻 time（秒）の物の印。k 番目の物は時刻 k / 個/秒 に物の入口を出たものとして、
 * 動きの中で、出てからの時間が start から start + duration の間にある物を並べる
 */
export function itemDotsAt(moves: readonly TimedItemMove[], time: number): ItemDot[] {
  const dots: ItemDot[] = []
  for (const { move, start, duration, shownRate } of moves) {
    const elapsed = time - start
    for (let k = Math.floor(elapsed * shownRate); k / shownRate > elapsed - duration; k--) {
      if (dots.length >= MAX_ITEM_DOTS) return dots
      const t = (elapsed - k / shownRate) / duration
      dots.push({
        item: move.item,
        pos: [
          move.from[0] + 0.5 + (move.to[0] - move.from[0]) * t,
          move.from[1] + 0.5 + (move.to[1] - move.from[1]) * t,
          move.from[2] + 0.5 + (move.to[2] - move.from[2]) * t,
        ],
      })
    }
  }
  return dots
}
