// チェストの見た目（docs/design.md「モデルの解決」の「チェストの絵（#219）」）。
// チェストはゲームでは描画のコードで描くので、モデルに形がない。形は1ブロックの箱のままにして、
// チェスト本来の絵（textures/entity/chest/<名前>.png。64 × 64）から、面ごとに範囲を切り出して貼る。
// アプリに持たせるのは「絵のどの範囲を、どの面に貼るか」だけ。絵は利用者の jar・リソースパックから読む。
// - ふた（上の段）と本体（下の段）の横の面は、絵の中で別の帯なので、箱を上下2つの要素に分ける（高さの比は帯の 5:10）
// - 絵は上下が逆さまに描かれているので、横の面は上下を返して貼る
// - 前の面（錠前の影がある帯）を北に作り、facing に向けて回す

import type { BlockAppearance, ModelElement, ModelFace, QuarterTurn, ResolvedModel, TextureId } from '../../domain/blockModel'
import type { BlockState } from '../../domain/blockState'
import type { Direction } from '../../domain/direction'

/** ブロックの ID → 絵の名前（textures/entity/chest/<名前>.png） */
const CHEST_TEXTURES: Readonly<Record<string, string>> = {
  'minecraft:chest': 'normal',
  'minecraft:trapped_chest': 'trapped',
  'minecraft:ender_chest': 'ender',
}

/** 絵の中の範囲（ピクセル。左上と右下） */
type Rect = readonly [number, number, number, number]

/** 横の面の帯の u の範囲（ピクセル） */
interface SideStrips {
  readonly front: readonly [number, number]
  readonly back: readonly [number, number]
  readonly west: readonly [number, number]
  readonly east: readonly [number, number]
}

/** 絵の並び。ふたの帯は v 14〜19、本体の帯は v 33〜43 */
interface ChestLayout {
  readonly lidTop: Rect
  readonly bottom: Rect
  readonly sides: SideStrips
}

const LID_STRIP: readonly [number, number] = [14, 19]
const BASE_STRIP: readonly [number, number] = [33, 43]

/** 1つのチェスト（幅 14） */
const SINGLE: ChestLayout = {
  lidTop: [28, 0, 42, 14],
  bottom: [14, 19, 28, 33],
  sides: { front: [42, 56], back: [14, 28], west: [0, 14], east: [28, 42] },
}

/**
 * 大きいチェストの半分（幅 15）。錠前の影が、もう半分とつながる側の端に来るように絵を選ぶ。
 * type=left はもう半分が facing の時計回り（北向きなら東）にあり、前から見て左側なので、影が左端にある _right の絵を使う
 */
const HALVES: Readonly<Record<'left' | 'right', { readonly suffix: string; readonly layout: ChestLayout }>> = {
  left: {
    suffix: '_right',
    layout: {
      lidTop: [29, 0, 44, 14],
      bottom: [14, 19, 29, 33],
      sides: { front: [43, 58], back: [14, 29], west: [0, 14], east: [0, 14] },
    },
  },
  right: {
    suffix: '_left',
    layout: {
      lidTop: [29, 0, 44, 14],
      bottom: [14, 19, 29, 33],
      sides: { front: [43, 58], back: [14, 29], west: [29, 43], east: [29, 43] },
    },
  },
}

/** 前の面（北に作る）を facing に向ける y の回転 */
const FACING_TURNS: Readonly<Record<string, QuarterTurn>> = { north: 0, east: 90, south: 180, west: 270 }

/** 本体とふたの境目の高さ（帯の高さの比 10:5） */
const SPLIT = 16 * (10 / 15)

/** ピクセル → モデルの uv（0〜16。絵は 64 ピクセル） */
const px = (n: number): number => (n * 16) / 64

/** チェストなら、絵のパスと見た目。チェストでなければ null */
export function chestAppearance(state: BlockState): { readonly texturePath: string; readonly appearance: BlockAppearance } | null {
  const name = CHEST_TEXTURES[state.id.toString()]
  if (name === undefined) return null
  const type = state.properties.type
  const half = type === 'left' || type === 'right' ? HALVES[type] : null
  const texture: TextureId = `minecraft:entity/chest/${name}${half?.suffix ?? ''}`
  const model = chestModel(`${state.id.toString()}#chest${half?.suffix ?? ''}`, texture, half?.layout ?? SINGLE)
  const y = FACING_TURNS[state.properties.facing ?? 'north'] ?? 0
  return {
    texturePath: `assets/minecraft/textures/entity/chest/${name}${half?.suffix ?? ''}.png`,
    appearance: { parts: [{ model, x: 0, y, uvlock: false }] },
  }
}

function chestModel(id: string, texture: TextureId, layout: ChestLayout): ResolvedModel {
  // 横の面は上下を返す（v の始まりを帯の下にする）
  const side = (u: readonly [number, number], strip: readonly [number, number], dir: Direction): ModelFace => ({
    texture,
    uv: [px(u[0]), px(strip[1]), px(u[1]), px(strip[0])],
    rotation: 0,
    cullface: dir,
    tintIndex: null,
  })
  const flat = (r: Rect, dir: Direction): ModelFace => ({
    texture,
    uv: [px(r[0]), px(r[1]), px(r[2]), px(r[3])],
    rotation: 0,
    cullface: dir,
    tintIndex: null,
  })
  const sides = (strip: readonly [number, number]) => ({
    north: side(layout.sides.front, strip, 'north'),
    south: side(layout.sides.back, strip, 'south'),
    west: side(layout.sides.west, strip, 'west'),
    east: side(layout.sides.east, strip, 'east'),
  })
  const base: ModelElement = {
    from: [0, 0, 0],
    to: [16, SPLIT, 16],
    rotation: null,
    shade: true,
    faces: { ...sides(BASE_STRIP), down: flat(layout.bottom, 'down') },
  }
  const lid: ModelElement = {
    from: [0, SPLIT, 0],
    to: [16, 16, 16],
    rotation: null,
    shade: true,
    faces: { ...sides(LID_STRIP), up: flat(layout.lidTop, 'up') },
  }
  return { id, elements: [base, lid], meshes: [], ambientOcclusion: true }
}
