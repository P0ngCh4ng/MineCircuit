// 規則の一覧（docs/verification.md「3. 規則の一覧」）の抜けを調べる。
// 書類に書いた規則 ID、テストの名前に出てくる ID、rules.ts の一覧の三つが一致すること。
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { RULES } from './rules'

const ROOT = process.cwd()
/** 書類では `ST-…`・`TP-…` の形で規則を書く */
const DOC_ID = /`((?:ST|TP)-[A-Z0-9]+(?:-[A-Z0-9]+)*)`/g
/** テストの名前では [ST-…] の形で書く。表で回すテストは、行のデータに 'ST-…' の形で書いて名前に入れる（TP- も同じ） */
const TEST_ID = /(?:\[|')((?:ST|TP)-[A-Z0-9]+(?:-[A-Z0-9]+)*)(?:\]|')/g

function testFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name)
    if (e.isDirectory()) return testFiles(path)
    return e.name.endsWith('.test.ts') ? [path] : []
  })
}

const docs = [...new Set(Object.values(RULES).map((r) => r.doc))]

/** テストのファイルに出てくる規則 ID → ファイル */
const inTests = new Map<string, string[]>()
for (const file of [...testFiles(join(ROOT, 'src')), ...testFiles(join(ROOT, 'tests'))]) {
  for (const m of readFileSync(file, 'utf8').matchAll(TEST_ID)) {
    inTests.set(m[1]!, [...(inTests.get(m[1]!) ?? []), file])
  }
}

describe('規則の一覧', () => {
  for (const doc of docs) {
    it(`${doc} の規則 ID と rules.ts の一覧が一致する`, () => {
      const inDoc = new Set([...readFileSync(join(ROOT, 'docs', doc), 'utf8').matchAll(DOC_ID)].map((m) => m[1]!))
      const listed = Object.entries(RULES)
        .filter(([, r]) => r.doc === doc)
        .map(([id]) => id)
      expect([...inDoc].filter((id) => !RULES[id]).sort(), '書類にあるのに一覧にない').toEqual([])
      expect(listed.filter((id) => !inDoc.has(id)).sort(), '一覧にあるのに書類にない').toEqual([])
    })
  }

  it('テストに出てくる規則 ID は、すべて一覧にある', () => {
    expect([...inTests.keys()].filter((id) => !RULES[id]).sort()).toEqual([])
  })

  it('固定のテスト（B）があるとした規則は、テストの名前に出てくる。出てくる規則は B がある', () => {
    const withB = Object.entries(RULES).filter(([, r]) => r.stages.includes('B'))
    expect(withB.filter(([id]) => !inTests.has(id)).map(([id]) => id).sort(), 'B なのにテストがない').toEqual([])
    expect([...inTests.keys()].filter((id) => RULES[id] && !RULES[id].stages.includes('B')).sort(), 'テストがあるのに B がない').toEqual([])
  })

  it('どの規則にも出典がある', () => {
    expect(Object.entries(RULES).filter(([, r]) => r.source.trim() === '').map(([id]) => id)).toEqual([])
  })

  it('応力（ST）と物の通り道・輸送量（TP）の規則は、どれもソースとの照合（A。Create にない規則は除く）と固定のテスト（B）がある（#237 の 2・3）', () => {
    const missing = Object.entries(RULES)
      .filter(([id]) => id.startsWith('ST-') || id.startsWith('TP-'))
      .filter(([, r]) => !r.stages.includes('B') || (!r.source.startsWith('このアプリ') && !r.stages.includes('A')))
      .map(([id]) => id)
    expect(missing).toEqual([])
  })
})
