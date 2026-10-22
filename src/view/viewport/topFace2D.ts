// 2D表示で描く「上から見える面」を、ブロックの見た目（BlockAppearance）から選ぶ。
// docs/design.md「見た目（モデルとテクスチャ）」。canvas にも Vue にも依存しない計算だけを置く。
//
// - 各モデルの各要素について、置き方（x → y の回転）のあとで上（up）を向く面を探す
// - 上を向く面を、低いものから順に並べる（描く側はこの順に重ねて塗る）
// - 面は要素の真上から見た範囲（0〜16 の x・z）だけに描く。シャフトなら真ん中の小さな四角になる
//
// 回転の向きは Minecraft の blockstates と同じ：x=90 で北の面が下、上の面が北を向く。y=90 で北の面が東を向く。
// 要素の回転（22.5 度など）は範囲に入れない（傾いた板も、回す前の範囲で描く）。

import type { BlockAppearance, ModelElement, ModelFace, QuarterTurn, TextureId } from '../../domain/blockModel'
import type { Direction } from '../../domain/direction'

type Vec = readonly [number, number, number]

/** 方向の単位ベクトル。x が東、y が上、z が南 */
const DIRECTION_VECTORS: Readonly<Record<Direction, Vec>> = {
  down: [0, -1, 0],
  up: [0, 1, 0],
  north: [0, 0, -1],
  south: [0, 0, 1],
  west: [-1, 0, 0],
  east: [1, 0, 0],
}

/** x 軸のまわりに 90 度。北 → 下、上 → 北（Minecraft の blockstates の x=90） */
function rotateX90([x, y, z]: Vec): Vec {
  return [x, z, -y]
}

/** y 軸のまわりに 90 度。北 → 東、東 → 南（Minecraft の blockstates の y=90） */
function rotateY90([x, y, z]: Vec): Vec {
  return [-z, y, x]
}

function turns(angle: QuarterTurn): number {
  return angle / 90
}

/** ブロックの中心（8, 8, 8）を軸に、x を先に、次に y を回す。v は中心からのベクトル */
function rotateVec(v: Vec, x: QuarterTurn, y: QuarterTurn): Vec {
  let r = v
  for (let i = 0; i < turns(x); i++) r = rotateX90(r)
  for (let i = 0; i < turns(y); i++) r = rotateY90(r)
  return r
}

function sameVec(a: Vec, b: Vec): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2]
}

/** 置き方（x → y）のあとで上を向く、もとの面の向き */
export function faceTurnedUp(x: QuarterTurn, y: QuarterTurn): Direction {
  const up = DIRECTION_VECTORS.up
  for (const [dir, v] of Object.entries(DIRECTION_VECTORS) as [Direction, Vec][]) {
    if (sameVec(rotateVec(v, x, y), up)) return dir
  }
  return 'up'
}

/** 2D表示に描く面1つ */
export interface TopFace2D {
  readonly texture: TextureId
  /** テクスチャの中の範囲。0〜16 の [u1, v1, u2, v2]（u1 > u2 なら左右が反転） */
  readonly uv: readonly [number, number, number, number]
  /** 描く向きの回転（時計回りの度）。面の rotation と、置き方の y を足したもの */
  readonly rotation: QuarterTurn
  readonly tintIndex: number | null
  /** 真上から見た範囲。0〜16 の座標で、x は東、z は南 */
  readonly x0: number
  readonly z0: number
  readonly x1: number
  readonly z1: number
  /** 面の高さ（0〜16）。高いものほど後に描く */
  readonly top: number
}

function normalizeTurn(deg: number): QuarterTurn {
  return ((((deg % 360) + 360) % 360) as QuarterTurn)
}

/** 要素の範囲（0〜16）を、ブロックの中心を軸に回した範囲 */
function rotatedBounds(element: ModelElement, x: QuarterTurn, y: QuarterTurn): { min: Vec; max: Vec } {
  const a = rotateVec([element.from[0] - 8, element.from[1] - 8, element.from[2] - 8], x, y)
  const b = rotateVec([element.to[0] - 8, element.to[1] - 8, element.to[2] - 8], x, y)
  const min: Vec = [Math.min(a[0], b[0]) + 8, Math.min(a[1], b[1]) + 8, Math.min(a[2], b[2]) + 8]
  const max: Vec = [Math.max(a[0], b[0]) + 8, Math.max(a[1], b[1]) + 8, Math.max(a[2], b[2]) + 8]
  return { min, max }
}

function topFaceOf(face: ModelFace, element: ModelElement, x: QuarterTurn, y: QuarterTurn, uvlock: boolean): TopFace2D {
  const { min, max } = rotatedBounds(element, x, y)
  // 上の面はもともと北が上（テクスチャの上の辺が北）。y で回すと、絵も一緒に時計回りに回る。
  // uvlock なら回さない。x で横の面が上に来たときの向きは、ここでは同じ扱いにする（近似）
  const rotation = normalizeTurn(face.rotation + (uvlock ? 0 : y))
  return {
    texture: face.texture,
    uv: face.uv,
    rotation,
    tintIndex: face.tintIndex,
    x0: min[0],
    z0: min[2],
    x1: max[0],
    z1: max[2],
    top: max[1],
  }
}

/**
 * 上から見える面を、低いものから順に返す。上を向く面がなければ空。
 * 同じ高さなら、モデルと要素の順のまま（後のものが上に描かれる）
 */
export function topFaces(appearance: BlockAppearance): TopFace2D[] {
  const faces: { face: TopFace2D; order: number }[] = []
  for (const part of appearance.parts) {
    const dir = faceTurnedUp(part.x, part.y)
    for (const element of part.model.elements) {
      const face = element.faces[dir]
      if (!face) continue
      faces.push({ face: topFaceOf(face, element, part.x, part.y, part.uvlock), order: faces.length })
    }
  }
  if (faces.length === 0) {
    const fallback = topmostElementFace(appearance)
    return fallback ? [fallback] : []
  }
  faces.sort((a, b) => a.face.top - b.face.top || a.order - b.order)
  return faces.map((f) => f.face)
}

/** 面を探す順。上を向く面がないとき（草花の交差したモデルなど）に使う */
const FALLBACK_ORDER: readonly Direction[] = ['up', 'north', 'south', 'east', 'west', 'down']

/** 上を向く面がないとき、いちばん高い要素の面（もとの向きで探す）を1つ返す。面がなければ null */
function topmostElementFace(appearance: BlockAppearance): TopFace2D | null {
  let best: TopFace2D | null = null
  for (const part of appearance.parts) {
    for (const element of part.model.elements) {
      const dir = FALLBACK_ORDER.find((d) => element.faces[d] !== undefined)
      if (dir === undefined) continue
      const candidate = topFaceOf(element.faces[dir]!, element, part.x, part.y, part.uvlock)
      if (best === null || candidate.top > best.top) best = candidate
    }
  }
  return best
}
