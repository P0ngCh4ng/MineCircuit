// 部品のモデルの表（docs/design.md「部品のモデルの表」）。
// Create のベルトやブレイズバーナーの頭は、blockstates のモデルが空（または籠だけ）で、
// ゲームでは描画のコード（BlockEntityRenderer）が状態に合わせて部品のモデル（partial model）を選んで描く。
// jar のファイルからは分からないので、その選び方をここに書き写す。モデルとテクスチャは利用者の jar から読む。
//
// - 表に書くのは「どの状態で、どの部品のモデルを、どの向きで重ねるか」だけ。動き（回転・上下の揺れ）は描かない
// - 向きは Create の描画のコードと同じ順で回転を重ねる（composeRotations：先に書いたものが外側）
// - 世界の様子（上にブロックがあるか）で変わるものは、ないときのものを選ぶ

import type { BlockState } from '../../domain/blockState'
import { axisRotation, composeRotations, IDENTITY_ROTATION, type Rotation3 } from '../../domain/rotation3'

/** 重ねる部品のモデル1つ */
export interface PartialPlacement {
  /** モデルの ID（`create:block/belt/start`） */
  readonly model: string
  /** ブロックの中心まわりの回転 */
  readonly matrix: Rotation3
}

type PartialRule = (state: BlockState) => readonly PartialPlacement[]

const HORIZONTAL = ['north', 'east', 'south', 'west'] as const
type Horizontal = (typeof HORIZONTAL)[number]

function horizontal(value: string | undefined, fallback: Horizontal): Horizontal {
  return (HORIZONTAL as readonly string[]).includes(value ?? '') ? (value as Horizontal) : fallback
}

/** Create の AngleHelper.horizontalAngle（南が 0、東が 90、北が 180、西が 270） */
function horizontalAngle(facing: Horizontal): number {
  return { south: 0, east: 90, north: 180, west: 270 }[facing]
}

/** 時計回りに 90 度回した向き（Direction.getClockWise） */
function clockWise(facing: Horizontal): Horizontal {
  return { north: 'east', east: 'south', south: 'west', west: 'north' }[facing] as Horizontal
}

/**
 * Create のベルト（BeltRenderer）。ベルトの上と下の部品を、傾きと向きに合わせて回す。
 * 端（start・end・pulley）にはプーリー（belt_pulley）を重ねる
 */
function beltParts(state: BlockState): PartialPlacement[] {
  const p = state.properties
  const slope = p.slope ?? 'horizontal'
  const part = p.part ?? 'middle'
  const facing = horizontal(p.facing, 'north')
  const upward = slope === 'upward'
  const downward = slope === 'downward'
  const diagonal = upward || downward
  const sideways = slope === 'sideways'
  let start = part === 'start'
  let end = part === 'end'
  // 下り坂と、正の向き（南・東）の縦のベルトは、始まりと終わりが逆に見える
  if (downward || (slope === 'vertical' && (facing === 'south' || facing === 'east'))) [start, end] = [end, start]

  const matrix = composeRotations(
    axisRotation('y', horizontalAngle(facing) + (upward ? 180 : 0) + (sideways ? 270 : 0)),
    axisRotation('z', sideways ? 90 : 0),
    axisRotation('x', !diagonal && slope !== 'horizontal' ? 90 : 0),
  )
  const name = start ? 'start' : end ? 'end' : 'middle'
  const out: PartialPlacement[] = []
  if (diagonal) {
    out.push({ model: `create:block/belt/diagonal_${name}`, matrix })
  } else {
    out.push({ model: `create:block/belt/${name}`, matrix }, { model: `create:block/belt/${name}_bottom`, matrix })
  }

  if (part !== 'middle') {
    // プーリーの軸は、横向きのベルトなら上下、ほかは進む向きに直角（facing を時計回りに回した向き）
    const dir = sideways ? 'up' : clockWise(facing)
    const axis = dir === 'up' ? 'y' : dir === 'east' || dir === 'west' ? 'x' : 'z'
    const pulley = composeRotations(
      axis === 'x' ? axisRotation('y', 90) : IDENTITY_ROTATION,
      axis === 'y' ? axisRotation('x', 90) : IDENTITY_ROTATION,
      axisRotation('x', 90),
    )
    out.push({ model: 'create:block/belt_pulley', matrix: pulley })
  }
  return out
}

/**
 * Create のブレイズバーナーの頭と棒（BlazeBurnerRenderer）。熱の段階（blaze）で選ぶ。
 * 頭は向き（facing。置いた人の方）へ向ける。上にブロックがあるときの顔（active）は選ばない
 */
function blazeBurnerParts(state: BlockState): PartialPlacement[] {
  const heat = state.properties.blaze ?? 'smouldering'
  if (heat === 'none') return []
  const head = composeRotations(axisRotation('y', horizontalAngle(horizontal(state.properties.facing, 'south'))))
  if (heat === 'seething') {
    return [
      { model: 'create:block/blaze_burner/blaze/super', matrix: head },
      { model: 'create:block/blaze_burner/superheated_rods_small', matrix: IDENTITY_ROTATION },
      { model: 'create:block/blaze_burner/superheated_rods_large', matrix: IDENTITY_ROTATION },
    ]
  }
  if (heat === 'fading' || heat === 'kindled') {
    return [
      { model: 'create:block/blaze_burner/blaze/idle', matrix: head },
      { model: 'create:block/blaze_burner/rods_small', matrix: IDENTITY_ROTATION },
      { model: 'create:block/blaze_burner/rods_large', matrix: IDENTITY_ROTATION },
    ]
  }
  return [{ model: 'create:block/blaze_burner/blaze/inert', matrix: head }]
}

/** ブロックの ID → 重ねる部品のモデルの選び方 */
const RULES: Readonly<Record<string, PartialRule>> = {
  'create:belt': beltParts,
  'create:blaze_burner': blazeBurnerParts,
}

/** そのブロック状態に重ねる部品のモデル。表になければ空 */
export function partialModelsFor(state: BlockState): readonly PartialPlacement[] {
  return RULES[state.id.toString()]?.(state) ?? []
}
