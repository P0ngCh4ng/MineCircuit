// ブロックの見た目（BlockAppearance）から、描く形の頂点データを作る。Three.js に依存しない部分。
// BlueprintMeshBuilder がこの結果を BufferGeometry にし、見た目ごとに InstancedMesh で描く（#84）。
//
// 約束は src/domain/blockModel.ts。Minecraft のモデルと同じ規則で作る。
// - 要素の座標は 0〜16。from〜to の直方体の、faces にある面だけを描く
// - 面の uv は 0〜16 の [u1, v1, u2, v2]。面を外から見て、左上が (u1, v1)、右下が (u2, v2)
// - 面の rotation はテクスチャを時計回りに回す
// - 要素の rotation は origin を中心に右手系で回す。rescale なら回した軸以外の2軸を 1/cos 倍にする
// - PlacedModel の x・y は、ブロックの中心を軸に x を先に、次に y を回す（matrix があれば、そのあとに当てる）。向きは Minecraft と同じく
//   正の軸から見て時計回り（y=90 で北が東になる。x=90 で上が北になる）
// - uvlock なら、回したあとの位置からテクスチャを貼り直し、向きを世界に合わせる
// - OBJ のモデルの三角形（ModelMesh）は、置き方の回転だけを当てて、そのまま描く。隣のブロックで隠さない
// 頂点の座標はブロックの中心を原点にしたブロック単位（-0.5〜0.5）。

import type {
  AppearanceSet,
  AtlasRegion,
  BlockAppearance,
  ModelElementRotation,
  ModelFace,
  ModelMesh,
  PlacedModel,
  TextureAtlas,
} from '../../domain/blockModel'
import { DIRECTIONS, directionVector, type Direction } from '../../domain/direction'
import { rotateVector } from '../../domain/rotation3'

type Mutable3 = [number, number, number]

/** BufferGeometry にそのまま入れられる頂点データ */
export interface ModelGeometryData {
  /** 頂点の位置。[x, y, z, …] */
  readonly positions: Float32Array
  /** 頂点の法線 */
  readonly normals: Float32Array
  /** アトラスの中の座標。[u, v, …]。v は上が 0（DataTexture を flipY なしで使う） */
  readonly uvs: Float32Array
  /** 頂点の色（色付けの掛け算）。[r, g, b, …]。色付けのない面は白 */
  readonly colors: Float32Array
  /** 三角形の頂点番号 */
  readonly indices: Uint32Array
}

/** 描く形の大きさ。隣のブロックとの境目と段のクリッピング面がちょうど重ならないよう、ほんの少し小さくする */
export const MODEL_SCALE = 0.998

/** 色付け（tintIndex）の色。最初は決まった色（草の緑）。バイオームの色は扱わない */
export const GRASS_TINT = 0x91bd59

/** 隣のブロックで隠す向きの印。DIRECTIONS の順のビット */
export function cullBit(dir: Direction): number {
  return 1 << DIRECTIONS.indexOf(dir)
}

/** 面の左上・右上・右下・左下の角（外から見て）。from・to の各軸のどちらを使うかで表す（0 = from、1 = to） */
const FACE_CORNERS: Readonly<Record<Direction, readonly (readonly [number, number, number])[]>> = {
  up: [
    [0, 1, 0],
    [1, 1, 0],
    [1, 1, 1],
    [0, 1, 1],
  ],
  down: [
    [0, 0, 1],
    [1, 0, 1],
    [1, 0, 0],
    [0, 0, 0],
  ],
  north: [
    [1, 1, 0],
    [0, 1, 0],
    [0, 0, 0],
    [1, 0, 0],
  ],
  south: [
    [0, 1, 1],
    [1, 1, 1],
    [1, 0, 1],
    [0, 0, 1],
  ],
  west: [
    [0, 1, 0],
    [0, 1, 1],
    [0, 0, 1],
    [0, 0, 0],
  ],
  east: [
    [1, 1, 1],
    [1, 1, 0],
    [1, 0, 0],
    [1, 0, 1],
  ],
}

