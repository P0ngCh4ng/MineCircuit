// Create のブロックで、画面から変えられる設定（docs/create-stress.md「生データ（nbt）の項目」）。
// ゲームの中で利用者が決める値だけを載せる。水車の FlowScore や風車の Running などは、
// ゲームが周りの状態から決め直す値なので、ここには入れない。

import type { BlockState } from '../../domain/blockState'
import { nbt, type RawNbt } from '../../domain/nbt'
import type { BlockSettingField, BlockSettings } from '../blockSettings'
import { DEFAULT_KINETICS, DEFAULT_SCROLL_SPEED } from './createDefaults'

// 範囲は Create の初期設定の上限（maxMotorSpeed / maxRotationSpeed、どちらも 256）。
// Modpack の設定で上限を変えている場合は考えない
const MAX_SPEED = DEFAULT_KINETICS.maxRotationSpeed

const MOTOR_SPEED: BlockSettingField = {
  key: 'ScrollValue',
  label: '回転数',
  unit: 'RPM',
  min: -MAX_SPEED,
  max: MAX_SPEED,
  defaultValue: DEFAULT_SCROLL_SPEED,
  hint: '向き（facing）が下・北・西のときは、出る回転の符号が逆になります。',
}

const CONTROLLER_SPEED: BlockSettingField = {
  key: 'ScrollValue',
  label: '目標の回転数',
  unit: 'RPM',
  min: -MAX_SPEED,
  max: MAX_SPEED,
  defaultValue: DEFAULT_SCROLL_SPEED,
  hint: '真上の大歯車をこの回転数で回します。',
}

/**
 * ブロック名（`create:` を外したもの）→ 設定と、ブロックエンティティの id。
 * id は Create の AllBlockEntityTypes の登録名（クリエイティブモーターは `create:motor`）。
 */
const SETTINGS: Readonly<Record<string, { readonly blockEntityId: string; readonly fields: readonly BlockSettingField[] }>> = {
  creative_motor: { blockEntityId: 'create:motor', fields: [MOTOR_SPEED] },
  rotation_speed_controller: { blockEntityId: 'create:rotation_speed_controller', fields: [CONTROLLER_SPEED] },
}

/** Create のブロックの設定。Create のブロックでないか、変えられる設定がなければ null */
export function createBlockSettings(state: BlockState): BlockSettings | null {
  if (state.id.namespace !== 'create') return null
  const entry = Object.hasOwn(SETTINGS, state.id.path) ? SETTINGS[state.id.path] : null
  if (!entry) return null
  return {
    fields: entry.fields,
    // 設計図（構造ファイル）の生データは位置（x, y, z）を持たないので、id だけを入れる。
    // ゲームがこの形を読めるかは未確認（#22）
    initialBlockEntity: (): RawNbt => nbt.compound({ id: nbt.string(entry.blockEntityId) }),
  }
}
