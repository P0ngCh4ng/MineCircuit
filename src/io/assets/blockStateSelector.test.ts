import { describe, expect, it } from 'vitest'
import type { JsonValue } from '../modpack/jarScanner'
import { conditionMatches, selectModels, variantKeyMatches } from './blockStateSelector'

describe('variantKeyMatches', () => {
  it('"" と "normal" はどの状態にも合う', () => {
    expect(variantKeyMatches('', { axis: 'y' })).toBe(true)
    expect(variantKeyMatches('normal', {})).toBe(true)
  })

  it('キーの値がすべて同じなら合う。キーにない property は何でもよい', () => {
    expect(variantKeyMatches('axis=y', { axis: 'y', powered: 'true' })).toBe(true)
    expect(variantKeyMatches('axis=y,powered=false', { axis: 'y', powered: 'true' })).toBe(false)
    expect(variantKeyMatches('facing=north', {})).toBe(false)
  })
})

describe('conditionMatches', () => {
  const s = { facing: 'north', powered: 'true', level: '3' }

  it('when がなければ常に合う', () => {
    expect(conditionMatches(undefined, s)).toBe(true)
  })

  it('値の | はどれか', () => {
    expect(conditionMatches({ facing: 'south|north' }, s)).toBe(true)
    expect(conditionMatches({ facing: 'south|east' }, s)).toBe(false)
  })

  it('複数の property はすべて合うとき', () => {
    expect(conditionMatches({ facing: 'north', powered: 'true' }, s)).toBe(true)
    expect(conditionMatches({ facing: 'north', powered: 'false' }, s)).toBe(false)
  })

  it('文字列でない値は文字列にして比べる', () => {
    expect(conditionMatches({ powered: true, level: 3 }, s)).toBe(true)
  })

  it('! は全体の否定', () => {
    expect(conditionMatches({ facing: '!south' }, s)).toBe(true)
    expect(conditionMatches({ facing: '!south|north' }, s)).toBe(false)
    expect(conditionMatches({ missing: '!x' }, s)).toBe(true)
    expect(conditionMatches({ missing: 'x' }, s)).toBe(false)
  })

  it('OR と AND', () => {
    expect(conditionMatches({ OR: [{ facing: 'south' }, { powered: 'true' }] }, s)).toBe(true)
    expect(conditionMatches({ OR: [{ facing: 'south' }, { powered: 'false' }] }, s)).toBe(false)
    expect(conditionMatches({ AND: [{ facing: 'north' }, { powered: 'true' }] }, s)).toBe(true)
    expect(conditionMatches({ AND: [{ facing: 'north' }, { powered: 'false' }] }, s)).toBe(false)
    expect(conditionMatches({ OR: [{ AND: [{ facing: 'north' }, { level: '3' }] }, { facing: 'east' }] }, s)).toBe(true)
  })

  it('形の分からない条件は合わない', () => {
    expect(conditionMatches('facing=north', s)).toBe(false)
    expect(conditionMatches({ OR: { facing: 'north' } }, s)).toBe(false)
  })
})

