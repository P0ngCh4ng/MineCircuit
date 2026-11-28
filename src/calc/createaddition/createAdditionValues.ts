// Create Crafts & Additions の定数（docs/createaddition-power.md「値の出どころ」「数値の表」）。
// Modpack の createaddition-common.toml → 内蔵の初期値の順。初期値は版で違うものがあり、設計図の版から選ぶ。

import type { Blueprint } from '../../domain/blueprint'
import type { CalcModpack } from '../calcPlugin'
import { resolved, type Resolved } from '../provenance'
import { parseTomlSubset, type TomlValue } from '../tomlSubset'

/**
 * 規則と初期値の版。'1.7' は 1.21.1 の 1.7.2、'fabric-1.18' は Create Astral の Fabric 1.18.2 版（20230704a）。
 * docs/createaddition-power.md「バージョンの違い」
 */
export type CaProfile = '1.7' | 'fabric-1.18'

/** 1.18.2 の DataVersion。これ以下の設計図は Fabric 1.18.2 版の規則で計算する */
export const DATA_VERSION_1_18_2 = 2975

/** 設計図の版から規則の版を選ぶ */
export function caProfile(bp: Blueprint): CaProfile {
  return bp.dataVersion <= DATA_VERSION_1_18_2 ? 'fabric-1.18' : '1.7'
}

export type CaValueName =
  | 'feAtMaxRpm'
  | 'maxStress'
  | 'motorRpmRange'
  | 'motorMinConsumption'
  | 'motorMaxInput'
  | 'alternatorMaxOutput'
  | 'alternatorEfficiency'
  | 'rollingMillStress'
  | 'smallConnectorMaxInput'
  | 'smallConnectorMaxOutput'
  | 'smallConnectorWireLength'
  | 'largeConnectorMaxInput'
  | 'largeConnectorMaxOutput'
  | 'largeConnectorWireLength'
  | 'lightConnectorConsumption'
  | 'accumulatorCapacity'
  | 'accumulatorMaxInput'
  | 'accumulatorMaxOutput'

/** 項目ごとの設定ファイルのキー（前から探す）と、版ごとの初期値 */
const ENTRIES: Readonly<Record<CaValueName, { readonly keys: readonly string[]; readonly defaults: Readonly<Record<CaProfile, number>> }>> = {
  feAtMaxRpm: { keys: ['general.fe_at_max_rpm'], defaults: { '1.7': 480, 'fabric-1.18': 480 } },
  maxStress: { keys: ['general.max_stress'], defaults: { '1.7': 16384, 'fabric-1.18': 16384 } },
  motorRpmRange: { keys: ['electric_motor.motor_rpm_range'], defaults: { '1.7': 256, 'fabric-1.18': 256 } },
  motorMinConsumption: { keys: ['electric_motor.motor_min_consumption'], defaults: { '1.7': 8, 'fabric-1.18': 8 } },
  motorMaxInput: { keys: ['electric_motor.motor_max_input'], defaults: { '1.7': 5000, 'fabric-1.18': 5000 } },
  alternatorMaxOutput: { keys: ['alternator.generator_max_output'], defaults: { '1.7': 5000, 'fabric-1.18': 5000 } },
  alternatorEfficiency: { keys: ['alternator.generator_efficiency'], defaults: { '1.7': 0.75, 'fabric-1.18': 0.75 } },
  rollingMillStress: { keys: ['rolling_mill.rolling_mill_stress'], defaults: { '1.7': 8, 'fabric-1.18': 16 } },
  smallConnectorMaxInput: {
    keys: ['wires.small_connector_max_input', 'wires.connector_max_input'],
    defaults: { '1.7': 1000, 'fabric-1.18': 5000 },
  },
  smallConnectorMaxOutput: {
    keys: ['wires.small_connector_max_output', 'wires.connector_max_output'],
    defaults: { '1.7': 1000, 'fabric-1.18': 5000 },
  },
  smallConnectorWireLength: {
    keys: ['wires.small_connector_wire_length', 'wires.wire_length'],
    defaults: { '1.7': 16, 'fabric-1.18': 12 },
  },
  largeConnectorMaxInput: { keys: ['wires.large_connector_max_input'], defaults: { '1.7': 5000, 'fabric-1.18': 5000 } },
  largeConnectorMaxOutput: { keys: ['wires.large_connector_max_output'], defaults: { '1.7': 5000, 'fabric-1.18': 5000 } },
  largeConnectorWireLength: { keys: ['wires.large_connector_wire_length'], defaults: { '1.7': 32, 'fabric-1.18': 32 } },
  lightConnectorConsumption: { keys: ['wires.small_light_connector_consumption'], defaults: { '1.7': 1, 'fabric-1.18': 1 } },
  accumulatorCapacity: { keys: ['accumulator.accumulator_capacity'], defaults: { '1.7': 2_000_000, 'fabric-1.18': 2_000_000 } },
  accumulatorMaxInput: { keys: ['accumulator.accumulator_max_input'], defaults: { '1.7': 5000, 'fabric-1.18': 5000 } },
  accumulatorMaxOutput: { keys: ['accumulator.accumulator_max_output'], defaults: { '1.7': 5000, 'fabric-1.18': 5000 } },
}

export const CA_CONFIG_FILE = 'createaddition-common.toml'

/** 探す場所（CA-CONFIG-SEARCH） */
export const CA_CONFIG_PATHS: readonly string[] = [`config/${CA_CONFIG_FILE}`, `defaultconfigs/${CA_CONFIG_FILE}`]

const PROFILE_LABELS: Readonly<Record<CaProfile, string>> = {
  '1.7': '1.21.1 の 1.7.2',
  'fabric-1.18': 'Fabric 1.18.2 版（20230704a）',
}

/** C&A の定数。設定ファイルにあればその値、なければ版の初期値 */
export class CaValues {
  constructor(
    readonly profile: CaProfile,
    private readonly toml: ReadonlyMap<string, TomlValue> | null,
    /** 設定ファイルのパス。なければ null */
    readonly configPath: string | null,
  ) {}

  get(name: CaValueName): Resolved<number> {
    const entry = ENTRIES[name]
    for (const key of entry.keys) {
      const v = this.toml?.get(key)
      if (typeof v === 'number') return resolved(v, 'modpack', this.configPath ?? undefined)
    }
    return resolved(entry.defaults[this.profile], 'builtin')
  }

  /** 値だけ */
  value(name: CaValueName): number {
    return this.get(name).value
  }
}

/** 定数と、仮定に載せること */
export interface CaValuesLookup {
  readonly values: CaValues
  readonly notes: readonly string[]
}

/** Modpack から設定ファイルを探して定数を作る（CA-CONFIG-SEARCH） */
export async function loadCaValues(pack: CalcModpack | null, bp: Blueprint): Promise<CaValuesLookup> {
  const profile = caProfile(bp)
  const notes = [`Crafts & Additions の版は、設計図の Minecraft の版（DataVersion ${bp.dataVersion}）から ${PROFILE_LABELS[profile]}とみなした`]
  if (pack) {
    for (const path of CA_CONFIG_PATHS) {
      const text = await pack.config(path)
      if (text !== null) return { values: new CaValues(profile, parseTomlSubset(text), path), notes }
    }
  }
  notes.push(
    pack
      ? `Modpack に ${CA_CONFIG_FILE} がないので、Crafts & Additions の内蔵の初期値を使った`
      : 'Modpack がないので、Crafts & Additions の内蔵の初期値を使った',
  )
  return { values: new CaValues(profile, null, null), notes }
}
