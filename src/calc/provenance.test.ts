import { describe, expect, it } from 'vitest'
import { AssumptionLog } from './assumptionLog'
import { candidate, resolveFirst, resolveWith, resolved } from './provenance'

describe('値を優先順に探す', () => {
  it('最初に値があった候補の出どころを付けて返す', () => {
    const r = resolveFirst<number>([
      candidate('blueprint', () => null),
      candidate('modpack', () => 32, 'create-server.toml'),
      candidate('builtin', () => 16),
    ])
    expect(r).toEqual({ value: 32, source: 'modpack', note: 'create-server.toml' })
  })

  it('0 や空文字は値として使う。null と undefined だけを飛ばす', () => {
    expect(resolveFirst<number>([candidate('blueprint', () => undefined), candidate('modpack', () => 0)])).toEqual({
      value: 0,
      source: 'modpack',
    })
    expect(resolveFirst<string>([candidate('blueprint', () => '')])?.value).toBe('')
  })

  it('どれにもなければ null、resolveWith なら fallback', () => {
    expect(resolveFirst<number>([candidate('blueprint', () => null)])).toBeNull()
    expect(resolveWith<number>([], resolved(16, 'builtin'))).toEqual({ value: 16, source: 'builtin' })
  })

  it('候補の get は前から順に、見つかるまでだけ呼ぶ', () => {
    const calls: string[] = []
    resolveFirst<number>([
      candidate('blueprint', () => (calls.push('a'), null)),
      candidate('modpack', () => (calls.push('b'), 1)),
      candidate('builtin', () => (calls.push('c'), 2)),
    ])
    expect(calls).toEqual(['a', 'b'])
  })
})

describe('AssumptionLog', () => {
  it('fallback が assumed のときだけ仮定に載せる', () => {
    const log = new AssumptionLog()
    const a = log.resolve<number>([candidate('blueprint', () => null)], resolved(1, 'assumed', '水の流れを +1 とみなした'), [1, 2, 3])
    const b = log.resolve<number>([candidate('blueprint', () => null)], resolved(16, 'builtin'))
    const c = log.resolve<number>([candidate('blueprint', () => 8)], resolved(1, 'assumed', '使われない'))
    expect(a.source).toBe('assumed')
    expect(b.source).toBe('builtin')
    expect(c).toEqual({ value: 8, source: 'blueprint' })
    expect(log.list()).toEqual([{ pos: [1, 2, 3], message: '水の流れを +1 とみなした' }])
  })

  it('同じ位置・同じ文の仮定は1つにまとめる', () => {
    const log = new AssumptionLog()
    log.add('範囲外は空気とみなした', [0, 0, 0])
    log.add('範囲外は空気とみなした', [0, 0, 0])
    log.add('範囲外は空気とみなした', [1, 0, 0])
    log.add('設定ファイルがないので内蔵の初期値を使った')
    log.add('設定ファイルがないので内蔵の初期値を使った')
    expect(log.size).toBe(3)
    expect(log.list()[2]).toEqual({ message: '設定ファイルがないので内蔵の初期値を使った' })
  })
})
