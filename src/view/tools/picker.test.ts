import { describe, expect, it } from 'vitest'
import type { Vec3 } from '../../domain/vec3'
import { castRay, pick2D, pick3D, pickLayerFloor, type PickScene3D } from './picker'

function key(p: Vec3): string {
  return p.join(',')
}

/** 塞がっているマスの一覧から当たり判定の対象を作る */
function scene(size: Vec3, solids: Vec3[], layer: number | null = 0): PickScene3D {
  const set = new Set(solids.map(key))
  return { size, layer, isSolid: (p) => set.has(key(p)) }
}

describe('castRay', () => {
  it('上から下に向けたレイは、ブロックの上の面に当たる', () => {
    const s = scene([4, 4, 4], [[1, 0, 2]])
    const hit = castRay({ origin: [1.5, 10, 2.5], direction: [0, -1, 0] }, s)
    expect(hit?.pos).toEqual([1, 0, 2])
    expect(hit?.face).toBe('up')
  })

  it('各向きから入ると、入った側の面を返す', () => {
    const s = scene([3, 3, 3], [[1, 1, 1]])
    const cases: [Vec3, Vec3, string][] = [
      [[-5, 1.5, 1.5], [1, 0, 0], 'west'],
      [[8, 1.5, 1.5], [-1, 0, 0], 'east'],
      [[1.5, 1.5, -5], [0, 0, 1], 'north'],
      [[1.5, 1.5, 8], [0, 0, -1], 'south'],
      [[1.5, -5, 1.5], [0, 1, 0], 'down'],
      [[1.5, 8, 1.5], [0, -1, 0], 'up'],
    ]
    for (const [origin, direction, face] of cases) {
      const hit = castRay({ origin, direction }, s)
      expect(hit?.pos, face).toEqual([1, 1, 1])
      expect(hit?.face, face).toBe(face)
    }
  })

  it('斜めのレイは、手前のブロックに先に当たる', () => {
    // x 方向に並んだ2つのブロック。斜め上から手前（x=0）のほうに当たる
    const s = scene([4, 2, 1], [
      [0, 0, 0],
      [2, 0, 0],
    ])
    const hit = castRay({ origin: [-1, 3, 0.5], direction: [1, -2, 0] }, s)
    expect(hit?.pos).toEqual([0, 0, 0])
    expect(hit?.face).toBe('up')
  })

  it('途中で軸をまたぐ斜めのレイでも、横の面に当たる', () => {
    const s = scene([4, 1, 1], [[3, 0, 0]])
    const hit = castRay({ origin: [-1, 0.9, 0.5], direction: [4, -0.1, 0] }, s)
    expect(hit?.pos).toEqual([3, 0, 0])
    expect(hit?.face).toBe('west')
  })

  it('隠したブロック（isSolid が false）は通り抜ける', () => {
    const s = scene([1, 3, 1], [[0, 0, 0]])
    const hit = castRay({ origin: [0.5, 5, 0.5], direction: [0, -1, 0] }, s)
    expect(hit?.pos).toEqual([0, 0, 0])
  })

  it('範囲の外を通るレイや、反対を向いたレイは当たらない', () => {
    const s = scene([2, 2, 2], [[0, 0, 0]])
    expect(castRay({ origin: [5, 5, 5], direction: [1, 0, 0] }, s)).toBeNull()
    expect(castRay({ origin: [0.5, 5, 0.5], direction: [0, 1, 0] }, s)).toBeNull()
  })

  it('始点が範囲の中なら、面は決めない', () => {
    const s = scene([1, 1, 1], [[0, 0, 0]])
    const hit = castRay({ origin: [0.5, 0.5, 0.5], direction: [0, -1, 0] }, s)
    expect(hit?.pos).toEqual([0, 0, 0])
    expect(hit?.face).toBeUndefined()
  })
})