describe('selectModels', () => {
  it('variants：合うキーのモデル。重み付きの配列は先頭。namespace のない ID は minecraft', () => {
    const def: JsonValue = {
      variants: {
        'axis=x': { model: 'test:block/log', x: 90, y: 90 },
        'axis=y': [{ model: 'block/stone', weight: 3 }, { model: 'test:block/other' }],
      },
    }
    expect(selectModels(def, { axis: 'x' }).refs).toEqual([{ model: 'test:block/log', x: 90, y: 90, uvlock: false }])
    expect(selectModels(def, { axis: 'y' }).refs).toEqual([{ model: 'minecraft:block/stone', x: 0, y: 0, uvlock: false }])
  })

  it('variants：複数合えば後のもの', () => {
    const def: JsonValue = { variants: { '': { model: 'test:a' }, 'axis=y': { model: 'test:b', uvlock: true } } }
    expect(selectModels(def, { axis: 'y' }).refs).toEqual([{ model: 'test:b', x: 0, y: 0, uvlock: true }])
    expect(selectModels(def, { axis: 'x' }).refs?.[0]?.model).toBe('test:a')
  })

  it('variants：合うものがなければ null と理由', () => {
    const r = selectModels({ variants: { 'axis=x': { model: 'test:a' } } }, { axis: 'z' })
    expect(r.refs).toBeNull()
    expect(r.notes[0]).toContain('合うもの')
  })

  describe('足りない property を補う（#247）', () => {
    // 古い版で保存したベルトのように、状態に waterlogged がない
    const def: JsonValue = {
      variants: {
        'facing=north,part=end,waterlogged=false': { model: 'test:end_dry' },
        'facing=north,part=end,waterlogged=true': { model: 'test:end_wet' },
        'facing=south,part=end,waterlogged=false': { model: 'test:south' },
      },
    }

    it('完全に合うキーがあればそれを選び、何も補わない', () => {
      const r = selectModels(def, { facing: 'north', part: 'end', waterlogged: 'true' })
      expect(r.refs?.[0]?.model).toBe('test:end_wet')
      expect(r.notes).toEqual([])
    })

    it('状態にない property は問わずに選び、補ったことを notes に書く', () => {
      const r = selectModels(def, { facing: 'south', part: 'end' })
      expect(r.refs?.[0]?.model).toBe('test:south')
      expect(r.notes).toEqual(['waterlogged がないので false とみなしました'])
    })

    it('候補が複数なら false を優先する（先に書いたかどうかによらない）', () => {
      const wetFirst: JsonValue = {
        variants: { 'part=end,waterlogged=true': { model: 'test:wet' }, 'part=end,waterlogged=false': { model: 'test:dry' } },
      }
      expect(selectModels(wetFirst, { part: 'end' }).refs?.[0]?.model).toBe('test:dry')
      expect(selectModels(def, { facing: 'north', part: 'end' }).refs?.[0]?.model).toBe('test:end_dry')
    })

    it('false がなければ先に書かれた値。足りない property ごとに決める', () => {
      const multi: JsonValue = {
        variants: {
          'axis=x,color=red,lit=true': { model: 'test:red_lit' },
          'axis=x,color=blue,lit=false': { model: 'test:blue_unlit' },
          'axis=x,color=red,lit=false': { model: 'test:red_unlit' },
          'axis=y,color=green,lit=false': { model: 'test:other_axis' },
        },
      }
      const r = selectModels(multi, { axis: 'x' })
      expect(r.refs?.[0]?.model).toBe('test:red_unlit')
      expect(r.notes).toEqual(['color がないので red とみなしました', 'lit がないので false とみなしました'])
    })

    it('状態にある property の値が違うキーは選ばない', () => {
      const r = selectModels(def, { facing: 'east', part: 'end' })
      expect(r.refs).toBeNull()
      expect(r.notes).toEqual(['blockstates の variants に、この状態に合うものがありません'])
    })

    it('補って残った候補からは後に書いたもの', () => {
      const loose: JsonValue = { variants: { 'lit=false': { model: 'test:a' }, 'axis=x,lit=false': { model: 'test:b' } } }
      expect(selectModels(loose, { axis: 'x' }).refs?.[0]?.model).toBe('test:b')
    })
  })

  it('90 度単位でない回転は 0 にして書き残す。360 以上は回り直す', () => {
    const r = selectModels({ variants: { '': { model: 'test:a', x: 45, y: 450 } } }, {})
    expect(r.refs).toEqual([{ model: 'test:a', x: 0, y: 90, uvlock: false }])
    expect(r.notes).toHaveLength(1)
  })

  it('multipart：合う部分をすべて重ねる', () => {
    const def: JsonValue = {
      multipart: [
        { apply: { model: 'test:post' } },
        { when: { north: 'true' }, apply: { model: 'test:side', uvlock: true } },
        { when: { east: 'true' }, apply: [{ model: 'test:side' }, { model: 'test:side_alt' }] },
        { when: { OR: [{ north: 'true' }, { east: 'true' }] }, apply: { model: 'test:cap', y: 180 } },
      ],
    }
    expect(selectModels(def, { north: 'false', east: 'false' }).refs?.map((r) => r.model)).toEqual(['test:post'])
    expect(selectModels(def, { north: 'true', east: 'false' }).refs).toEqual([
      { model: 'test:post', x: 0, y: 0, uvlock: false },
      { model: 'test:side', x: 0, y: 0, uvlock: true },
      { model: 'test:cap', x: 0, y: 180, uvlock: false },
    ])
    expect(selectModels(def, { north: 'false', east: 'true' }).refs?.map((r) => r.model)).toEqual(['test:post', 'test:side', 'test:cap'])
  })

  it('variants も multipart もなければ null', () => {
    expect(selectModels({}, {}).refs).toBeNull()
    expect(selectModels([], {}).refs).toBeNull()
  })
})
