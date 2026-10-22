import { describe, expect, it } from 'vitest'
import {
  cubeModel,
  fakeAppearances,
  fakeAtlas,
  shaftModel,
  single,
} from '../../../tests/fixtures/fakeAppearance'
import type { BlockAppearance, ModelFace, ResolvedModel, TextureAtlas } from '../../domain/blockModel'
import type { Direction } from '../../domain/direction'
import { buildModelGeometry, cullableMask, cullBit, isOpaqueFullCube, isTextureOpaque, MODEL_SCALE, OpaqueCubeCache, placedDirection, type ModelGeometryData } from './modelGeometry'

const atlas = fakeAtlas()
const look = fakeAppearances()
const H = 0.5 * MODEL_SCALE

/** 面（4頂点）ごとに分けた頂点データ */
interface Quad {
  normal: [number, number, number]
  corners: [number, number, number][]
  uvs: [number, number][]
  color: [number, number, number]
}

function quads(g: ModelGeometryData): Quad[] {
  const result: Quad[] = []
  for (let f = 0; f < g.positions.length / 12; f++) {
    const v = (i: number) => f * 4 + i
    const at = (arr: Float32Array, i: number, n: number) => [...arr.slice(v(i) * n, v(i) * n + n)]
    result.push({
      normal: at(g.normals, 0, 3) as [number, number, number],
      corners: [0, 1, 2, 3].map((i) => at(g.positions, i, 3) as [number, number, number]),
      uvs: [0, 1, 2, 3].map((i) => at(g.uvs, i, 2) as [number, number]),
      color: at(g.colors, 0, 3) as [number, number, number],
    })
  }
  return result
}

function near(a: readonly number[], b: readonly number[], eps = 1e-4): boolean {
  return a.length === b.length && a.every((x, i) => Math.abs(x - b[i]!) < eps)
}

/** 法線が n の面 */
function faceWithNormal(g: ModelGeometryData, n: [number, number, number]): Quad {
  const q = quads(g).find((f) => near(f.normal, n))
  if (!q) throw new Error(`法線 ${n} の面がありません`)
  return q
}

/** uv がどのテクスチャの範囲にあるか */
function textureAt(a: TextureAtlas, uv: readonly [number, number]): string {
  for (const [id, r] of Object.entries(a.regions)) {
    if (uv[0] >= r.u0 && uv[0] <= r.u1 && uv[1] >= r.v0 && uv[1] <= r.v1) return id
  }
  return 'missing'
}

/** 面の中のテクスチャ座標（0〜16）に戻す */
function localUv(a: TextureAtlas, texture: string, uv: readonly [number, number]): [number, number] {
  const r = a.regions[texture] ?? a.missing
  return [((uv[0] - r.u0) / (r.u1 - r.u0)) * 16, ((uv[1] - r.v0) / (r.v1 - r.v0)) * 16]
}

function oneFaceModel(dir: Direction, face: Partial<ModelFace>): ResolvedModel {
  const f: ModelFace = { texture: 'test:block/red', uv: [0, 0, 16, 16], rotation: 0, cullface: null, tintIndex: null, ...face }
  return { id: 'test:block/one', elements: [{ from: [0, 0, 0], to: [16, 16, 16], rotation: null, shade: true, faces: { [dir]: f } }], ambientOcclusion: true }
}

