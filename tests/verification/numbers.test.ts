// 数値の一覧（docs/create-verification.md「5. 数値」）の抜けを調べる。
// src/calc/create/ のテスト以外のファイルの数を構文木から集め、numbers.ts の一覧と比べる。
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { NUMBERS } from './numbers'
import { RULES } from './rules'

const ROOT = process.cwd()
const DIR = join(ROOT, 'src', 'calc', 'create')

/** 宣言の名前。一番外の定数・関数・クラスと、クラスのメソッド（`クラス.メソッド`） */
function ownerName(node: ts.Node, owner: string | null): string | null {
  if (owner === null) {
    if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name) return node.name.text
    if (ts.isVariableStatement(node)) return node.declarationList.declarations.map((d) => d.name.getText()).join(',')
  }
  if (owner !== null && ts.isMethodDeclaration(node)) return `${owner.split('.')[0]}.${node.name.getText()}`
  return owner
}

/** 数えない数：0・1、配列の添字 */
function ignored(node: ts.NumericLiteral, value: number): boolean {
  if (value === 0 || value === 1) return true
  return ts.isElementAccessExpression(node.parent) && node.parent.argumentExpression === node
}

/** `ファイル名#宣言の名前` → その宣言にある数 */
function collectNumbers(): Map<string, number[]> {
  const found = new Map<string, number[]>()
  const files = readdirSync(DIR).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
  for (const file of files) {
    const source = ts.createSourceFile(file, readFileSync(join(DIR, file), 'utf8'), ts.ScriptTarget.Latest, true)
    const visit = (node: ts.Node, owner: string | null): void => {
      const name = ownerName(node, owner)
      if (ts.isNumericLiteral(node) && name !== null) {
        const value = Number(node.text)
        if (!ignored(node, value)) {
          const key = `${file}#${name}`
          found.set(key, [...(found.get(key) ?? []), value])
        }
      }
      ts.forEachChild(node, (child) => visit(child, name))
    }
    for (const statement of source.statements) visit(statement, null)
  }
  return found
}

const sorted = (values: readonly number[]): number[] => [...values].sort((a, b) => a - b)
const found = collectNumbers()

describe('数値の一覧', () => {
  it('コードのどの宣言の数も、一覧の同じ見出しの数と一致する', () => {
    const mismatched = [...found].filter(([key, values]) => {
      const listed = (NUMBERS[key] ?? []).flatMap((g) => g.values)
      return JSON.stringify(sorted(listed)) !== JSON.stringify(sorted(values))
    })
    expect(mismatched.map(([key, values]) => `${key}: ${JSON.stringify(values)}`)).toEqual([])
  })

  it('一覧の見出しは、どれもコードにある', () => {
    expect(Object.keys(NUMBERS).filter((key) => !found.has(key))).toEqual([])
  })

  it('Create・Minecraft から読んだ数（game）には規則 ID があり、どれも規則の一覧にある', () => {
    const groups = Object.entries(NUMBERS).flatMap(([key, gs]) => gs.map((g) => ({ key, g })))
    expect(groups.filter(({ g }) => g.kind === 'game' && g.rules.length === 0).map(({ key }) => key)).toEqual([])
    const unknown = groups.flatMap(({ key, g }) => g.rules.filter((id) => !RULES[id]).map((id) => `${key}: ${id}`))
    expect(unknown).toEqual([])
  })

  it('このアプリが決めた数（app）と規則によらない数（math）には理由がある', () => {
    const missing = Object.entries(NUMBERS).filter(([, gs]) => gs.some((g) => g.kind !== 'game' && g.note.trim() === ''))
    expect(missing.map(([key]) => key)).toEqual([])
  })

  it('Create・Minecraft から読んだ数があるファイルは、README の「注記」に載っている', () => {
    const readme = readFileSync(join(ROOT, 'README.md'), 'utf8')
    const notes = readme.slice(readme.indexOf('## 注記'))
    const files = new Set(
      Object.entries(NUMBERS)
        .filter(([, gs]) => gs.some((g) => g.kind === 'game'))
        .map(([key]) => key.split('#')[0]!),
    )
    expect([...files].filter((file) => !notes.includes(file))).toEqual([])
  })
})
