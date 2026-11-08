import { describe, expect, it } from 'vitest'
import type { CalcItemMove } from './calcPlugin'
import { itemDotsAt, MAX_DOTS_PER_BLOCK, MAX_ITEM_DOTS, timeItemMoves } from './itemFlowDots'

const move = (from: [number, number, number], to: [number, number, number], over: Partial<CalcItemMove> = {}): CalcItemMove => ({
  from,
  to,
  item: 'minecraft:stone',
  rate: 1,
  speed: 1,
  ...over,
})

describe('timeItemMoves', () => {
  it('物の入口から順に、着くまでの時間を足していく。速さが違えば時間も違う', () => {
    const timed = timeItemMoves([move([0, 0, 0], [1, 0, 0], { speed: 2 }), move([1, 0, 0], [2, 0, 0], { speed: 4 }), move([2, 0, 0], [2, 0, 3])])
    expect(timed.map((t) => t.start)).toEqual([0, 0.5, 0.75])
    expect(timed.map((t) => t.duration)).toEqual([0.5, 0.25, 3])
  })

  it('輪の中だけの動きでも止まらず、時間を割り当てる', () => {
    const timed = timeItemMoves([move([0, 0, 0], [1, 0, 0]), move([1, 0, 0], [0, 0, 0])])
    expect(timed.map((t) => t.start)).toEqual([0, 1])
  })

  it('1ブロックに重なりすぎるときは間引く', () => {
    const [timed] = timeItemMoves([move([0, 0, 0], [1, 0, 0], { rate: 100, speed: 2 })])
    expect(timed!.shownRate).toBe(2 * MAX_DOTS_PER_BLOCK)
  })
})

describe('itemDotsAt', () => {
  it('1 個/秒、1 ブロック/秒なら、ブロックごとに1つ。時間とともに進む', () => {
    const timed = timeItemMoves([move([0, 0, 0], [3, 0, 0])])
    const xs = (t: number) => itemDotsAt(timed, t).map((d) => d.pos[0]).sort((a, b) => a - b)
    expect(xs(10.25)).toEqual([0.75, 1.75, 2.75])
    expect(xs(10.5)).toEqual([1, 2, 3])
  })

  it('間隔は届く数で決まる（2 個/秒なら2倍の数）', () => {
    const timed = timeItemMoves([move([0, 0, 0], [3, 0, 0], { rate: 2 })])
    expect(itemDotsAt(timed, 10.1)).toHaveLength(6)
  })

  it('つながった動きの境目で、印が飛ばない', () => {
    const timed = timeItemMoves([move([0, 0, 0], [1, 0, 0], { speed: 2, rate: 0.5 }), move([1, 0, 0], [1, 2, 0], { speed: 4, rate: 0.5 })])
    // k = 5 の物は時刻 10 に出て、10.5 に境目に着く
    const before = itemDotsAt(timed, 10.49)
    const after = itemDotsAt(timed, 10.51)
    expect(before.some((d) => Math.abs(d.pos[0] - 1.48) < 1e-9 && d.pos[1] === 0.5)).toBe(true)
    expect(after.some((d) => d.pos[0] === 1.5 && Math.abs(d.pos[1] - 0.54) < 1e-9)).toBe(true)
  })

  it('坂は y も動く。物の ID を持つ', () => {
    const timed = timeItemMoves([move([0, 0, 0], [1, 1, 0], { speed: Math.SQRT2, item: 'create:wheat_flour' })])
    const [dot] = itemDotsAt(timed, 10.25)
    expect(dot!.item).toBe('create:wheat_flour')
    expect(dot!.pos[0]).toBeCloseTo(0.75)
    expect(dot!.pos[1]).toBeCloseTo(0.75)
  })

  it('上限を超えて出さない', () => {
    const many = Array.from({ length: 3000 }, (_, i) => move([i, 0, 0], [i + 1, 0, 0]))
    expect(itemDotsAt(timeItemMoves(many), 5000.5).length).toBe(MAX_ITEM_DOTS)
  })
})
