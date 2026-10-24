import { describe, expect, it } from 'vitest'
import { cubeModel, fakeAppearances, meshModel, shaftModel, single } from '../../../tests/fixtures/fakeAppearance'
import type { BlockAppearance, ResolvedModel } from '../../domain/blockModel'
import { faceTurnedUp, topFaces } from './topFace2D'

const appearance = (key: string): BlockAppearance => {
  const a = fakeAppearances()[key]
  if (!a) throw new Error(key)
  return a
}

describe('faceTurnedUp', () => {
  it('置き方の x で、もとのどの面が上を向くかを返す（Minecraft の blockstates と同じ向き）', () => {
    expect(faceTurnedUp(0, 0)).toBe('up')
    // x=90 で上の面は北へ、南の面が上へ
    expect(faceTurnedUp(90, 0)).toBe('south')
    expect(faceTurnedUp(180, 0)).toBe('down')
    expect(faceTurnedUp(270, 0)).toBe('north')
  })

  it('y は上下を変えない', () => {
    for (const y of [0, 90, 180, 270] as const) expect(faceTurnedUp(0, y)).toBe('up')
    expect(faceTurnedUp(90, 90)).toBe('south')
  })
})

describe('topFaces', () => {
  it('立方体は上の面をマス全体に描く', () => {
    const faces = topFaces(appearance('test:red_block'))
    expect(faces).toHaveLength(1)
    expect(faces[0]).toMatchObject({ texture: 'test:block/red', x0: 0, z0: 0, x1: 16, z1: 16, top: 16, rotation: 0 })
  })

  it('上下と横で違う丸太：縦置きは上の面、横置き（x=90, y=90）は横の面が上に来る', () => {
    expect(topFaces(appearance('test:log[axis=y]'))[0]?.texture).toBe('test:block/blue')
    const lying = topFaces(appearance('test:log[axis=x]'))
    expect(lying).toHaveLength(1)
    expect(lying[0]).toMatchObject({ texture: 'test:block/green', x0: 0, z0: 0, x1: 16, z1: 16, rotation: 90 })
  })

  it('シャフトは真ん中の範囲だけ。縦置きは端の面、横置きは側面が上に来る', () => {
    expect(topFaces(appearance('test:shaft[axis=y]'))).toEqual([
      expect.objectContaining({ texture: 'test:block/shaft_end', uv: [6, 6, 10, 10], x0: 6, z0: 6, x1: 10, z1: 10, top: 16 }),
    ])
    // axis=z（x=90）：柱が南北に寝て、南の面（側面）が上を向く
    expect(topFaces(appearance('test:shaft[axis=z]'))).toEqual([
      expect.objectContaining({ texture: 'test:block/shaft', x0: 6, z0: 0, x1: 10, z1: 16, top: 10 }),
    ])
  })

  it('multipart は低いものから順に並べる（後のものが上に描かれる）', () => {
    const faces = topFaces(appearance('test:fence'))
    expect(faces.map((f) => f.texture)).toEqual(['test:block/blue', 'test:block/shaft_end'])
    expect(faces[0]!.top).toBeLessThan(faces[1]!.top)
  })

  it('y の回転は絵の向きに足す。uvlock なら足さない', () => {
    const model = cubeModel('test:block/m', { all: 'test:block/red' })
    expect(topFaces(single(model, 0, 270))[0]?.rotation).toBe(270)
    expect(topFaces({ parts: [{ model, x: 0, y: 90, uvlock: true }] })[0]?.rotation).toBe(0)
  })

  it('上を向く面がなければ、いちばん高い要素の面を使う', () => {
    const cross: ResolvedModel = {
      id: 'test:block/cross',
      meshes: [],
      ambientOcclusion: false,
      elements: [
        {
          from: [0, 0, 8],
          to: [16, 12, 8],
          rotation: null,
          shade: false,
          faces: { north: { texture: 'test:block/green', uv: [0, 0, 16, 16], rotation: 0, cullface: null, tintIndex: null } },
        },
      ],
    }
    expect(topFaces(single(cross))).toEqual([expect.objectContaining({ texture: 'test:block/green', top: 12 })])
  })

  it('描くものがなければ空', () => {
    expect(topFaces({ parts: [] })).toEqual([])
    // 面を1つも持たない要素だけなら空
    const sideOnly: ResolvedModel = { ...shaftModel(), elements: [{ ...shaftModel().elements[0]!, faces: {} }] }
    expect(topFaces(single(sideOnly))).toEqual([])
  })
})

describe('topFaces（OBJ の三角形）', () => {
  it('上を向く三角形を、真上から見た範囲とテクスチャの範囲の面にする', () => {
    expect(topFaces(single(meshModel()))).toEqual([
      { texture: 'test:block/blue', uv: [0, 0, 16, 16], rotation: 0, tintIndex: null, x0: 0, z0: 0, x1: 8, z1: 8, top: 4 },
    ])
    // y=90 で北西の角が北東へ
    expect(topFaces(single(meshModel(), 0, 90))[0]).toMatchObject({ x0: 8, z0: 0, x1: 16, z1: 8, rotation: 90 })
    // x=180 で下を向くので、上から見える面はない（要素がないので代わりの面もない）
    expect(topFaces(single(meshModel(), 180, 0))).toEqual([])
  })
})