describe('buildModelGeometry', () => {
  it('立方体は6面・24頂点・12三角形で、ブロックの中心を原点に -0.5〜0.5 に収まる', () => {
    const g = buildModelGeometry(look['test:red_block']!, atlas)
    expect(g.positions.length).toBe(24 * 3)
    expect(g.indices.length).toBe(36)
    expect(Math.max(...g.positions)).toBeCloseTo(H)
    expect(Math.min(...g.positions)).toBeCloseTo(-H)
    for (const q of quads(g)) expect(textureAt(atlas, q.uvs[0]!)).toBe('test:block/red')
  })

  it('三角形は外から見て反時計回り（法線の向きと面の向きが合う）', () => {
    const g = buildModelGeometry(look['test:fence']!, atlas)
    for (let t = 0; t < g.indices.length; t += 3) {
      const p = [0, 1, 2].map((k) => [...g.positions.slice(g.indices[t + k]! * 3, g.indices[t + k]! * 3 + 3)])
      const a = p[1]!.map((v, i) => v - p[0]![i]!)
      const b = p[2]!.map((v, i) => v - p[0]![i]!)
      const cross = [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!]
      const n = [...g.normals.slice(g.indices[t]! * 3, g.indices[t]! * 3 + 3)]
      expect(cross[0]! * n[0]! + cross[1]! * n[1]! + cross[2]! * n[2]!).toBeGreaterThan(0)
    }
  })

  it('上の面は、北西の角がテクスチャの左上（u は東へ、v は南へ増える）', () => {
    const top = faceWithNormal(buildModelGeometry(look['test:red_block']!, atlas), [0, 1, 0])
    const nw = top.corners.findIndex((c) => near(c, [-H, H, -H]))
    const se = top.corners.findIndex((c) => near(c, [H, H, H]))
    expect(near(localUv(atlas, 'test:block/red', top.uvs[nw]!), [0, 0], 0.01)).toBe(true)
    expect(near(localUv(atlas, 'test:block/red', top.uvs[se]!), [16, 16], 0.01)).toBe(true)
  })

  it('横の面は、上がテクスチャの上。北の面は外から見て東が左', () => {
    const north = faceWithNormal(buildModelGeometry(look['test:red_block']!, atlas), [0, 0, -1])
    const topEast = north.corners.findIndex((c) => near(c, [H, H, -H]))
    expect(near(localUv(atlas, 'test:block/red', north.uvs[topEast]!), [0, 0], 0.01)).toBe(true)
  })

  it('面の uv の範囲と回転を当てる（rotation 90 でテクスチャの左上が面の右上へ）', () => {
    const g = buildModelGeometry(single(oneFaceModel('south', { uv: [4, 0, 12, 8], rotation: 90 })), atlas)
    const [q] = quads(g)
    // 南の面を外から見て、右上は東の上
    const topRight = q!.corners.findIndex((c) => near(c, [H, H, H]))
    expect(near(localUv(atlas, 'test:block/red', q!.uvs[topRight]!), [4, 0], 0.01)).toBe(true)
    const topLeft = q!.corners.findIndex((c) => near(c, [-H, H, H]))
    expect(near(localUv(atlas, 'test:block/red', q!.uvs[topLeft]!), [4, 8], 0.01)).toBe(true)
  })

  it('PlacedModel の x=90, y=90 で、原木の上の面が東を向く（axis=x）', () => {
    const g = buildModelGeometry(look['test:log[axis=x]']!, atlas)
    const east = faceWithNormal(g, [1, 0, 0])
    expect(textureAt(atlas, east.uvs[0]!)).toBe('test:block/blue')
    // 偽の原木の下の面は横と同じ緑。下の面は西を向く
    expect(textureAt(atlas, faceWithNormal(g, [-1, 0, 0]).uvs[0]!)).toBe('test:block/green')
    expect(textureAt(atlas, faceWithNormal(g, [0, 1, 0]).uvs[0]!)).toBe('test:block/green')
  })

  it('向きの回転は Minecraft と同じ（y=90 で北が東、x=90 で上が北）', () => {
    const part = (x: 0 | 90 | 180 | 270, y: 0 | 90 | 180 | 270) => ({ model: shaftModel(), x, y, uvlock: false })
    expect(placedDirection('north', part(0, 90))).toBe('east')
    expect(placedDirection('up', part(90, 0))).toBe('north')
    expect(placedDirection('up', part(90, 90))).toBe('east')
    expect(placedDirection('west', part(0, 180))).toBe('east')
  })

  it('x=90 のシャフトは z 方向に伸び、端の面が南北を向く', () => {
    const g = buildModelGeometry(look['test:shaft[axis=z]']!, atlas)
    const zs = quads(g).flatMap((q) => q.corners.map((c) => c[2]))
    const xs = quads(g).flatMap((q) => q.corners.map((c) => c[0]))
    expect(Math.max(...zs)).toBeCloseTo(H)
    expect(Math.min(...zs)).toBeCloseTo(-H)
    expect(Math.max(...xs)).toBeCloseTo((2 / 16) * MODEL_SCALE)
    expect(textureAt(atlas, faceWithNormal(g, [0, 0, -1]).uvs[0]!)).toBe('test:block/shaft_end')
  })

  it('要素の回転（22.5 度）を origin の周りに当てる', () => {
    const g = buildModelGeometry(look['test:plate']!, atlas)
    const rad = (22.5 * Math.PI) / 180
    const up = faceWithNormal(g, [0, Math.cos(rad), Math.sin(rad)])
    // 板の上の面の北の端（z=0, y=9）は、中心 (8,8,8) の周りに回って上に上がる
    const ys = up.corners.map((c) => c[1])
    const expected = ((8 * Math.sin(rad) + 1 * Math.cos(rad)) / 16) * MODEL_SCALE
    expect(Math.max(...ys)).toBeCloseTo(expected)
  })

  it('rescale なら、回した軸以外の2軸を 1/cos 倍にする', () => {
    const model: ResolvedModel = {
      ...oneFaceModel('up', {}),
      elements: [
        {
          ...oneFaceModel('up', {}).elements[0]!,
          from: [0, 8, 0],
          to: [16, 8, 16],
          rotation: { origin: [8, 8, 8], axis: 'y', angle: 45, rescale: true },
        },
      ],
    }
    const [q] = quads(buildModelGeometry(single(model), atlas))
    // 45 度回した 16×16 の正方形の角は軸の上の ±8√2。x と z を √2 倍して ±16（ブロック1つ分）になる
    const xs = q!.corners.map((c) => c[0])
    expect(Math.max(...xs)).toBeCloseTo(MODEL_SCALE, 4)
  })

  it('cullface の向き（置いたあとの向き）のビットが立っていれば、その面を省く', () => {
    const cube = look['test:red_block']!
    expect(quads(buildModelGeometry(cube, atlas, cullBit('north') | cullBit('east')))).toHaveLength(4)
    // シャフトの横の面は cullface がないので省かない
    expect(quads(buildModelGeometry(look['test:shaft[axis=y]']!, atlas, cullBit('north')))).toHaveLength(6)
    // axis=z のシャフトの上の端は北を向く。北のビットで省く
    const z = buildModelGeometry(look['test:shaft[axis=z]']!, atlas, cullBit('north'))
    expect(quads(z)).toHaveLength(5)
    expect(quads(z).some((q) => near(q.normal, [0, 0, -1]))).toBe(false)
  })

  it('tintIndex のある面だけに色を掛ける', () => {
    const g = buildModelGeometry(look['test:grass']!, atlas, 0, [0.5, 0.75, 0.25])
    expect(faceWithNormal(g, [0, 1, 0]).color).toEqual([0.5, 0.75, 0.25])
    expect(faceWithNormal(g, [1, 0, 0]).color).toEqual([1, 1, 1])
  })

  it('multipart は部品をすべて重ねる', () => {
    expect(quads(buildModelGeometry(look['test:fence']!, atlas))).toHaveLength(6 + 2)
  })

  it('uvlock なら、回したあとの位置からテクスチャを貼る', () => {
    const model = oneFaceModel('up', { uv: [0, 0, 16, 16] })
    const locked: BlockAppearance = { parts: [{ model, x: 0, y: 90, uvlock: true }] }
    const free: BlockAppearance = { parts: [{ model, x: 0, y: 90, uvlock: false }] }
    const nw = (a: BlockAppearance) => {
      const [q] = quads(buildModelGeometry(a, atlas))
      return localUv(atlas, 'test:block/red', q!.uvs[q!.corners.findIndex((c) => near(c, [-H, H, -H]))]!)
    }
    expect(near(nw(locked), [0, 0], 0.01)).toBe(true)
    // uvlock でなければテクスチャも回る（北西の角は、元の南西の角 = 左下）
    expect(near(nw(free), [0, 16], 0.01)).toBe(true)
  })

  it('アトラスにないテクスチャは missing の範囲を使う', () => {
    const g = buildModelGeometry(single(oneFaceModel('up', { texture: 'test:block/nothing' })), atlas)
    const [q] = quads(g)
    const r = atlas.missing
    expect(q!.uvs.every(([u, v]) => u >= r.u0 && u <= r.u1 && v >= r.v0 && v <= r.v1)).toBe(true)
  })

  it('中身のない見た目は空の形になる', () => {
    expect(buildModelGeometry({ parts: [] }, atlas).indices.length).toBe(0)
  })
})

