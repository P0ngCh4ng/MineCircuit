import { describe, expect, it } from 'vitest'
import { strToU8 } from 'fflate'
import { MemoryFileSource } from '../../memoryFileSource'
import { orderScripts, readScriptHeader, readServerScripts } from './scriptFiles'

describe('readScriptHeader', () => {
  it('先頭の // の行から priority・ignored・requires を読み、コードの行で終わる', () => {
    expect(readScriptHeader('// priority: 10\n\n// requires: create\n// ignored: false\nconst x = 1\n// priority: 99')).toEqual({
      priority: 10,
      ignored: false,
      requires: ['create'],
    })
    expect(readScriptHeader('// ignore: true')).toMatchObject({ ignored: true })
    expect(readScriptHeader('const a = 1')).toEqual({ priority: 0, ignored: false, requires: [] })
  })
})

describe('orderScripts', () => {
  it('priority の大きいものから、同じなら大文字小文字を区別せずにパスの名前順。ignored と、Mod がないものは除く', () => {
    const files = [
      { path: 'b.js', text: '' },
      { path: 'A/z.js', text: '' },
      { path: 'a/b.js', text: '// priority: -1' },
      { path: 'late.js', text: '// priority: 5' },
      { path: 'off.js', text: '// ignored: true' },
      { path: 'mek.js', text: '// requires: mekanism' },
      { path: 'cr.js', text: '// requires: create' },
    ]
    const { files: ordered, skipped } = orderScripts(files, new Set(['create']))
    expect(ordered.map((f) => f.path)).toEqual(['late.js', 'A/z.js', 'b.js', 'cr.js', 'a/b.js'])
    expect(skipped).toEqual([
      { path: 'off.js', reason: 'ignored' },
      { path: 'mek.js', reason: 'requires: mekanism' },
    ])
  })
})

describe('readServerScripts', () => {
  it('下のフォルダも含めて .js だけを読む。フォルダがなければ空', async () => {
    const source = new MemoryFileSource([
      ['kubejs/server_scripts/a.js', strToU8('// a')],
      ['kubejs/server_scripts/recipes/create/milling.js', strToU8('// m')],
      ['kubejs/server_scripts/readme.txt', strToU8('x')],
    ])
    const read = await readServerScripts(source, 'kubejs/server_scripts')
    expect(read.files.map((f) => [f.path, f.text])).toEqual([
      ['a.js', '// a'],
      ['recipes/create/milling.js', '// m'],
    ])
    expect(await readServerScripts(new MemoryFileSource([]), 'kubejs/server_scripts')).toEqual({ files: [], problems: [] })
  })
})
