// テクスチャ表示のテスト用の偽のデータ。
// 本物の jar のモデルやテクスチャ（権利がある）はリポジトリに入れないので、ここでコードで作る。
// - 画面側（3D・2D の描画）は fakeAppearanceSet / FakeAppearanceProvider を使えば、jar の読み込みがなくても作れる
// - 読み込み側（モデルの解決・テクスチャ）は MemoryAssetReader に偽の JSON や PNG を入れてテストする

import type {
  AppearanceSet,
  AtlasRegion,
  BlockAppearance,
  ModelElement,
  ModelFace,
  ResolvedModel,
  TextureAtlas,
  TextureId,
} from '../../src/domain/blockModel'
import type { BlockState } from '../../src/domain/blockState'
import type { Direction } from '../../src/domain/direction'
import { DIRECTIONS } from '../../src/domain/direction'
import type { AppearanceProvider, AssetReader } from '../../src/io/assets/assetTypes'

/** 偽のテクスチャ。1枚 16×16 の単色に、1ピクセルの暗い縁を付ける（向きが分かるよう左上だけ白） */
export const FAKE_TEXTURES: Readonly<Record<TextureId, readonly [number, number, number]>> = {
  'test:block/red': [200, 40, 40],
  'test:block/green': [40, 170, 60],
  'test:block/blue': [40, 80, 210],
  'test:block/shaft': [150, 150, 150],
  'test:block/shaft_end': [90, 90, 90],
  'test:block/grass_top': [255, 255, 255], // 色付け（tintIndex）用に白
}

const TILE = 16

/** FAKE_TEXTURES を横に並べたアトラス。最後に missing（紫と黒の市松模様）を置く */
export function fakeAtlas(): TextureAtlas {
  const ids = Object.keys(FAKE_TEXTURES)
  const count = ids.length + 1
  const width = TILE * count
  const height = TILE
  const pixels = new Uint8ClampedArray(width * height * 4)
  const regions: Record<TextureId, AtlasRegion> = {}

  const regionAt = (i: number): AtlasRegion => ({ u0: (i * TILE) / width, v0: 0, u1: ((i + 1) * TILE) / width, v1: 1 })
  const put = (x: number, y: number, r: number, g: number, b: number): void => {
    const o = (y * width + x) * 4
    pixels[o] = r
    pixels[o + 1] = g
    pixels[o + 2] = b
    pixels[o + 3] = 255
  }

  ids.forEach((id, i) => {
    const [r, g, b] = FAKE_TEXTURES[id]!
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const edge = x === 0 || y === 0 || x === TILE - 1 || y === TILE - 1
        if (x === 0 && y === 0) put(i * TILE + x, y, 255, 255, 255)
        else if (edge) put(i * TILE + x, y, r * 0.6, g * 0.6, b * 0.6)
        else put(i * TILE + x, y, r, g, b)
      }
    }
    regions[id] = regionAt(i)
  })

  const m = ids.length
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const magenta = (x < TILE / 2) !== (y < TILE / 2)
      put(m * TILE + x, y, magenta ? 248 : 0, 0, magenta ? 248 : 0)
    }
  }

  return { width, height, pixels, regions, missing: regionAt(m) }
}

function face(texture: TextureId, dir: Direction, opts: Partial<ModelFace> = {}): ModelFace {
  return { texture, uv: [0, 0, 16, 16], rotation: 0, cullface: dir, tintIndex: null, ...opts }
}

/** 全面が同じ、または上下と横で違う立方体のモデル */
export function cubeModel(
  id: string,
  textures: { all?: TextureId; top?: TextureId; bottom?: TextureId; side?: TextureId },
): ResolvedModel {
  const side = textures.side ?? textures.all ?? 'test:block/red'
  const top = textures.top ?? textures.all ?? side
  const bottom = textures.bottom ?? textures.all ?? side
  const faces: Partial<Record<Direction, ModelFace>> = {}
  for (const d of DIRECTIONS) faces[d] = face(d === 'up' ? top : d === 'down' ? bottom : side, d)
  const element: ModelElement = { from: [0, 0, 0], to: [16, 16, 16], rotation: null, shade: true, faces }
  return { id, elements: [element], ambientOcclusion: true }
}

