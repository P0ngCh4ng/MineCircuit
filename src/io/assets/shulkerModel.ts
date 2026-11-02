// シュルカーボックスの見た目（docs/design.md「モデルの解決」の「シュルカーボックスの絵（#221）」）。
// ゲームでは描画のコードで描くので、モデルに形がない。形は1ブロックの箱のままにして、
// 本来の絵（textures/entity/shulker/shulker[_<色>].png。64 × 64）から、面ごとに範囲を切り出して貼る。
// - ふた（12 段）と本体（8 段）の帯を上下2つの要素に貼る。ふたの下の 4 段と本体の上の 4 段は、
//   絵の中で抜けた所が互い違いなので、要素をその分だけ重ねる（本体 0〜8、ふた 4〜16）
// - チェストと違い、絵は上下が逆さまではない
// - 上向きに作り、facing（ふたの向き）に回す

import type { ModelElement, ModelFace, QuarterTurn, ResolvedModel, TextureId } from '../../domain/blockModel'
import type { BlockState } from '../../domain/blockState'
import type { Direction } from '../../domain/direction'
import type { EntityTextureAppearance } from './chestModel'

const COLORS: readonly string[] = [
  'white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray',
  'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black',
]

/** 横の面の帯の u の範囲（ピクセル）。西・北・東・南の順 */
const SIDE_U: readonly (readonly [number, number])[] = [
  [0, 16],
  [16, 32],
  [32, 48],
  [48, 64],
]
const SIDE_DIRS: readonly Direction[] = ['west', 'north', 'east', 'south']

/** ふた：帯は v 16〜28、上の面は (16, 0)〜(32, 16) */
const LID = { strip: [16, 28] as const, top: [16, 0, 32, 16] as const }
/** 本体：帯は v 44〜52、底は (32, 28)〜(48, 44) */
const BASE = { strip: [44, 52] as const, bottom: [32, 28, 48, 44] as const }

/** ふたの向き → 上向きに作った箱の回し方（x のあとに y） */
const FACING_TURNS: Readonly<Record<string, { readonly x: QuarterTurn; readonly y: QuarterTurn }>> = {
  up: { x: 0, y: 0 },
  down: { x: 180, y: 0 },
  north: { x: 90, y: 0 },
  east: { x: 90, y: 90 },
  south: { x: 90, y: 180 },
  west: { x: 90, y: 270 },
}

const px = (n: number): number => (n * 16) / 64

/** シュルカーボックスなら、見た目の候補と絵のパス。シュルカーボックスでなければ null */
export function shulkerAppearance(state: BlockState): EntityTextureAppearance | null {
  if (state.id.namespace !== 'minecraft') return null
  const path = state.id.path
  const color = path === 'shulker_box' ? null : COLORS.find((c) => path === `${c}_shulker_box`)
  if (color === undefined) return null
  const file = color === null ? 'shulker' : `shulker_${color}`
  const texture: TextureId = `minecraft:entity/shulker/${file}`
  const turn = FACING_TURNS[state.properties.facing ?? 'up'] ?? FACING_TURNS.up!
  return {
    texturePath: `assets/minecraft/textures/entity/shulker/${file}.png`,
    appearance: { parts: [{ model: shulkerModel(`${state.id.toString()}#shulker`, texture), x: turn.x, y: turn.y, uvlock: false }] },
  }
}

function shulkerModel(id: string, texture: TextureId): ResolvedModel {
  const face = (uv: readonly [number, number, number, number], cullface: Direction): ModelFace => ({
    texture,
    uv: [px(uv[0]), px(uv[1]), px(uv[2]), px(uv[3])],
    rotation: 0,
    cullface,
    tintIndex: null,
  })
  const sides = (strip: readonly [number, number]): Partial<Record<Direction, ModelFace>> =>
    Object.fromEntries(SIDE_DIRS.map((d, i) => [d, face([SIDE_U[i]![0], strip[0], SIDE_U[i]![1], strip[1]], d)]))
  const base: ModelElement = {
    from: [0, 0, 0],
    to: [16, 8, 16],
    rotation: null,
    shade: true,
    faces: { ...sides(BASE.strip), down: face(BASE.bottom, 'down') },
  }
  const lid: ModelElement = {
    from: [0, 4, 0],
    to: [16, 16, 16],
    rotation: null,
    shade: true,
    faces: { ...sides(LID.strip), up: face(LID.top, 'up') },
  }
  return { id, elements: [base, lid], meshes: [], ambientOcclusion: true }
}