describe('pickLayerFloor', () => {
  it('段の床（y = layer）と交わるマスを返す', () => {
    expect(pickLayerFloor({ origin: [2.5, 10, 1.5], direction: [0, -1, 0] }, [4, 4, 4], 2)?.pos).toEqual([2, 2, 1])
  })

  it('範囲の外、後ろ向き、水平のレイは null', () => {
    expect(pickLayerFloor({ origin: [9.5, 10, 1.5], direction: [0, -1, 0] }, [4, 4, 4], 0)).toBeNull()
    expect(pickLayerFloor({ origin: [1.5, 10, 1.5], direction: [0, 1, 0] }, [4, 4, 4], 0)).toBeNull()
    expect(pickLayerFloor({ origin: [1.5, 10, 1.5], direction: [1, 0, 0] }, [4, 4, 4], 0)).toBeNull()
  })
})

describe('pick3D', () => {
  it('ブロックに当たれば、ブロックと面を返す', () => {
    const s = scene([4, 4, 4], [[1, 0, 1]], 1)
    expect(pick3D({ origin: [1.5, 10, 1.5], direction: [0, -1, 0] }, s)).toEqual({ pos: [1, 0, 1], face: 'up', point: [1.5, 1, 1.5], empty: false })
  })

  it('当たらなければ、今の段の床の空きマスを返す', () => {
    const s = scene([4, 4, 4], [], 2)
    expect(pick3D({ origin: [3.5, 10, 0.5], direction: [0, -1, 0] }, s)).toEqual({ pos: [3, 2, 0], empty: true })
  })

  it('今の段の床より奥のブロックより、床の空きマスを優先する', () => {
    const s = scene([4, 4, 4], [[1, 0, 1]], 2)
    expect(pick3D({ origin: [1.5, 10, 1.5], direction: [0, -1, 0] }, s)).toEqual({ pos: [1, 2, 1], empty: true })
  })

  it('段がなく、何にも当たらなければ null', () => {
    expect(pick3D({ origin: [1.5, 10, 1.5], direction: [0, -1, 0] }, scene([4, 4, 4], [], null))).toBeNull()
  })
})

describe('pick2D', () => {
  const grid = { originX: 10, originY: 20, cellSize: 16 }
  const filled = new Set(['1,3,2'])
  const s = { size: [4, 5, 4] as Vec3, layer: 3, isFilled: (p: Vec3) => filled.has(key(p)) }

  it('横が x、縦が z のマス目を返す', () => {
    expect(pick2D(10 + 16 + 5, 20 + 32 + 1, grid, s)).toEqual({ pos: [1, 3, 2], empty: false })
    expect(pick2D(10, 20, grid, s)).toEqual({ pos: [0, 3, 0], empty: true })
  })

  it('マス目の外は null', () => {
    expect(pick2D(9, 30, grid, s)).toBeNull()
    expect(pick2D(10 + 16 * 4, 30, grid, s)).toBeNull()
  })

  it('余白（margin）があれば、マス目のすぐ外を空きマスとして返す（置くツール。#191）', () => {
    const m = { ...s, margin: 1 }
    expect(pick2D(9, 30, grid, m)).toEqual({ pos: [-1, 3, 0], empty: true })
    expect(pick2D(10 + 16 * 4, 20 + 16 * 4, grid, m)).toEqual({ pos: [4, 3, 4], empty: true })
    expect(pick2D(10 - 17, 30, grid, m)).toBeNull()
  })
})

describe('pick3D の当たった点（#123）', () => {
  it('面に当たったときは、当たった点のワールド座標を返す', () => {
    const scene = { size: [3, 3, 3] as const, layer: null, isSolid: (p: readonly number[]) => p[0] === 1 && p[1] === 1 && p[2] === 1 }
    const hit = pick3D({ origin: [1.25, 10, 1.75], direction: [0, -1, 0] }, scene)
    expect(hit?.face).toBe('up')
    expect(hit?.point?.map((v) => Math.round(v * 1000) / 1000)).toEqual([1.25, 2, 1.75])
  })
})
