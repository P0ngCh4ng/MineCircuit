import { describe, expect, it } from 'vitest'
import { ResourceLocation } from '../../domain/resourceLocation'
import { jarKeyPrefix } from './indexedDbJarCache'
import type { JarSummary } from './jarScanner'
import { Modpack } from './modpack'

function summary(jar: string, partial: Partial<JarSummary>): JarSummary {
  return { jar, mods: [], namespaces: [], lang: { ja_jp: {}, en_us: {} }, blockStates: {}, problems: [], ...partial }
}

describe('Modpack', () => {
  it('後の jar の表示名を優先し、item の名前でも探す', () => {
    const pack = new Modpack(
      [
        summary('a.jar', { namespaces: ['x'], lang: { ja_jp: { 'block.x.a': '前', 'item.x.b': 'アイテムB' }, en_us: {} } }),
        summary('b.jar', { namespaces: ['x', 'y'], lang: { ja_jp: { 'block.x.a': '後' }, en_us: {} } }),
      ],
      null,
    )
    expect(pack.displayName(ResourceLocation.parse('x:a'), 'ja_jp')).toBe('後')
    expect(pack.displayName(ResourceLocation.parse('x:b'), 'ja_jp')).toBe('アイテムB')
    expect(pack.namespaces).toEqual(['x', 'y'])
  })

  it('jar の中の問題を problems に入れる。source がなければ config は null', async () => {
    const pack = new Modpack([summary('a.jar', { problems: ['p1'] })], null, [{ jar: 'z.jar', message: 'm' }])
    expect(pack.problems).toEqual([
      { jar: 'z.jar', message: 'm' },
      { jar: 'a.jar', message: 'p1' },
    ])
    expect(await pack.config('config/a.toml')).toBeNull()
  })
})

describe('jarKeyPrefix', () => {
  it('同じ jar の鍵に共通の前半を返す', () => {
    expect(jarKeyPrefix('v1|create-6.0.jar|100|200')).toBe('v1|create-6.0.jar|')
    expect(jarKeyPrefix('v1|a.jar|3|h0000abcd')).toBe('v1|a.jar|')
  })
})
