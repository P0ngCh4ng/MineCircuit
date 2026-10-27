// Create の Mod の定数（impact / capacity / 回転数の上限など）の出どころを決める
// （docs/create-stress.md「値の出どころ」）。Modpack の create-server.toml → 内蔵の初期値の順。
// 個体の設定値（nbt）は kineticGraph.ts で、設計図 → 内蔵の初期値の順に読む。

import { candidate, resolveWith, resolved, type Resolved } from '../provenance'
import type { CreateServerConfig } from './createConfig'
import { DEFAULT_CAPACITY, DEFAULT_IMPACT, DEFAULT_KINETICS, DEFAULT_LOGISTICS } from './createDefaults'

export class CreateValueResolver {
  /** config がなければ内蔵の初期値だけを使う */
  constructor(readonly config: CreateServerConfig | null) {}

  /** 1 RPM あたりの消費（SU/RPM）。name は `create:` を外したブロック名 */
  impact(name: string): Resolved<number> {
    return this.stressValue(this.config?.impact, DEFAULT_IMPACT, name)
  }

  /** 1 RPM あたりの供給（SU/RPM） */
  capacity(name: string): Resolved<number> {
    return this.stressValue(this.config?.capacity, DEFAULT_CAPACITY, name)
  }

  maxRotationSpeed(): Resolved<number> {
    return this.setting((c) => c.maxRotationSpeed, DEFAULT_KINETICS.maxRotationSpeed)
  }

  disableStress(): Resolved<boolean> {
    return this.setting((c) => c.disableStress, DEFAULT_KINETICS.disableStress)
  }

  /** 「中速」の下限。ミキサーなどの必要回転数 */
  mediumSpeed(): Resolved<number> {
    return this.setting((c) => c.mediumSpeed, DEFAULT_KINETICS.mediumSpeed)
  }

  /** 「高速」の下限 */
  fastSpeed(): Resolved<number> {
    return this.setting((c) => c.fastSpeed, DEFAULT_KINETICS.fastSpeed)
  }

  /** ファンネルが取り出す間隔（tick）。docs/create-throughput.md「設定ファイルの項目」 */
  extractionTimer(): Resolved<number> {
    return this.setting((c) => c.extractionTimer, DEFAULT_LOGISTICS.extractionTimer)
  }

  /** プレスがスタックごと押すか */
  bulkPressing(): Resolved<boolean> {
    return this.setting((c) => c.bulkPressing, DEFAULT_LOGISTICS.bulkPressing)
  }

  private stressValue(
    table: ReadonlyMap<string, number> | undefined,
    defaults: Readonly<Record<string, number>>,
    name: string,
  ): Resolved<number> {
    // 設定ファイルの表にあればその値。なければ内蔵の初期値（ゲームも、設定ファイルにない項目は初期値で補う）。
    // 初期値も分からないブロック（応力を持たないブロック）は 0
    const fromConfig = this.config?.stressVersion !== null && table?.has(name) ? table.get(name)! : null
    return resolveWith(
      [candidate('modpack', () => fromConfig, this.config?.path)],
      resolved(Object.hasOwn(defaults, name) ? defaults[name] : 0, 'builtin'),
    )
  }

  private setting<T>(get: (c: CreateServerConfig) => T | null, fallback: T): Resolved<T> {
    const c = this.config
    return resolveWith([candidate('modpack', () => (c ? get(c) : null), c?.path)], resolved(fallback, 'builtin'))
  }
}