describe('不透明な立方体の判定', () => {
  it('回していない 0〜16 の要素で6面がそろい、テクスチャが不透明なら true', () => {
    const cache = new OpaqueCubeCache({ appearances: look, atlas, problems: [] })
    expect(cache.isOpaqueCube(look['test:red_block']!)).toBe(true)
    expect(cache.isOpaqueCube(look['test:log[axis=x]']!)).toBe(true)
    expect(cache.isOpaqueCube(look['test:shaft[axis=y]']!)).toBe(false)
    expect(cache.isOpaqueCube(look['test:plate']!)).toBe(false)
    expect(cache.isOpaqueCube(look['test:fence']!)).toBe(false)
  })

  it('透明なところのあるテクスチャ（葉やガラス）なら false', () => {
    const glassy = fakeAtlas()
    const r = glassy.regions['test:block/red']!
    glassy.pixels[(Math.floor(r.v0 * glassy.height) * glassy.width + Math.floor(r.u0 * glassy.width) + 3) * 4 + 3] = 0
    expect(isTextureOpaque(glassy, 'test:block/red')).toBe(false)
    expect(isTextureOpaque(glassy, 'test:block/blue')).toBe(true)
    const cube = single(cubeModel('test:block/glass', { all: 'test:block/red' }))
    expect(isOpaqueFullCube(cube, (t) => isTextureOpaque(glassy, t))).toBe(false)
  })
})

describe('cullableMask', () => {
  it('cullface を持つ面の、置いたあとの向きを集める', () => {
    expect(cullableMask(look['test:shaft[axis=y]']!)).toBe(cullBit('up') | cullBit('down'))
    expect(cullableMask(look['test:shaft[axis=z]']!)).toBe(cullBit('north') | cullBit('south'))
    expect(cullableMask(look['test:plate']!)).toBe(0)
  })
})
