// Create のアドオンの表（#276。docs/design.md「アドオンの表」）。
// Create の上に作られた Mod（Crafts & Additions など）の回るブロックを、Create の回転のネットワークに入れる口。
// アドオンの Mod の場所は、この形と同じ表を自分で書く（この場所は import しない）。登録の場所（calc/builtinPlugins.ts）がつなぐ。

import type { BlockState } from '../../domain/blockState'
import type { Blueprint } from '../../domain/blueprint'
import type { Direction } from '../../domain/direction'
import type { RawNbt } from '../../domain/nbt'
import type { CalcMode, CalcModpack } from '../calcPlugin'
import type { Resolved } from '../provenance'

/** アドオンの回るブロック1つ分 */
export interface CreateAddonKineticBlock {
  /** 回転軸 */
  readonly axis: 'x' | 'y' | 'z'
  /** シャフトとしてつながる面 */
  readonly shaftFaces: readonly Direction[]
  /** 1 RPM あたりの消費（SU/RPM） */
  readonly impact: Resolved<number>
  /** 動力源なら、生む回転数（Create のゲームの中の符号）と 1 RPM あたりの供給（SU/RPM）。動力源でなければ null */
  readonly source: { readonly speed: Resolved<number>; readonly capacity: Resolved<number> } | null
  /** このブロックについて仮定に載せること */
  readonly notes: readonly string[]
}

/** Modpack を読んだあとの表 */
export interface CreateAddonKineticTable {
  /** 表を作るときに仮定したこと（設定ファイルがないので内蔵の初期値を使った、など） */
  readonly notes: readonly string[]
  /** 回るブロックなら、その形と値。回らないブロック（アドオンの電線など）は null */
  block(state: BlockState, be: RawNbt | null, mode: CalcMode): CreateAddonKineticBlock | null
}

/** アドオン1つ分 */
export interface CreateKineticAddon {
  /** アドオンの namespace（'createaddition'）。この namespace のブロックは表に聞く */
  readonly namespace: string
  /** Modpack（なければ null）と設計図から表を作る。設定ファイルを読むので非同期。設計図は版（DataVersion）を見るのに使う */
  load(pack: CalcModpack | null, bp: Blueprint): Promise<CreateAddonKineticTable>
}

/** 計算1回分の、namespace ごとの表 */
export type CreateAddonTables = ReadonlyMap<string, CreateAddonKineticTable>

/** 使うアドオンの表を作る。設計図にない namespace は読まない */
export async function loadAddonTables(
  addons: readonly CreateKineticAddon[],
  bp: Blueprint,
  pack: CalcModpack | null,
): Promise<Map<string, CreateAddonKineticTable>> {
  const tables = new Map<string, CreateAddonKineticTable>()
  const namespaces = bp.namespaces
  for (const addon of addons) {
    if (!namespaces.has(addon.namespace) || tables.has(addon.namespace)) continue
    tables.set(addon.namespace, await addon.load(pack, bp))
  }
  return tables
}
