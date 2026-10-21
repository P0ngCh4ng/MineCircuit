import { describe, expect, it } from 'vitest'
import { fakeJar } from '../../tests/fixtures/fakeJar'
import { scanJar } from '../io/modpack/jarScanner'
import { Modpack } from '../io/modpack/modpack'
import { BlockCatalog, blockCatalogFor, normalizeSearchText } from './blockCatalog'

const variants = { variants: { '': { model: 'x:block/a' } } }

/** Create に似せた小さな Modpack（本物の jar の中身は入れない） */
function pack(): Modpack {
  const create = fakeJar({
    forgeMods: [{ modId: 'create' }],
    blockStates: {
      'create:creative_motor': variants,
      'create:shaft': variants,
      'create:cogwheel': variants,
      'create:large_cogwheel': variants,
    },
    lang: {
      create: {
        ja_jp: {
          'block.create.creative_motor': 'クリエイティブモーター',
          'block.create.shaft': 'シャフト',
          'block.create.cogwheel': '歯車',
        },
        en_us: {
          'block.create.creative_motor': 'Creative Motor',
          'block.create.shaft': 'Shaft',
          'block.create.cogwheel': 'Cogwheel',
          'block.create.large_cogwheel': 'Large Cogwheel',
          // ブロック状態の定義がないもの（アイテムだけ）は一覧に入らない
          'item.create.wrench': 'Wrench',
        },
      },
    },
  })
  const other = fakeJar({
    forgeMods: [{ modId: 'motors' }],
    blockStates: { 'motors:electric_motor': variants },
    lang: { motors: { en_us: { 'block.motors.electric_motor': 'Electric Motor' } } },
  })
  return new Modpack([scanJar('create.jar', create), scanJar('motors.jar', other)], null)
}

describe('BlockCatalog', () => {
  it('ブロック状態の定義があるブロックを、日本語名と英語名つきで一覧にする', () => {
    const p = pack()
    expect(p.blockIds()).toEqual([
      'create:cogwheel',
      'create:creative_motor',
      'create:large_cogwheel',
      'create:shaft',
      'motors:electric_motor',
    ])
    const catalog = BlockCatalog.fromSource(p)
    expect(catalog.size).toBe(5)
    expect(catalog.search('create:shaft').entries).toEqual([{ id: 'create:shaft', ja: 'シャフト', en: 'Shaft' }])
  })

  it('日本語名で探す（ひらがなでも合う）', () => {
    const catalog = BlockCatalog.fromSource(pack())
    expect(catalog.search('モーター').entries.map((e) => e.id)).toEqual(['create:creative_motor'])
    expect(catalog.search('もーたー').entries.map((e) => e.id)).toEqual(['create:creative_motor'])
  })

  it('英語名と ID の一部で探す。大文字と全角も区別しない', () => {
    const catalog = BlockCatalog.fromSource(pack())
    expect(catalog.search('motor').entries.map((e) => e.id)).toEqual(['motors:electric_motor', 'create:creative_motor'])
    expect(catalog.search('ＭＯＴＯＲ').total).toBe(2)
    expect(catalog.search('creative_mo').entries.map((e) => e.id)).toEqual(['create:creative_motor'])
  })

  it('空白で区切った言葉はすべてに合うものだけ。そのままの名前・言葉で始まるものを先に並べる', () => {
    const catalog = BlockCatalog.fromSource(pack())
    expect(catalog.search('large cog').entries.map((e) => e.id)).toEqual(['create:large_cogwheel'])
    // "cogwheel" と同じ ID の path を持つものが先
    expect(catalog.search('cogwheel').entries.map((e) => e.id)).toEqual(['create:cogwheel', 'create:large_cogwheel'])
    expect(catalog.search('  ').entries).toEqual([])
    expect(catalog.search('nothing').total).toBe(0)
  })

  it('limit で結果を絞り、合った数は total で返す', () => {
    const catalog = BlockCatalog.fromSource(pack())
    const r = catalog.search('create', 2)
    expect(r.entries).toHaveLength(2)
    expect(r.total).toBe(4)
  })

  it('数万ブロックでも速く探せる', () => {
    const entries = Array.from({ length: 40000 }, (_, i) => ({
      id: `mod${i % 200}:block_${i}`,
      ja: `ブロック${i}`,
      en: `Block ${i}`,
    }))
    const catalog = new BlockCatalog(entries)
    const start = performance.now()
    for (const q of ['block', 'ブロック1', 'mod7:', 'zzz']) catalog.search(q)
    const elapsed = performance.now() - start
    expect(catalog.search('block_39999').entries[0].id).toBe('mod199:block_39999')
    // 1回あたり数十ミリ秒以内（遅い環境でも余裕を持たせる）
    expect(elapsed).toBeLessThan(1000)
  })

  it('同じ Modpack の一覧は一度だけ作る', () => {
    const p = pack()
    expect(blockCatalogFor(p)).toBe(blockCatalogFor(p))
  })

  it('normalizeSearchText は全角を半角に、ひらがなをカタカナに、小文字にする', () => {
    expect(normalizeSearchText('Ｃｒｅａｔｅ くりえいてぃぶ')).toBe('create クリエイティブ')
  })
})
