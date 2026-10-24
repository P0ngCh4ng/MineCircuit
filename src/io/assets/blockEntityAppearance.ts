// 生データ（ブロックエンティティ）で見た目が変わるブロック（docs/design.md「生データで見た目が変わるブロック」）。
// 見た目はふつうブロック状態で決まる（鍵は BlockState.key）。Custom Machinery の機械は、生データの machineID で
// どの機械かが決まり、見た目は機械の定義が指す別のブロックのものになる。
// - appearanceKey：マスの見た目の鍵。Modpack がなくても、生データだけで決まる（3D・2D がマスごとに使う）
// - appearanceAlias：その鍵の見た目を、どのブロック状態の見た目からどう回して作るか（つなぎ込みが使う）
// - withAliases：できた AppearanceSet に、借りた見た目を鍵で足す

import type { AppearanceSet, BlockAppearance } from '../../domain/blockModel'
import { BlockState } from '../../domain/blockState'
import type { RawNbt } from '../../domain/nbt'
import { ResourceLocation } from '../../domain/resourceLocation'
import { axisRotation, multiplyRotation, type Rotation3 } from '../../domain/rotation3'

/** Custom Machinery の機械のブロック */
export const CUSTOM_MACHINE_BLOCK = 'custommachinery:custom_machine_block'

/** 生データで見た目が変わるブロックの ID */
const BLOCK_ENTITY_APPEARANCE_IDS: ReadonlySet<string> = new Set([CUSTOM_MACHINE_BLOCK])

/** 機械の見た目を引く先（Modpack.machineAppearance） */
export interface MachineAppearanceLookup {
  machineAppearance(machineId: string): string | null
}

/** 見た目を借りる先 */
export interface AppearanceAlias {
  /** マスの見た目の鍵（appearanceKey） */
  readonly key: string
  /** 見た目を借りるブロック状態 */
  readonly borrow: BlockState
  /** 借りた見た目に、最後に重ねる回転 */
  readonly matrix: Rotation3
}

/** 生データの文字列の項目。なければ null */
function stringTag(nbt: RawNbt | null, name: string): string | null {
  const tag = nbt?.value.get(name)
  return tag?.type === 'string' && tag.value !== '' ? tag.value : null
}

/** 生データで見た目が変わるブロックか（生データを調べる前に、ID だけで決める） */
export function hasBlockEntityAppearance(state: BlockState): boolean {
  return BLOCK_ENTITY_APPEARANCE_IDS.has(state.id.toString())
}

/** マスの見た目の鍵。ふつうは state.key。Custom Machinery の機械なら、機械の ID を足す */
export function appearanceKey(state: BlockState, blockEntity: RawNbt | null): string {
  if (!hasBlockEntityAppearance(state)) return state.key
  const machine = stringTag(blockEntity, 'machineID')
  return machine ? `${state.key}|machine=${machine}` : state.key
}

/** `<id>` か `<id>[<property>=<値>,…]` をブロック状態にする。読めなければ null */
export function parseBlockStateString(text: string): BlockState | null {
  const m = /^([^[\]]+?)(?:\[([^\]]*)\])?$/.exec(text.trim())
  if (!m) return null
  let id: ResourceLocation
  try {
    id = ResourceLocation.parse(m[1]!)
  } catch {
    return null
  }
  const properties: Record<string, string> = {}
  for (const pair of (m[2] ?? '').split(',')) {
    if (pair.trim() === '') continue
    const eq = pair.indexOf('=')
    if (eq <= 0) return null
    properties[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim()
  }
  return new BlockState(id, properties)
}

/** facing の向き → y の回転（Minecraft の blockstates と同じく、北が 0、東が 90 で時計回り） */
const FACING_Y: Readonly<Record<string, number>> = { north: 0, east: 90, south: 180, west: 270 }

/**
 * そのマスの見た目を、どのブロック状態の見た目から作るか。生データで見た目が変わらないブロック、
 * または借りる先が分からない（機械の定義がない、見た目のブロックが読めない）なら null
 */
export function appearanceAlias(
  state: BlockState,
  blockEntity: RawNbt | null,
  lookup: MachineAppearanceLookup | null,
): AppearanceAlias | null {
  if (!lookup || state.id.toString() !== CUSTOM_MACHINE_BLOCK) return null
  const machine = stringTag(blockEntity, 'machineID')
  if (!machine) return null
  const text = lookup.machineAppearance(machine)
  const borrow = text === null ? null : parseBlockStateString(text)
  if (!borrow) return null
  // PlacedModel の y と同じ向き（時計回り）に回す。右手系の行列では負の角度
  const y = FACING_Y[state.properties.facing ?? 'north'] ?? 0
  return { key: appearanceKey(state, blockEntity), borrow, matrix: axisRotation('y', -y) }
}

/** 見た目を回す。各部品の回転のあとに matrix を重ねる */
function rotateAppearance(appearance: BlockAppearance, matrix: Rotation3): BlockAppearance {
  return { parts: appearance.parts.map((p) => ({ ...p, matrix: p.matrix ? multiplyRotation(matrix, p.matrix) : matrix })) }
}

/**
 * AppearanceSet に、借りた見た目を鍵で足した新しい AppearanceSet。借りる先の見た目が null なら null（箱）。
 * 足すものがなければ set をそのまま返す
 */
export function withAliases(set: AppearanceSet, aliases: Iterable<AppearanceAlias>): AppearanceSet {
  const extra: Record<string, BlockAppearance | null> = {}
  let any = false
  for (const a of aliases) {
    const base = set.appearances[a.borrow.key] ?? null
    extra[a.key] = base ? rotateAppearance(base, a.matrix) : null
    any = true
  }
  return any ? { ...set, appearances: { ...set.appearances, ...extra } } : set
}