/** 右手系で axis の周りに deg 度回す。90 度の倍数は丸めて誤差を出さない */
function rotateAxis(p: Mutable3, axis: 'x' | 'y' | 'z', deg: number): void {
  if (deg === 0) return
  const rad = (deg * Math.PI) / 180
  let c = Math.cos(rad)
  let s = Math.sin(rad)
  if (deg % 90 === 0) {
    c = Math.round(c)
    s = Math.round(s)
  }
  const [x, y, z] = p
  if (axis === 'x') {
    p[1] = y * c - z * s
    p[2] = y * s + z * c
  } else if (axis === 'y') {
    p[0] = x * c + z * s
    p[2] = -x * s + z * c
  } else {
    p[0] = x * c - y * s
    p[1] = x * s + y * c
  }
}

/** 要素の回転を当てる（p は 0〜16 の座標。asPoint が false なら向きだけ回す） */
function applyElementRotation(p: Mutable3, r: ModelElementRotation | null, asPoint: boolean): void {
  if (!r || r.angle === 0) return
  if (asPoint) {
    p[0] -= r.origin[0]
    p[1] -= r.origin[1]
    p[2] -= r.origin[2]
  }
  rotateAxis(p, r.axis, r.angle)
  if (asPoint) {
    if (r.rescale) {
      const k = 1 / Math.cos((Math.abs(r.angle) * Math.PI) / 180)
      if (r.axis !== 'x') p[0] *= k
      if (r.axis !== 'y') p[1] *= k
      if (r.axis !== 'z') p[2] *= k
    }
    p[0] += r.origin[0]
    p[1] += r.origin[1]
    p[2] += r.origin[2]
  }
}

/** PlacedModel の回転を当てる（x を先に、次に y。正の軸から見て時計回り。そのあと matrix） */
function applyPlacedRotation(p: Mutable3, part: PlacedModel, asPoint: boolean): void {
  if (part.x === 0 && part.y === 0 && !part.matrix) return
  if (asPoint) {
    p[0] -= 8
    p[1] -= 8
    p[2] -= 8
  }
  rotateAxis(p, 'x', -part.x)
  rotateAxis(p, 'y', -part.y)
  if (part.matrix) {
    const [x, y, z] = rotateVector(part.matrix, p)
    p[0] = x
    p[1] = y
    p[2] = z
  }
  if (asPoint) {
    p[0] += 8
    p[1] += 8
    p[2] += 8
  }
}

/** ベクトルに一番近い向き */
function nearestDirection(v: Mutable3): Direction {
  let best: Direction = 'up'
  let bestDot = -Infinity
  for (const d of DIRECTIONS) {
    const [x, y, z] = directionVector(d)
    const dot = x * v[0] + y * v[1] + z * v[2]
    if (dot > bestDot) {
      bestDot = dot
      best = d
    }
  }
  return best
}

/** PlacedModel の回転で、モデルの中の向き（cullface など）が世界のどの向きになるか */
export function placedDirection(dir: Direction, part: PlacedModel): Direction {
  const v: Mutable3 = [...directionVector(dir)]
  applyPlacedRotation(v, part, false)
  return nearestDirection(v)
}

/** 向き d の面に、位置（0〜16）から決まるテクスチャの座標（Minecraft の uv を省いたときと同じ） */
function positionalUv(d: Direction, p: Mutable3): [number, number] {
  switch (d) {
    case 'up':
      return [p[0], p[2]]
    case 'down':
      return [p[0], 16 - p[2]]
    case 'north':
      return [16 - p[0], 16 - p[1]]
    case 'south':
      return [p[0], 16 - p[1]]
    case 'west':
      return [p[2], 16 - p[1]]
    case 'east':
      return [16 - p[2], 16 - p[1]]
  }
}

/** 隣のテクセルをにじませないよう、面の端を内側へ寄せる量（0〜16 の座標） */
const UV_INSET = 0.005

function regionOf(atlas: TextureAtlas, texture: string): AtlasRegion {
  return atlas.regions[texture] ?? atlas.missing
}

/**
 * 見た目1つ分の頂点データを作る。
 * culled のビット（cullBit）が立っている世界の向きに cullface を持つ面は描かない。
 * tint は tintIndex のある面に掛ける色（0〜1 の RGB。Three.js では linear の値を渡す）。
 */
