import { describe, expect, it } from 'vitest'
import { moveVector } from './moveDirection'

describe('moveVector', () => {
  it('2D は画面の上が −Z、右が +X', () => {
    expect(moveVector('up', '2d', [1, 0])).toEqual([0, 0, -1])
    expect(moveVector('down', '2d', [1, 0])).toEqual([0, 0, 1])
    expect(moveVector('right', '2d', [1, 0])).toEqual([1, 0, 0])
    expect(moveVector('left', '2d', [1, 0])).toEqual([-1, 0, 0])
  })

  it('3D はカメラの向きに一番近い x・z の向きを上にする', () => {
    // −Z を向いているとき（北を見ている）は 2D と同じ
    expect(moveVector('up', '3d', [0.2, -1])).toEqual([0, 0, -1])
    expect(moveVector('right', '3d', [0.2, -1])).toEqual([1, 0, 0])
    // +X を向いているとき、右は +Z
    expect(moveVector('up', '3d', [1, 0.3])).toEqual([1, 0, 0])
    expect(moveVector('right', '3d', [1, 0.3])).toEqual([0, 0, 1])
    expect(moveVector('left', '3d', [1, 0.3])).toEqual([0, 0, -1])
  })

  it('Shift+PageUp / PageDown は上下に1段', () => {
    expect(moveVector('raise', '3d', [1, 0])).toEqual([0, 1, 0])
    expect(moveVector('lower', '2d', [1, 0])).toEqual([0, -1, 0])
  })
})
