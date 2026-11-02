// アイテムの絵の板（docs/design.md「モデルの解決」の「アイテムの絵の板（#223）」）。
// 看板のように、ゲームでは描画のコードで描き、箱から形が遠いブロックのうち、アイテムの絵が平らな1枚絵
// （item/generated の layer0）のものは、その絵を1枚の板にしてブロックの中に立てる。
// 地面に落ちたアイテムの見え方と同じで、形は持たない。
// - 板はブロックの真ん中に立て、facing（横向き）か rotation（0〜15。立てた看板）の向きに回す
// - 両側から見えるように、表と裏の面を付ける

import type { BlockAppearance, ModelElement, ModelFace, QuarterTurn, ResolvedModel, TextureId } from '../../domain/blockModel'
import type { BlockState } from '../../domain/blockState'

const FACING_TURNS: Readonly<Record<string, QuarterTurn>> = { north: 0, east: 90, south: 180, west: 270 }
const TURNS: readonly QuarterTurn[] = [0, 90, 180, 270]

/**
 * ブロックの ID からアイテムのモデルの候補。ブロック名と同じアイテムがなければ、
 * 壁に付けるブロックは `wall_` を除いた名前（minecraft:oak_wall_sign → minecraft:item/oak_sign）
 */
export function itemModelCandidates(state: BlockState): string[] {
  const ns = state.id.namespace
  const path = state.id.path
  const out = [`${ns}:item/${path}`]
  const withoutWall = path.replace(/_wall_|wall_/, (m) => (m === '_wall_' ? '_' : ''))
  if (withoutWall !== path) out.push(`${ns}:item/${withoutWall}`)
  return out
}

/** アイテムの絵の板の見た目 */
export function itemSpriteAppearance(state: BlockState, sprite: TextureId): BlockAppearance {
  const face = (): ModelFace => ({ texture: sprite, uv: [0, 0, 16, 16], rotation: 0, cullface: null, tintIndex: null })
  const rotation = state.properties.rotation === undefined ? NaN : Number(state.properties.rotation)
  let y: QuarterTurn = FACING_TURNS[state.properties.facing ?? ''] ?? 0
  let angle = 0
  if (Number.isInteger(rotation) && rotation >= 0 && rotation < 16) {
    // rotation は 0 が南向きで、上から見て時計回りに 22.5 度ずつ。90 度ずつは y で、残りは要素の回転で回す
    const quarter = Math.round(rotation / 4)
    y = TURNS[(quarter + 2) % 4]!
    angle = -(rotation - quarter * 4) * 22.5
  }
  const board: ModelElement = {
    from: [0, 0, 8],
    to: [16, 16, 8],
    rotation: angle === 0 ? null : { origin: [8, 8, 8], axis: 'y', angle, rescale: false },
    shade: true,
    faces: { north: face(), south: face() },
  }
  const model: ResolvedModel = { id: `${state.id.toString()}#sprite`, elements: [board], meshes: [], ambientOcclusion: false }
  return { parts: [{ model, x: 0, y, uvlock: false }] }
}
