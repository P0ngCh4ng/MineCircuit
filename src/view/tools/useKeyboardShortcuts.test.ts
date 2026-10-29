import { describe, expect, it, vi } from 'vitest'
import { handleKeyEvent } from './useKeyboardShortcuts'

function keydown(key: string, init: KeyboardEventInit, target: EventTarget): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key, cancelable: true, bubbles: true, ...init })
  Object.defineProperty(e, 'target', { value: target })
  return e
}

describe('handleKeyEvent', () => {
  it('Ctrl+A で全体を選び、ブラウザの「すべて選択」を止める', () => {
    const selectAll = vi.fn()
    const e = keydown('a', { ctrlKey: true }, document.createElement('div'))
    expect(handleKeyEvent(e, { selectAll })).toBe(true)
    expect(selectAll).toHaveBeenCalledOnce()
    expect(e.defaultPrevented).toBe(true)
  })

  it('入力欄で打った Ctrl+A と F は、入力欄の文字の操作にする', () => {
    const selectAll = vi.fn()
    const fillSelection = vi.fn()
    const input = document.createElement('input')
    const ctrlA = keydown('a', { ctrlKey: true }, input)
    expect(handleKeyEvent(ctrlA, { selectAll, fillSelection })).toBe(false)
    expect(handleKeyEvent(keydown('f', {}, input), { selectAll, fillSelection })).toBe(false)
    expect(selectAll).not.toHaveBeenCalled()
    expect(fillSelection).not.toHaveBeenCalled()
    expect(ctrlA.defaultPrevented).toBe(false)
  })

  it('Ctrl+S は入力欄で打っても書き出し、ブラウザのページの保存を止める（#151）', () => {
    const exportBlueprint = vi.fn()
    const e = keydown('s', { ctrlKey: true }, document.createElement('input'))
    expect(handleKeyEvent(e, { export: exportBlueprint })).toBe(true)
    expect(exportBlueprint).toHaveBeenCalledOnce()
    expect(e.defaultPrevented).toBe(true)
  })

  it('処理を渡されていない操作のキーは、何もせず既定の動きを残す', () => {
    const e = keydown('f', {}, document.createElement('div'))
    expect(handleKeyEvent(e, {})).toBe(false)
    expect(e.defaultPrevented).toBe(false)
  })
})
