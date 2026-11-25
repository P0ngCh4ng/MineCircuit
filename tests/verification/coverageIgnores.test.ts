// 通せない分岐の印（docs/create-verification.md「4. コードの分岐」）を調べる。
// 印そのものが「通せない分岐の一覧」なので、どの印にも理由があること、start と stop が組になっていることを確かめる。
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const DIR = join(__dirname, '../../src/calc/create')

/** 網羅率の道具が読む印（istanbul・c8・v8 のどれでも効くので、全部を拾う） */
const MARKER = /(?:istanbul|[cv]8|node:coverage)\s+ignore\s+(next|if|else|start|stop|file)\b(.*)$/

interface Marker {
  readonly file: string
  readonly line: number
  readonly kind: string
  readonly reason: string
}

function markers(): Marker[] {
  const out: Marker[] = []
  for (const file of readdirSync(DIR).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts')).sort()) {
    readFileSync(join(DIR, file), 'utf8')
      .split('\n')
      .forEach((text, i) => {
        const m = MARKER.exec(text)
        if (!m) return
        const reason = /^\s*--\s*(.*?)\s*(?:\*\/)?\s*$/.exec(m[2] ?? '')?.[1] ?? ''
        out.push({ file, line: i + 1, kind: m[1]!, reason })
      })
  }
  return out
}

describe('通せない分岐の印', () => {
  const all = markers()

  it('どの印にも、-- のあとに理由がある（stop を除く）', () => {
    expect(all.filter((m) => m.kind !== 'stop' && m.reason.length < 4).map((m) => `${m.file}:${m.line}`)).toEqual([])
  })

  it('ファイル全体を外す印は使わない', () => {
    expect(all.filter((m) => m.kind === 'file').map((m) => `${m.file}:${m.line}`)).toEqual([])
  })

  it('start と stop が、同じファイルの中で順に組になっている', () => {
    const problems: string[] = []
    for (const file of new Set(all.map((m) => m.file))) {
      let open: Marker | null = null
      for (const m of all.filter((x) => x.file === file)) {
        if (m.kind === 'start') {
          if (open) problems.push(`${file}:${m.line} の start の前の start（${open.line}）が閉じていない`)
          open = m
        } else if (m.kind === 'stop') {
          if (!open) problems.push(`${file}:${m.line} の stop に start がない`)
          open = null
        }
      }
      if (open) problems.push(`${file}:${open.line} の start が閉じていない`)
    }
    expect(problems).toEqual([])
  })
})
