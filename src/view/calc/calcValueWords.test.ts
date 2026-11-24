import { describe, expect, it } from 'vitest'
import { calcValueWords } from './calcValueWords'

describe('calcValueWords', () => {
  it('名前がなければ「計算の値」', () => {
    expect(calcValueWords([])).toBe('計算の値')
  })

  it('2つまではそのまま並べる', () => {
    expect(calcValueWords(['電力'])).toBe('電力')
    expect(calcValueWords(['回転数', '応力'])).toBe('回転数・応力')
  })

  it('多いときは先頭の2つに「など」を付ける', () => {
    expect(calcValueWords(['回転数', '応力', '輸送量'])).toBe('回転数・応力など')
  })
})
