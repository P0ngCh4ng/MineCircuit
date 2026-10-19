import { describe, expect, it } from 'vitest'
import { isTextInputTarget, resolveKeyAction, type KeyInput } from './keymap'

function k(key: string, mods: Partial<Omit<KeyInput, 'key'>> = {}): KeyInput {
  return { key, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...mods }
}

describe('resolveKeyAction', () => {
  it('V / M / C / B / E / I でツールを切り替える（大文字・小文字とも）', () => {
    const expected = { v: 'select', m: 'measure', c: 'connect', b: 'place', e: 'erase', i: 'pick' }
    for (const [key, id] of Object.entries(expected)) {
      expect(resolveKeyAction(k(key))).toEqual({ type: 'tool', id })
      expect(resolveKeyAction(k(key.toUpperCase()))).toEqual({ type: 'tool', id })
    }
  })

  it('R は水平、Shift+R は縦に回す', () => {
    expect(resolveKeyAction(k('r'))).toEqual({ type: 'rotateBrush', vertical: false })
    expect(resolveKeyAction(k('R', { shiftKey: true }))).toEqual({ type: 'rotateBrush', vertical: true })
  })

  it('Ctrl+Z / Ctrl+Y（Mac は Cmd）で元に戻す・やり直す', () => {
    expect(resolveKeyAction(k('z', { ctrlKey: true }))).toEqual({ type: 'undo' })
    expect(resolveKeyAction(k('y', { ctrlKey: true }))).toEqual({ type: 'redo' })
    expect(resolveKeyAction(k('z', { metaKey: true }))).toEqual({ type: 'undo' })
  })

  it('そのほかのキー', () => {
    expect(resolveKeyAction(k('Delete'))).toEqual({ type: 'deleteSelection' })
    expect(resolveKeyAction(k('g'))).toEqual({ type: 'toggleGrid' })
    expect(resolveKeyAction(k('PageUp'))).toEqual({ type: 'layerUp' })
    expect(resolveKeyAction(k('PageDown'))).toEqual({ type: 'layerDown' })
    expect(resolveKeyAction(k('Escape'))).toEqual({ type: 'clearSelection' })
  })

  it('Ctrl や Alt と一緒のツールキー、割り当てのないキー、IME の変換中は無視する', () => {
    expect(resolveKeyAction(k('v', { ctrlKey: true }))).toBeNull()
    expect(resolveKeyAction(k('b', { altKey: true }))).toBeNull()
    expect(resolveKeyAction(k('B', { shiftKey: true }))).toBeNull()
    expect(resolveKeyAction(k('q'))).toBeNull()
    expect(resolveKeyAction(k('v', { isComposing: true }))).toBeNull()
  })
})

describe('isTextInputTarget', () => {
  it('文字を打つ入力欄なら true', () => {
    const text = document.createElement('input')
    expect(isTextInputTarget(text)).toBe(true)
    expect(isTextInputTarget(document.createElement('textarea'))).toBe(true)
    expect(isTextInputTarget(document.createElement('select'))).toBe(true)
  })

  it('ボタン、チェックボックス、ふつうの要素なら false', () => {
    const check = document.createElement('input')
    check.type = 'checkbox'
    expect(isTextInputTarget(check)).toBe(false)
    expect(isTextInputTarget(document.createElement('button'))).toBe(false)
    expect(isTextInputTarget(document.createElement('div'))).toBe(false)
    expect(isTextInputTarget(null)).toBe(false)
  })
})
