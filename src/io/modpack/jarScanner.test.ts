import { describe, expect, it } from 'vitest'
import { strToU8 } from 'fflate'
import { fakeJar } from '../../../tests/fixtures/fakeJar'
import { parseLenientJson, pickNames, scanJar } from './jarScanner'

describe('scanJar', () => {
  it('Forge の Mod の情報・表示名・ブロック状態の定義を読む', () => {
    const bytes = fakeJar({
      forgeMods: [{ modId: 'testmod', displayName: 'Test Mod', version: '${file.jarVersion}' }],
      manifestVersion: '1.2.3',
      lang: {
        testmod: {
          ja_jp: { 'block.testmod.gear': 'テスト歯車', 'item.testmod.wrench': 'テストレンチ' },
          en_us: { 'block.testmod.gear': 'Test Gear' },
        },
      },
      blockStates: { 'testmod:gear': { variants: { 'axis=x': { model: 'testmod:block/gear' } } } },
    })
    const s = scanJar('testmod-1.2.3.jar', bytes)
    expect(s.mods).toEqual([{ modId: 'testmod', name: 'Test Mod', version: '1.2.3', jar: 'testmod-1.2.3.jar' }])
    expect(s.namespaces).toEqual(['testmod'])
    expect(s.lang.ja_jp).toEqual({ 'block.testmod.gear': 'テスト歯車', 'item.testmod.wrench': 'テストレンチ' })
    expect(s.lang.en_us).toEqual({ 'block.testmod.gear': 'Test Gear' })
    expect(s.blockStates['testmod:gear']).toEqual({ variants: { 'axis=x': { model: 'testmod:block/gear' } } })
    expect(s.problems).toEqual([])
  })

  it('NeoForge と Fabric の Mod の情報を読む', () => {
    const neo = scanJar('neo.jar', fakeJar({ neoforgeMods: [{ modId: 'neomod', version: '2.0' }] }))
    expect(neo.mods).toEqual([{ modId: 'neomod', name: 'neomod', version: '2.0', jar: 'neo.jar' }])
    const fabric = scanJar('fab.jar', fakeJar({ fabricMod: { modId: 'fabmod', displayName: 'Fab', version: '0.1' } }))
    expect(fabric.mods).toEqual([{ modId: 'fabmod', name: 'Fab', version: '0.1', jar: 'fab.jar' }])
  })

  it('namespace は assets/ の下のフォルダ名で決まり、modId と違ってよい', () => {
    const s = scanJar('a.jar', fakeJar({
      forgeMods: [{ modId: 'mod_id' }],
      files: { 'assets/other_ns/textures/block/x.png': new Uint8Array([1]), 'data/data_only/x.json': '{}' },
    }))
    expect(s.namespaces).toEqual(['other_ns'])
  })

  it('名前以外の翻訳（説明文など）は捨てる', () => {
    expect(
      pickNames({
        'block.testmod.gear': '歯車',
        'block.testmod.gear.tooltip': '説明',
        'testmod.ponder.text': '文',
        'item.testmod.x': 1,
      }),
    ).toEqual({ 'block.testmod.gear': '歯車' })
  })

  it('壊れた JSON は problems に書いて、ほかは読む', () => {
    const s = scanJar('b.jar', fakeJar({
      files: { 'assets/t/lang/ja_jp.json': '{ broken', 'assets/t/lang/en_us.json': '﻿{"block.t.a":"A"}' },
    }))
    expect(s.lang.en_us).toEqual({ 'block.t.a': 'A' })
    expect(s.problems).toEqual(['assets/t/lang/ja_jp.json: JSON として読めません'])
  })

  it('文字列の中の改行や、閉じかっこの前の余分な , がある JSON も読む', () => {
    expect(parseLenientJson('{"a": "1行目\r\n2行目",\n "b": ["x",],\n}')).toEqual({ a: '1行目\r\n2行目', b: ['x'] })
    expect(parseLenientJson('{"a": "x, }"}')).toEqual({ a: 'x, }' })
    expect(() => parseLenientJson('{ broken')).toThrow()
  })

  it('jar の中の jar も読み、外の jar の表示名を優先する', () => {
    const inner = fakeJar({
      forgeMods: [{ modId: 'inner', version: '1' }],
      lang: { inner: { en_us: { 'block.inner.x': 'Inner X' } }, outer: { en_us: { 'block.outer.y': 'from inner' } } },
    })
    const outer = fakeJar({
      forgeMods: [{ modId: 'outer', version: '1' }],
      lang: { outer: { en_us: { 'block.outer.y': 'Outer Y' } } },
      nestedJars: { 'inner-1.jar': inner },
    })
    const s = scanJar('outer.jar', outer)
    expect(s.mods.map((m) => m.modId)).toEqual(['outer', 'inner'])
    expect(s.mods[1].jar).toBe('outer.jar!/META-INF/jarjar/inner-1.jar')
    expect(s.namespaces).toEqual(['inner', 'outer'])
    expect(s.lang.en_us).toEqual({ 'block.inner.x': 'Inner X', 'block.outer.y': 'Outer Y' })
  })

  it('zip でなければエラーを投げる', () => {
    expect(() => scanJar('bad.jar', strToU8('not a zip'))).toThrow()
  })
})