export function buildModelGeometry(
  appearance: BlockAppearance,
  atlas: TextureAtlas,
  culled = 0,
  tint: readonly [number, number, number] = [1, 1, 1],
): ModelGeometryData {
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const colors: number[] = []
  const indices: number[] = []

  for (const part of appearance.parts) {
    for (const element of part.model.elements) {
      for (const dir of DIRECTIONS) {
        const face = element.faces[dir]
        if (!face) continue
        if (face.cullface !== null && (culled & cullBit(placedDirection(face.cullface, part))) !== 0) continue
        addFace(face, dir, element.from, element.to, element.rotation, part, atlas, tint, positions, normals, uvs, colors, indices)
      }
    }
    for (const mesh of part.model.meshes) addMesh(mesh, part, atlas, positions, normals, uvs, colors, indices)
  }

  return {
    positions: Float32Array.from(positions),
    normals: Float32Array.from(normals),
    uvs: Float32Array.from(uvs),
    colors: Float32Array.from(colors),
    indices: Uint32Array.from(indices),
  }
}

function addFace(
  face: ModelFace,
  dir: Direction,
  from: readonly number[],
  to: readonly number[],
  rotation: ModelElementRotation | null,
  part: PlacedModel,
  atlas: TextureAtlas,
  tint: readonly [number, number, number],
  positions: number[],
  normals: number[],
  uvs: number[],
  colors: number[],
  indices: number[],
): void {
  const base = positions.length / 3

  // 法線（回転だけ当てる）
  const n: Mutable3 = [...directionVector(dir)]
  applyElementRotation(n, rotation, false)
  applyPlacedRotation(n, part, false)
  const len = Math.hypot(n[0], n[1], n[2]) || 1
  n[0] /= len
  n[1] /= len
  n[2] /= len
  const finalDir = nearestDirection(n)

  // 角の位置（0〜16）
  const corners: Mutable3[] = FACE_CORNERS[dir].map(([a, b, c]) => {
    const p: Mutable3 = [a ? to[0]! : from[0]!, b ? to[1]! : from[1]!, c ? to[2]! : from[2]!]
    applyElementRotation(p, rotation, true)
    applyPlacedRotation(p, part, true)
    return p
  })

  // テクスチャの座標（0〜16）
  let cornerUvs: [number, number][]
  if (part.uvlock && (part.x !== 0 || part.y !== 0)) {
    cornerUvs = corners.map((p) => positionalUv(finalDir, p))
  } else {
    const [u1, v1, u2, v2] = face.uv
    const uvCorners: [number, number][] = [
      [u1, v1],
      [u2, v1],
      [u2, v2],
      [u1, v2],
    ]
    const k = face.rotation / 90
    cornerUvs = [0, 1, 2, 3].map((i) => uvCorners[(i - k + 4) % 4]!)
  }
  const us = cornerUvs.map((c) => c[0])
  const vs = cornerUvs.map((c) => c[1])
  const uMin = Math.min(...us) + UV_INSET
  const uMax = Math.max(...us) - UV_INSET
  const vMin = Math.min(...vs) + UV_INSET
  const vMax = Math.max(...vs) - UV_INSET

  const region = regionOf(atlas, face.texture)
  const color = face.tintIndex !== null ? tint : ([1, 1, 1] as const)

  for (let i = 0; i < 4; i++) {
    const p = corners[i]!
    positions.push((p[0] / 16 - 0.5) * MODEL_SCALE, (p[1] / 16 - 0.5) * MODEL_SCALE, (p[2] / 16 - 0.5) * MODEL_SCALE)
    normals.push(n[0], n[1], n[2])
    const u = Math.min(Math.max(cornerUvs[i]![0], uMin), uMax) / 16
    const v = Math.min(Math.max(cornerUvs[i]![1], vMin), vMax) / 16
    uvs.push(region.u0 + u * (region.u1 - region.u0), region.v0 + v * (region.v1 - region.v0))
    colors.push(color[0], color[1], color[2])
  }
  // 左上・左下・右下、左上・右下・右上（外から見て反時計回り）
  indices.push(base, base + 3, base + 2, base, base + 2, base + 1)
}

