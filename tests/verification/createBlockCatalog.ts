// ブロックの一覧（docs/verification.md「1. ブロックの一覧」）を読む。
// 一覧は scripts/extractBlockIds.mjs と scripts/extractCreateSource.mjs で、利用者の jar と Create のソースから作る。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface CatalogBlockEntity {
  readonly type: string
  readonly class: string
  /** KineticBlockEntity を継ぐ（回るブロック） */
  readonly kinetic: boolean
}

export interface CatalogBlock {
  /** blockstates の形。multipart は、見た目に関わらないプロパティが欠けることがある */
  readonly kind: 'variants' | 'multipart'
  /** プロパティ → とりうる値 */
  readonly properties: Readonly<Record<string, readonly string[]>>
  readonly blockEntity?: readonly CatalogBlockEntity[]
  /** 応力の初期値（AllBlocks.java の setImpact・setCapacity）。ないものは 0 */
  readonly stress?: { readonly impact?: number; readonly capacity?: number }
}

export interface Catalog {
  /** 'create-6.0.10' など */
  readonly name: string
  readonly source: string
  readonly createSource: string
  readonly blocks: Readonly<Record<string, CatalogBlock>>
}

export const CATALOG_NAMES = ['create-0.5.1-fabric', 'create-6.0.10'] as const

export function loadCatalog(name: (typeof CATALOG_NAMES)[number]): Catalog {
  // テストはリポジトリの根から動く
  const path = join(process.cwd(), 'tests', 'verification', 'blocks', `${name}.json`)
  return { name, ...JSON.parse(readFileSync(path, 'utf8')) }
}

export const CATALOGS: readonly Catalog[] = CATALOG_NAMES.map(loadCatalog)

/** どれかの版にある ID */
export const ALL_BLOCK_IDS: ReadonlySet<string> = new Set(CATALOGS.flatMap((c) => Object.keys(c.blocks)))

/** どれかの版にあるブロックエンティティの種類 → その種類を持つ ID */
export function blockEntityTypes(): Map<string, Set<string>> {
  const types = new Map<string, Set<string>>()
  for (const c of CATALOGS) {
    for (const [id, b] of Object.entries(c.blocks)) {
      for (const e of b.blockEntity ?? []) {
        const ids = types.get(e.type) ?? new Set<string>()
        ids.add(id)
        types.set(e.type, ids)
      }
    }
  }
  return types
}
