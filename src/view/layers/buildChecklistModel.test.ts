import { describe, expect, it } from 'vitest'
import {
  CHECKLIST_MEMORY,
  checklistKey,
  parseChecklist,
  serializeChecklist,
  withDoneLayers,
} from './buildChecklistModel'

describe('建築チェックリストの保存の形', () => {
  it('設計図はファイル名と大きさで見分ける', () => {
    expect(checklistKey('mill.nbt', [9, 12, 7])).toBe('mill.nbt|9x12x7')
  })

  it('書いて読み直すと同じになる', () => {
    const entries = withDoneLayers(withDoneLayers(new Map(), 'a|1x2x1', [1, 0]), 'b|3x3x3', [2])
    const back = parseChecklist(serializeChecklist(entries))
    expect([...back]).toEqual([
      ['b|3x3x3', [2]],
      ['a|1x2x1', [0, 1]],
    ])
  })

  it('壊れた文字や形の違うものは読み飛ばす', () => {
    expect(parseChecklist(null).size).toBe(0)
    expect(parseChecklist('{').size).toBe(0)
    expect(parseChecklist('null').size).toBe(0)
    expect(parseChecklist('{"entries": 3}').size).toBe(0)
    const text = JSON.stringify({
      version: 1,
      entries: [
        ['ok', [3, 1, 3]],
        'x',
        [1, [0]],
        ['neg', [-1]],
        ['frac', [0.5]],
        ['empty', []],
        ['ok', [9]],
        ['three', [0], 'x'],
      ],
    })
    expect([...parseChecklist(text)]).toEqual([['ok', [1, 3]]])
  })

  it('使った設計図を先頭に置き、空にしたら忘れ、覚える数を超えたら古いものから忘れる', () => {
    let entries = new Map<string, readonly number[]>()
    for (let i = 0; i < CHECKLIST_MEMORY + 2; i++) entries = new Map(withDoneLayers(entries, `bp${i}`, [0]))
    expect(entries.size).toBe(CHECKLIST_MEMORY)
    expect([...entries.keys()][0]).toBe(`bp${CHECKLIST_MEMORY + 1}`)
    expect(entries.has('bp0')).toBe(false)

    const touched = withDoneLayers(entries, 'bp5', [0, 2])
    expect([...touched.keys()][0]).toBe('bp5')
    expect(touched.get('bp5')).toEqual([0, 2])
    expect(withDoneLayers(touched, 'bp5', []).has('bp5')).toBe(false)

    const many = JSON.stringify({ entries: Array.from({ length: CHECKLIST_MEMORY + 5 }, (_, i) => [`k${i}`, [0]]) })
    expect(parseChecklist(many).size).toBe(CHECKLIST_MEMORY)
  })
})
