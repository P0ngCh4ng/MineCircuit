import { describe, expect, it } from 'vitest'
import { blueprintFixture } from '../../tests/fixtures/blueprintFixture'
import { BlockVolume } from '../domain/blockVolume'
import { BlockState } from '../domain/blockState'
import { Blueprint } from '../domain/blueprint'
import { ResourceLocation } from '../domain/resourceLocation'
import { BlockSearch, isEmptyQuery, matchesBlockQuery, parseBlockQuery } from './blockSearch'

function sample() {
  return blueprintFixture({ size: [3, 2, 2] })
    .place([2, 1, 0], 'create:shaft', { axis: 'x' })
    .place([0, 0, 1], 'create:shaft', { axis: 'y' })
    .place([1, 0, 0], 'create:shaft', { axis: 'y' })
    .place([0, 0, 0], 'minecraft:stone')
    .place([1, 1, 1], 'minecraft:air')
    .toBlueprint()
}

describe('parseBlockQuery', () => {
  it('空白（全角も）で区切り、小文字にする', () => {
    expect(parseBlockQuery('  Create:SHAFT　軸 ').terms).toEqual(['create:shaft', '軸'])
  })

  it('空の入力は言葉なし', () => {
    expect(isEmptyQuery(parseBlockQuery(' 　 '))).toBe(true)
    expect(isEmptyQuery(parseBlockQuery('a'))).toBe(false)
  })
})

describe('matchesBlockQuery', () => {
  it('ID の一部に合う。大文字と小文字は区別しない', () => {
    expect(matchesBlockQuery(parseBlockQuery('SHAFT'), 'create:shaft', null)).toBe(true)
    expect(matchesBlockQuery(parseBlockQuery('create:'), 'create:shaft', null)).toBe(true)
    expect(matchesBlockQuery(parseBlockQuery('cog'), 'create:shaft', null)).toBe(false)
  })

  it('表示名にも合う（Modpack を読み込んだとき）', () => {
    expect(matchesBlockQuery(parseBlockQuery('シャフト'), 'create:shaft', 'シャフト')).toBe(true)
    expect(matchesBlockQuery(parseBlockQuery('シャフト'), 'create:shaft', null)).toBe(false)
  })

  it('言葉がいくつかあれば、すべてに合うものだけ', () => {
    expect(matchesBlockQuery(parseBlockQuery('create シャフト'), 'create:shaft', 'シャフト')).toBe(true)
    expect(matchesBlockQuery(parseBlockQuery('minecraft シャフト'), 'create:shaft', 'シャフト')).toBe(false)
  })

  it('言葉がなければ何にでも合う', () => {
    expect(matchesBlockQuery(parseBlockQuery(''), 'create:shaft', null)).toBe(true)
  })
})

describe('BlockSearch.find', () => {
  const search = new BlockSearch()

  it('ID のブロックの位置を、向きの違いをまとめて y → z → x の順で返す', () => {
    expect(search.find(sample(), 'create:shaft')).toEqual([
      [1, 0, 0],
      [0, 0, 1],
      [2, 1, 0],
    ])
    expect(search.find(sample(), ResourceLocation.parse('minecraft:stone'))).toEqual([[0, 0, 0]])
  })

  it('namespace を省くと minecraft とみなす', () => {
    expect(search.find(sample(), 'stone')).toEqual([[0, 0, 0]])
  })

  it('properties を渡すと、その値のブロックだけ', () => {
    expect(search.find(sample(), 'create:shaft', { axis: 'y' })).toEqual([
      [1, 0, 0],
      [0, 0, 1],
    ])
    expect(search.find(sample(), 'create:shaft', { axis: 'z' })).toEqual([])
  })

  it('ないブロックと空気は空の一覧', () => {
    expect(search.find(sample(), 'create:cogwheel')).toEqual([])
    expect(search.find(sample(), 'minecraft:air')).toEqual([])
  })

  it('リージョンの位置を足した全体の座標で返し、重なる位置は先のリージョンだけを見る', () => {
    const stone = new BlockState(ResourceLocation.parse('minecraft:stone'))
    const shaft = new BlockState(ResourceLocation.parse('create:shaft'))
    const a = new BlockVolume({ name: 'a', size: [2, 1, 1], palette: [stone], cells: Int32Array.of(0, 0) })
    const b = new BlockVolume({ name: 'b', size: [2, 1, 1], offset: [1, 0, 0], palette: [shaft], cells: Int32Array.of(0, 0) })
    const bp = new Blueprint('two', 'litematic', 0, [a, b], {})
    expect(search.find(bp, 'minecraft:stone')).toEqual([
      [0, 0, 0],
      [1, 0, 0],
    ])
    expect(search.find(bp, 'create:shaft')).toEqual([[2, 0, 0]])
  })
})
