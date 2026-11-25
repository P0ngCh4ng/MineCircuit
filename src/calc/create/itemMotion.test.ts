import { describe, expect, it } from 'vitest'
import { throwPath } from './itemMotion'

describe('放り出した物の道', () => {
  it('落ちる動きを数える上限（200 tick）までに届かなければ、最後に end の高さを足す', () => {
    const { path, seconds } = throwPath([0, 0, 0], [4, -1000, 0], 0)
    expect(path).toHaveLength(202)
    expect(seconds).toBe(201 / 20)
    expect(path.at(-1)?.pos).toEqual([4, -1000, 0])
    expect(path[200]!.pos[1]).toBeGreaterThan(-1000)
  })

  it('end の高さに届いたら、そこで止める', () => {
    const { path } = throwPath([0, 1, 0], [2, 0, 0], 0)
    expect(path[0]!.pos).toEqual([0, 1, 0])
    expect(path.at(-1)!.pos).toEqual([2, 0, 0])
    expect(path.slice(0, -1).every((p) => p.pos[1] > 0)).toBe(true)
  })
})
