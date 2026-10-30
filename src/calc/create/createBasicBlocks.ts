// Modpack がないときの棚に出す、Create の基本の部品（#162。docs/design.md「基本の部品」）。
// 計算（応力・回転）で扱えるブロックのうち、よく使うもの。状態は completeCreateState と同じ規則で補う。
// 出典：Create（MIT License）のブロックの ID と状態の形。名前はアプリで書いたもので、Create の翻訳ファイルは使わない。
// README の「注記」に書いてある。

import { BlockState } from '../../domain/blockState'
import { ResourceLocation } from '../../domain/resourceLocation'
import { completeCreateState } from './createDefaultStates'

/** 棚に出す1つ分 */
export interface BasicBlock {
  readonly state: BlockState
  /** 棚に出す短い名前 */
  readonly name: string
}

/** [create: を外した ID, 名前, 補う前に入れる状態]。棚の並びもこの順 */
const PARTS: readonly (readonly [string, string, Readonly<Record<string, string>>?])[] = [
  ['shaft', 'シャフト'],
  ['cogwheel', '歯車'],
  ['large_cogwheel', '大きな歯車'],
  ['gearbox', 'ギアボックス'],
  ['clutch', 'クラッチ'],
  ['gearshift', 'ギアシフト'],
  ['encased_chain_drive', 'チェーンドライブ'],
  ['adjustable_chain_gearshift', '調整できるチェーンギアシフト'],
  // 水平の軸にしか置けない（RotationSpeedControllerBlock は HorizontalAxisKineticBlock）
  ['rotation_speed_controller', '回転数の調整器', { axis: 'x' }],
  ['creative_motor', 'クリエイティブモーター'],
  ['hand_crank', 'ハンドル'],
  ['water_wheel', '水車'],
  ['large_water_wheel', '大きな水車'],
  ['mechanical_press', 'プレス'],
  ['mechanical_mixer', 'ミキサー'],
  ['millstone', '石臼'],
  ['crushing_wheel', '粉砕ホイール'],
  ['encased_fan', 'ファン'],
  ['mechanical_drill', 'ドリル'],
  ['mechanical_saw', 'のこぎり'],
  ['deployer', 'デプロイヤー'],
]

/** 基本の部品。どれも回転軸の決まった状態 */
export const CREATE_BASIC_BLOCKS: readonly BasicBlock[] = PARTS.map(([path, name, props = {}]) => {
  const bare = new BlockState(new ResourceLocation('create', path), { ...props })
  return { state: completeCreateState(bare)?.state ?? bare, name }
})