/** OBJ のモデルの三角形を足す。テクスチャの座標は 0〜16 の外を端に寄せ、隣のテクセルをにじませない */
function addMesh(
  mesh: ModelMesh,
  part: PlacedModel,
  atlas: TextureAtlas,
  positions: number[],
  normals: number[],
  uvs: number[],
  colors: number[],
  indices: number[],
): void {
  const region = regionOf(atlas, mesh.texture)
  const base = positions.length / 3
  const count = mesh.positions.length / 3
  for (let i = 0; i < count; i++) {
    const p: Mutable3 = [mesh.positions[i * 3]!, mesh.positions[i * 3 + 1]!, mesh.positions[i * 3 + 2]!]
    applyPlacedRotation(p, part, true)
    positions.push((p[0] / 16 - 0.5) * MODEL_SCALE, (p[1] / 16 - 0.5) * MODEL_SCALE, (p[2] / 16 - 0.5) * MODEL_SCALE)
    const n: Mutable3 = [mesh.normals[i * 3]!, mesh.normals[i * 3 + 1]!, mesh.normals[i * 3 + 2]!]
    applyPlacedRotation(n, part, false)
    normals.push(n[0], n[1], n[2])
    const u = Math.min(Math.max(mesh.uvs[i * 2]!, UV_INSET), 16 - UV_INSET) / 16
    const v = Math.min(Math.max(mesh.uvs[i * 2 + 1]!, UV_INSET), 16 - UV_INSET) / 16
    uvs.push(region.u0 + u * (region.u1 - region.u0), region.v0 + v * (region.v1 - region.v0))
    colors.push(1, 1, 1)
    indices.push(base + i)
  }
}

/** 見た目の中の面が持つ cullface の、置いたあとの向き（cullBit の和）。隠せる面がない向きのビットは立たない */
export function cullableMask(appearance: BlockAppearance): number {
  let mask = 0
  for (const part of appearance.parts) {
    for (const e of part.model.elements) {
      for (const d of DIRECTIONS) {
        const c = e.faces[d]?.cullface
        if (c) mask |= cullBit(placedDirection(c, part))
      }
    }
  }
  return mask
}

/**
 * 不透明な立方体なら true。隣のブロックの面を隠す（cullface）かどうかに使う。
 * 回していない 0〜16 の要素があり、6面すべてがそろい、テクスチャに透明なところがないもの
 */
export function isOpaqueFullCube(appearance: BlockAppearance, opaqueTexture: (id: string) => boolean): boolean {
  for (const part of appearance.parts) {
    for (const e of part.model.elements) {
      if (e.rotation && e.rotation.angle !== 0) continue
      if (!isFull(e.from, 0) || !isFull(e.to, 16)) continue
      if (DIRECTIONS.every((d) => e.faces[d] !== undefined && opaqueTexture(e.faces[d].texture))) return true
    }
  }
  return false
}

function isFull(v: readonly number[], value: number): boolean {
  return v[0] === value && v[1] === value && v[2] === value
}

/** アトラスの中のテクスチャがすべて不透明なら true（見つからないテクスチャは missing を調べる） */
export function isTextureOpaque(atlas: TextureAtlas, texture: string): boolean {
  const r = regionOf(atlas, texture)
  const x0 = Math.max(0, Math.floor(r.u0 * atlas.width))
  const x1 = Math.min(atlas.width, Math.ceil(r.u1 * atlas.width))
  const y0 = Math.max(0, Math.floor(r.v0 * atlas.height))
  const y1 = Math.min(atlas.height, Math.ceil(r.v1 * atlas.height))
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (atlas.pixels[(y * atlas.width + x) * 4 + 3]! < 255) return false
    }
  }
  return true
}

/**
 * 見た目ごとに「不透明な立方体か」を覚えておく。テクスチャの透明の判定も覚える。
 * AppearanceSet が変わったら作り直す
 */
export class OpaqueCubeCache {
  private readonly cubes = new Map<BlockAppearance, boolean>()
  private readonly textures = new Map<string, boolean>()
  private readonly cullable = new Map<BlockAppearance, number>()

  constructor(private readonly set: AppearanceSet) {}

  isOpaqueCube(appearance: BlockAppearance): boolean {
    let v = this.cubes.get(appearance)
    if (v === undefined) {
      v = isOpaqueFullCube(appearance, (t) => this.isTextureOpaque(t))
      this.cubes.set(appearance, v)
    }
    return v
  }

  /** cullableMask を覚えておく */
  cullableMask(appearance: BlockAppearance): number {
    let v = this.cullable.get(appearance)
    if (v === undefined) {
      v = cullableMask(appearance)
      this.cullable.set(appearance, v)
    }
    return v
  }

  private isTextureOpaque(texture: string): boolean {
    let v = this.textures.get(texture)
    if (v === undefined) {
      v = isTextureOpaque(this.set.atlas, texture)
      this.textures.set(texture, v)
    }
    return v
  }
}
