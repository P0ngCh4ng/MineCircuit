import { describe, expect, it } from 'vitest'
import { ITEM_TAG_PATH, flattenItemTags, mergeItemTagFile, mergeItemTagFiles, readItemTagFile, type ItemTagFiles } from './itemTags'

describe('ITEM_TAG_PATH', () => {
  it('tags/items/ と 1.21 の tags/item/ に当てはまり、namespace とパスを取り出す', () => {
    expect(ITEM_TAG_PATH.exec('data/forge/tags/items/ores/iron.json')?.slice(1)).toEqual(['forge', 'ores/iron'])
    expect(ITEM_TAG_PATH.exec('data/c/tags/item/ingots.json')?.slice(1)).toEqual(['c', 'ingots'])
    expect(ITEM_TAG_PATH.test('data/forge/tags/blocks/ores.json')).toBe(false)
    expect(ITEM_TAG_PATH.test('data/forge/tags/items/ores.txt')).toBe(false)
    expect(ITEM_TAG_PATH.test('assets/forge/tags/items/ores.json')).toBe(false)
  })
})

describe('readItemTagFile', () => {
  it('values の文字列と { id, required } を読み、namespace のない ID には minecraft: を付ける', () => {
    expect(
      readItemTagFile({ replace: false, values: ['create:zinc_ore', { id: '#forge:ores/zinc', required: false }, 'stick', '#logs', 3] }),
    ).toEqual({ replace: false, values: ['create:zinc_ore', '#forge:ores/zinc', 'minecraft:stick', '#minecraft:logs'] })
  })

  it('replace が true のときだけ replace にする。values がなければ null', () => {
    expect(readItemTagFile({ replace: true, values: [] })).toEqual({ replace: true, values: [] })
    expect(readItemTagFile({ replace: 'yes', values: ['a:b'] })).toEqual({ replace: false, values: ['a:b'] })
    expect(readItemTagFile({ type: 'create:milling' })).toBeNull()
    expect(readItemTagFile(['a:b'])).toBeNull()
    expect(readItemTagFile(null)).toBeNull()
  })
})

describe('mergeItemTagFile / mergeItemTagFiles', () => {
  it('後のファイルは値を足す。同じ値は1つにする', () => {
    expect(mergeItemTagFile({ replace: false, values: ['a:x', 'a:y'] }, { replace: false, values: ['a:y', 'b:z'] })).toEqual({
      replace: false,
      values: ['a:x', 'a:y', 'b:z'],
    })
  })

  it('後のファイルが replace なら前の値を捨て、まとめた結果も replace になる', () => {
    const merged = mergeItemTagFile({ replace: false, values: ['a:x'] }, { replace: true, values: ['b:y'] })
    expect(merged).toEqual({ replace: true, values: ['b:y'] })
    // replace のあとのファイルは値を足す
    expect(mergeItemTagFile(merged, { replace: false, values: ['c:z'] })).toEqual({ replace: true, values: ['b:y', 'c:z'] })
  })

  it('タグの集まりを読み込みの順にまとめる', () => {
    const all: ItemTagFiles = {}
    mergeItemTagFiles(all, { 'f:a': { replace: false, values: ['a:1'] }, 'f:b': { replace: false, values: ['b:1'] } })
    mergeItemTagFiles(all, { 'f:a': { replace: false, values: ['a:2'] }, 'f:b': { replace: true, values: ['b:2'] } })
    expect(all).toEqual({ 'f:a': { replace: false, values: ['a:1', 'a:2'] }, 'f:b': { replace: true, values: ['b:2'] } })
  })
})

describe('flattenItemTags', () => {
  it('入れ子のタグをたどって平らにする。知らないタグは飛ばす', () => {
    expect(
      flattenItemTags({
        'forge:ores': { replace: false, values: ['#forge:ores/iron', '#forge:ores/zinc', '#forge:ores/unknown'] },
        'forge:ores/iron': { replace: false, values: ['minecraft:iron_ore', 'minecraft:deepslate_iron_ore'] },
        'forge:ores/zinc': { replace: false, values: ['create:zinc_ore', 'minecraft:iron_ore'] },
      }),
    ).toEqual({
      'forge:ores': ['minecraft:iron_ore', 'minecraft:deepslate_iron_ore', 'create:zinc_ore'],
      'forge:ores/iron': ['minecraft:iron_ore', 'minecraft:deepslate_iron_ore'],
      'forge:ores/zinc': ['create:zinc_ore', 'minecraft:iron_ore'],
    })
  })

  it('タグが輪になっていても止まり、輪の中のどのタグからも全部のアイテムが見える', () => {
    const flat = flattenItemTags({
      'x:a': { replace: false, values: ['#x:b', 'x:item_a'] },
      'x:b': { replace: false, values: ['#x:c', 'x:item_b'] },
      'x:c': { replace: false, values: ['#x:a', 'x:item_c'] },
      'x:self': { replace: false, values: ['#x:self', 'x:item_self'] },
    })
    expect([...flat['x:a']].sort()).toEqual(['x:item_a', 'x:item_b', 'x:item_c'])
    expect([...flat['x:b']].sort()).toEqual(['x:item_a', 'x:item_b', 'x:item_c'])
    expect([...flat['x:c']].sort()).toEqual(['x:item_a', 'x:item_b', 'x:item_c'])
    expect(flat['x:self']).toEqual(['x:item_self'])
  })
})
