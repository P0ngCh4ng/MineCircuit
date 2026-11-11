// ブロックの一覧と計算のコードを突き合わせて、抜けを調べる（docs/verification.md）。
// 抜けが見つかったら、直すか、下の「分かっている抜け」に理由を書いて載せる。直したら一覧から消す（消さないと失敗する）。
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_CAPACITY, DEFAULT_IMPACT } from '../../src/calc/create/createDefaults'
import { isKineticBlock } from '../../src/calc/create/kineticBlocks'
import { ALL_BLOCK_IDS, blockEntityTypes, CATALOGS } from './createBlockCatalog'
import { ITEM_PATH_ROLES } from './itemPathRoles'

const CREATE_DIR = join(process.cwd(), 'src', 'calc', 'create')
const source = (file: string) => readFileSync(join(CREATE_DIR, file), 'utf8')
const path = (id: string) => id.slice('create:'.length)

/** 分かっている抜け：回るブロックなのに、回転のつながりで扱わないもの */
const KNOWN_KINETIC_GAPS: Readonly<Record<string, string>> = {
  'create:fluid_valve': '液体のバルブは軸で回る。回転のつながりにない（#237 の 2）',
  'create:gantry_carriage': 'ガントリーの台車は軸のピニオンで回る。回転のつながりにない（#237 の 2）',
}

describe('ブロックの一覧', () => {
  it('どの版も、ID とブロックエンティティの出典を持つ', () => {
    for (const c of CATALOGS) {
      expect(c.source, c.name).toMatch(/\.jar$/)
      expect(c.createSource, c.name).toContain('AllBlockEntityTypes')
      expect(Object.keys(c.blocks).length, c.name).toBeGreaterThan(500)
    }
  })

  it('計算のコードが名前で扱う Create のブロックは、どれかの版にある（綴りの誤り・ない ブロックを見つける）', () => {
    const names = new Set<string>()
    for (const file of readdirSync(CREATE_DIR).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))) {
      const text = source(file)
      // blockEntityId はブロックエンティティの種類の名前なので、下の別のテストで調べる
      for (const m of text.matchAll(/(?<!blockEntityId: )'create:([a-z0-9_]+)'/g)) names.add(m[1]!)
      for (const m of text.matchAll(/path === '([a-z0-9_]+)'/g)) names.add(m[1]!)
    }
    for (const m of source('kineticBlocks.ts').matchAll(/new Set\(\[([^\]]*)\]\)/g)) {
      for (const n of m[1]!.matchAll(/'([a-z0-9_]+)'/g)) names.add(n[1]!)
    }
    Object.keys({ ...DEFAULT_IMPACT, ...DEFAULT_CAPACITY }).forEach((n) => names.add(n))
    // ブロックではない名前（レシピの種類など）は除く
    const notBlocks = new Set(['air'])
    const missing = [...names].filter((n) => !notBlocks.has(n) && !ALL_BLOCK_IDS.has(`create:${n}`))
    expect(missing).toEqual([])
  })
})

it('計算のコードが使うブロックエンティティの種類の名前は、どれかの版にある', () => {
  const types = blockEntityTypes()
  const names = [...source('createBlockSettings.ts').matchAll(/blockEntityId: 'create:([a-z0-9_]+)'/g)].map((m) => m[1]!)
  expect(names.length).toBeGreaterThan(0)
  expect(names.filter((n) => !types.has(n))).toEqual([])
})

describe('回転のつながり', () => {
  for (const c of CATALOGS) {
    it(`${c.name}：Create で回るブロック（KineticBlockEntity）と、計算で回るブロックが一致する`, () => {
      const ids = Object.keys(c.blocks)
      const kinetic = ids.filter((id) => c.blocks[id]!.blockEntity?.some((e) => e.kinetic))
      const notHandled = kinetic.filter((id) => !isKineticBlock(path(id)) && !KNOWN_KINETIC_GAPS[id])
      const notKinetic = ids.filter((id) => isKineticBlock(path(id)) && !kinetic.includes(id))
      expect(notHandled, '回るのに扱わない').toEqual([])
      expect(notKinetic, '回らないのに回るとしている').toEqual([])
    })
  }

  it('分かっている抜けは、まだ抜けている（直したら一覧から消す）', () => {
    for (const id of Object.keys(KNOWN_KINETIC_GAPS)) expect(isKineticBlock(path(id)), id).toBe(false)
  })
})

describe('応力の初期値', () => {
  for (const c of CATALOGS) {
    it(`${c.name}：すべてのブロックで、Create のソースの値と一致する`, () => {
      const wrong: string[] = []
      for (const [id, b] of Object.entries(c.blocks)) {
        const impact = DEFAULT_IMPACT[path(id)] ?? 0
        const capacity = DEFAULT_CAPACITY[path(id)] ?? 0
        if (impact !== (b.stress?.impact ?? 0)) wrong.push(`${id} impact ${impact} / ソース ${b.stress?.impact ?? 0}`)
        if (capacity !== (b.stress?.capacity ?? 0)) wrong.push(`${id} capacity ${capacity} / ソース ${b.stress?.capacity ?? 0}`)
      }
      expect(wrong).toEqual([])
    })
  }
})

describe('物の通り道', () => {
  const types = blockEntityTypes()
  const itemPathSource = source('createItemPath.ts')
  /** 物の通り道のコードに名前が出てくるが、たどる対象ではないブロック */
  const MENTIONED_ONLY = new Set(['create:encased_fan'])

  it('すべてのブロックエンティティの種類に、扱いが決まっている', () => {
    expect([...types.keys()].filter((t) => !ITEM_PATH_ROLES[t]).sort()).toEqual([])
    expect(Object.keys(ITEM_PATH_ROLES).filter((t) => !types.has(t)), '一覧にない種類').toEqual([])
  })

  it('たどる種類のブロックは、物の通り道のコードに処理がある。たどらない種類にはない', () => {
    const wrong: string[] = []
    for (const [type, ids] of types) {
      const role = ITEM_PATH_ROLES[type]
      if (!role) continue
      for (const id of ids) {
        const inCode = itemPathSource.includes(`'${id}'`)
        const expected = role.role === 'traced' || role.role === 'inventory'
        if (expected && !inCode) wrong.push(`${id}（${type}）はたどる表なのに、コードにない`)
        if (!expected && inCode && !MENTIONED_ONLY.has(id)) wrong.push(`${id}（${type}）は ${role.role} なのに、コードにある`)
      }
    }
    expect(wrong).toEqual([])
  })
})
