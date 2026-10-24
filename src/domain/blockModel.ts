// ブロックの見た目（モデルとテクスチャ）のデータの型。
// jar の blockstates・models・textures を読んで解決した結果を、画面がそのまま描ける形で表す。
// 読む側（io/assets）と描く側（view）の約束なので、ここを変えるときは両方を直す。
// どれも構造化複製できる素のデータにする（Worker から送るため）。

import type { Direction } from './direction'
import type { Vec3 } from './vec3'

/**
 * テクスチャの ID。namespace 付きで、`textures/` と `.png` を除いたパス。
 * 例: "create:block/shaft"、"minecraft:block/stone"
 */
export type TextureId = string

/** 面の向きの回転。度 */
export type QuarterTurn = 0 | 90 | 180 | 270

/** モデルの要素の1面 */
export interface ModelFace {
  /** 解決済みのテクスチャ（`#side` などの変数は解決してある） */
  readonly texture: TextureId
  /** テクスチャの中の範囲。Minecraft と同じ 0〜16 の座標で [u1, v1, u2, v2] */
  readonly uv: readonly [number, number, number, number]
  /** テクスチャの回転 */
  readonly rotation: QuarterTurn
  /** この向きに隣のブロックがあれば描かない面。なければ null */
  readonly cullface: Direction | null
  /** 色を付ける番号（草や葉）。付けないなら null */
  readonly tintIndex: number | null
}

/** 要素の回転。Minecraft のモデルの rotation と同じ */
export interface ModelElementRotation {
  /** 回転の中心。0〜16 の座標 */
  readonly origin: Vec3
  readonly axis: 'x' | 'y' | 'z'
  /** 度。Minecraft では -45 / -22.5 / 0 / 22.5 / 45 */
  readonly angle: number
  readonly rescale: boolean
}

/** モデルの要素（直方体1つ） */
export interface ModelElement {
  /** 0〜16 の座標。from < to */
  readonly from: Vec3
  readonly to: Vec3
  readonly rotation: ModelElementRotation | null
  /** 影を付けるか */
  readonly shade: boolean
  /** ある面だけ。ない面は描かない */
  readonly faces: Readonly<Partial<Record<Direction, ModelFace>>>
}

/**
 * OBJ のモデル（`"loader": "forge:obj"`）の三角形。テクスチャ1つ分をまとめる。
 * 3つの頂点で1つの三角形（外から見て反時計回り）。隣のブロックで隠す面はない
 */
export interface ModelMesh {
  /** 解決済みのテクスチャ */
  readonly texture: TextureId
  /** 頂点の位置。要素と同じ 0〜16 の座標。[x, y, z, …] */
  readonly positions: readonly number[]
  /** 頂点のテクスチャの座標。面の uv と同じ 0〜16 で、v は下向き。[u, v, …] */
  readonly uvs: readonly number[]
  /** 頂点の法線（長さ 1）。[x, y, z, …] */
  readonly normals: readonly number[]
}

/** 親のモデルをたどって、要素とテクスチャを確定したモデル */
export interface ResolvedModel {
  /** 解決のもとにしたモデルの ID（例: "create:block/shaft"）。描画のまとめ単位に使う */
  readonly id: string
  readonly elements: readonly ModelElement[]
  /** OBJ のモデルの三角形。OBJ でなければ空 */
  readonly meshes: readonly ModelMesh[]
  readonly ambientOcclusion: boolean
}

/** blockstates で選ばれたモデルと、その置き方 */
export interface PlacedModel {
  readonly model: ResolvedModel
  /** ブロックの中心を軸にした回転。x を先に、次に y */
  readonly x: QuarterTurn
  readonly y: QuarterTurn
  /** 回転してもテクスチャの向きを変えない */
  readonly uvlock: boolean
}

/**
 * 1つのブロック状態の見た目。multipart では複数のモデルを重ねる。
 * 中身が空（parts が空）なら描くものがない（空気、見えないブロック）
 */
export interface BlockAppearance {
  readonly parts: readonly PlacedModel[]
}

/** アトラスの中の1つのテクスチャの位置。0〜1 に正規化した座標で、v は上が 0 */
export interface AtlasRegion {
  readonly u0: number
  readonly v0: number
  readonly u1: number
  readonly v1: number
}

/** テクスチャを1枚の画像にまとめたもの */
export interface TextureAtlas {
  readonly width: number
  readonly height: number
  /** RGBA。長さは width * height * 4。上の行から */
  readonly pixels: Uint8ClampedArray
  /** テクスチャの ID → アトラスの中の位置 */
  readonly regions: Readonly<Record<TextureId, AtlasRegion>>
  /** 見つからなかったテクスチャに使う位置（紫と黒の市松模様） */
  readonly missing: AtlasRegion
}

/**
 * 設計図に出てくるブロック状態の見た目をまとめたもの。画面はこれだけを使って描く。
 * appearances の鍵は BlockState.key。値が null なら見た目が分からない（色付きの箱で描く）
 */
export interface AppearanceSet {
  readonly appearances: Readonly<Record<string, BlockAppearance | null>>
  readonly atlas: TextureAtlas
  /** 読めなかったファイルなど。画面に件数を出す */
  readonly problems: readonly string[]
}
