// 仮定の一覧（docs/design.md「設計図に入っていない情報」）。
// 推測で埋めた値は必ずここに記録し、計算結果の assumptions に載せる。

import type { Vec3 } from '../domain/vec3'
import type { CalcAssumption } from './calcPlugin'
import { resolveWith, type Resolved, type ValueCandidate } from './provenance'

export class AssumptionLog {
  private readonly items: CalcAssumption[] = []
  private readonly seen = new Set<string>()

  /** 仮定を足す。同じ位置・同じ文の仮定は1つにまとめる */
  add(message: string, pos?: Vec3): void {
    const key = pos ? `${pos.join(',')}|${message}` : `|${message}`
    if (this.seen.has(key)) return
    this.seen.add(key)
    this.items.push(pos ? { pos: [pos[0], pos[1], pos[2]], message } : { message })
  }

  /**
   * 候補を順に調べて値を決める。どれにもなく fallback を使い、その出どころが 'assumed' なら、
   * fallback.note（なければ「値がないので仮定した」）を仮定に足す。
   */
  resolve<T>(candidates: readonly ValueCandidate<T>[], fallback: Resolved<T>, pos?: Vec3): Resolved<T> {
    const result = resolveWith(candidates, fallback)
    if (result.source === 'assumed') this.add(result.note ?? '値がないので仮定した', pos)
    return result
  }

  get size(): number {
    return this.items.length
  }

  /** 足した順の一覧（写し） */
  list(): CalcAssumption[] {
    return [...this.items]
  }
}