/** y 軸のシャフトに似たモデル（中央の 4×16×4 の柱）。cullface は上下だけ */
export function shaftModel(): ResolvedModel {
  const side = (d: Direction): ModelFace => face('test:block/shaft', d, { uv: [6, 0, 10, 16], cullface: null })
  const end = (d: Direction): ModelFace => face('test:block/shaft_end', d, { uv: [6, 6, 10, 10] })
  const element: ModelElement = {
    from: [6, 0, 6],
    to: [10, 16, 10],
    rotation: null,
    shade: true,
    faces: { north: side('north'), south: side('south'), east: side('east'), west: side('west'), up: end('up'), down: end('down') },
  }
  return { id: 'test:block/shaft', elements: [element], ambientOcclusion: false }
}

/** 22.5 度回した板（要素の回転のテスト用） */
export function tiltedPlateModel(): ResolvedModel {
  const element: ModelElement = {
    from: [0, 7, 0],
    to: [16, 9, 16],
    rotation: { origin: [8, 8, 8], axis: 'x', angle: 22.5, rescale: false },
    shade: true,
    faces: { up: face('test:block/blue', 'up', { cullface: null }), down: face('test:block/blue', 'down', { cullface: null }) },
  }
  return { id: 'test:block/tilted_plate', elements: [element], ambientOcclusion: false }
}

/** 色付け（草）の立方体。上面だけ tintIndex 0 */
export function tintedCubeModel(): ResolvedModel {
  const base = cubeModel('test:block/grass', { top: 'test:block/grass_top', bottom: 'test:block/red', side: 'test:block/green' })
  const element = base.elements[0]!
  return { ...base, elements: [{ ...element, faces: { ...element.faces, up: { ...element.faces.up!, tintIndex: 0 } } }] }
}

/** モデル1つを置いただけの見た目 */
export function single(model: ResolvedModel, x: 0 | 90 | 180 | 270 = 0, y: 0 | 90 | 180 | 270 = 0): BlockAppearance {
  return { parts: [{ model, x, y, uvlock: false }] }
}

/**
 * よく使う見た目の例。鍵は BlockState.key。
 * - test:red_block … 全面赤の立方体
 * - test:log[axis=y] / [axis=x] … 上下が青・横が緑。axis=x は x=90, y=90 で回す
 * - test:shaft[axis=y] / [axis=z] … 柱のモデル。axis=z は x=90
 * - test:plate … 22.5 度傾いた板
 * - test:grass … 色付きの上面
 * - test:fence … multipart（柱 + 北の板）
 * - test:unknown … 見た目が分からない（null）
 */
export function fakeAppearances(): Record<string, BlockAppearance | null> {
  const log = cubeModel('test:block/log', { top: 'test:block/blue', side: 'test:block/green' })
  return {
    'test:red_block': single(cubeModel('test:block/red_block', { all: 'test:block/red' })),
    'test:log[axis=y]': single(log),
    'test:log[axis=x]': single(log, 90, 90),
    'test:shaft[axis=y]': single(shaftModel()),
    'test:shaft[axis=z]': single(shaftModel(), 90, 0),
    'test:plate': single(tiltedPlateModel()),
    'test:grass': single(tintedCubeModel()),
    'test:fence': {
      parts: [
        { model: shaftModel(), x: 0, y: 0, uvlock: false },
        { model: tiltedPlateModel(), x: 0, y: 0, uvlock: false },
      ],
    },
    'test:unknown': null,
  }
}

export function fakeAppearanceSet(problems: readonly string[] = []): AppearanceSet {
  return { appearances: fakeAppearances(), atlas: fakeAtlas(), problems }
}

/** 画面側のテスト用。知らない状態は null（色付きの箱）にする */
export class FakeAppearanceProvider implements AppearanceProvider {
  readonly calls: (readonly string[])[] = []

  constructor(private readonly set: AppearanceSet = fakeAppearanceSet()) {}

  async prepare(states: readonly BlockState[]): Promise<AppearanceSet> {
    const keys = states.map((s) => s.key)
    this.calls.push(keys)
    const appearances: Record<string, BlockAppearance | null> = {}
    for (const k of keys) appearances[k] = this.set.appearances[k] ?? null
    return { ...this.set, appearances }
  }
}

/** 読み込み側のテスト用。パス → 中身（文字列は UTF-8 にして返す） */
export class MemoryAssetReader implements AssetReader {
  readonly reads: string[] = []

  constructor(private readonly files: Readonly<Record<string, string | Uint8Array>>) {}

  async readText(path: string): Promise<string | null> {
    this.reads.push(path)
    const v = this.files[path]
    if (v === undefined) return null
    return typeof v === 'string' ? v : new TextDecoder().decode(v)
  }

  async readBytes(path: string): Promise<Uint8Array | null> {
    this.reads.push(path)
    const v = this.files[path]
    if (v === undefined) return null
    return typeof v === 'string' ? new TextEncoder().encode(v) : v
  }
}
