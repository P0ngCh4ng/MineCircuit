import { describe, expect, it } from 'vitest'
import type { Vec3 } from '../domain/vec3'
import type { CalcLink } from './calcPlugin'
import { traceFlow, type FlowTrace } from './flowTrace'

const power = (from: Vec3, to: Vec3): CalcLink => ({ from, to, kind: 'power' })
const item = (from: Vec3, to: Vec3): CalcLink => ({ from, to, kind: 'item' })
const arrows = (t: FlowTrace | null) => t?.arrows.map((a) => `${a.from.join(',')}>${a.to.join(',')}`) ?? null

// 動力源 0 からシャフトが 1, 2 と続き、2 から 3 と 4 に分かれる。5 はつながっていない
const P = (x: number): Vec3 => [x, 0, 0]
const LINKS = [power(P(1), P(0)), power(P(1), P(2)), power(P(2), P(3)), power(P(4), P(2))]

describe('traceFlow（#207）', () => {
  it('動力源を選ぶと、つながりの元から先への向きで、先すべてへの矢印を出す', () => {
    const t = traceFlow(LINKS, [P(0)], P(0))
    expect(arrows(t)?.sort()).toEqual(['0,0,0>1,0,0', '1,0,0>2,0,0', '2,0,0>3,0,0', '2,0,0>4,0,0'])
    expect(t?.blocks).toHaveLength(5)
  })

  it('途中のブロックを選ぶと、動力源からそこまでの道だけを出す', () => {
    const t = traceFlow(LINKS, [P(0)], P(4))
    expect(arrows(t)).toEqual(['0,0,0>1,0,0', '1,0,0>2,0,0', '2,0,0>4,0,0'])
    expect(t?.blocks.map((b) => b[0])).toEqual([0, 1, 2, 4])
  })

  it('動力源が2つあれば、近い方からの道', () => {
    expect(arrows(traceFlow(LINKS, [P(0), P(3)], P(4)))).toEqual(['3,0,0>2,0,0', '2,0,0>4,0,0'])
  })

  it('動力源につながっていない・つながりのないブロックは null', () => {
    expect(traceFlow(LINKS, [], P(2))).toBeNull()
    expect(traceFlow(LINKS, [P(0)], P(5))).toBeNull()
  })

  it('つながりのない動力源も null', () => {
    expect(traceFlow([], [P(0)], P(0))).toBeNull()
  })

  it('物のつながりがあるブロック（ベルト）は、つながった物の向きすべて', () => {
    const belt = [item(P(0), P(1)), item(P(1), P(2)), item(P(2), P(3)), item(P(7), P(8))]
    const t = traceFlow([...LINKS, ...belt], [P(0)], P(1))
    expect(arrows(t)).toEqual(['0,0,0>1,0,0', '1,0,0>2,0,0', '2,0,0>3,0,0'])
    expect(t?.arrows.every((a) => a.kind === 'item')).toBe(true)
  })
})
