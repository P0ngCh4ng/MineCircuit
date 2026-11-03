import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { blueprintFixture, state } from '../../../tests/fixtures/blueprintFixture'
import { placeBlock } from '../../edit/editCommand'
import { createDocumentSession, type DocumentSession } from './documentSession'
import { closeMessage, confirmDiscard, discardMessage, useUnsavedChangesGuard, type AskConfirm } from './unsavedChanges'

// デスクトップ版のウィンドウを閉じる求め（#173）。テストでは受けた関数を持っておき、閉じる操作の代わりに呼ぶ
const windowClose = vi.hoisted(() => ({ shouldClose: null as (() => boolean | Promise<boolean>) | null, stop: vi.fn() }))
vi.mock('../platform/windowClose', () => ({
  onDesktopWindowClose: async (shouldClose: () => boolean | Promise<boolean>) => {
    windowClose.shouldClose = shouldClose
    return () => {
      windowClose.shouldClose = null
      windowClose.stop()
    }
  },
}))

function editedSession(): DocumentSession {
  const session = createDocumentSession()
  const doc = session.setBlueprint(blueprintFixture({ size: [1, 1, 1] }).toBlueprint())
  session.apply(placeBlock(doc.blueprint, [0, 0, 0], state('minecraft:stone'), false))
  return session
}

function unload(): Event {
  const e = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(e)
  return e
}

describe('confirmDiscard', () => {
  it('書き出していない変更がなければ確かめずに続ける', async () => {
    const ask = vi.fn(() => false)
    expect(await confirmDiscard(createDocumentSession(), ask)).toBe(true)
    const session = createDocumentSession()
    session.setBlueprint(blueprintFixture({ size: [1, 1, 1] }).toBlueprint())
    expect(await confirmDiscard(session, ask)).toBe(true)
    expect(ask).not.toHaveBeenCalled()
  })

  it('書き出していない変更があれば、回数を書いて確かめる', async () => {
    const session = editedSession()
    const ask = vi.fn(() => false)
    expect(await confirmDiscard(session, ask)).toBe(false)
    expect(ask).toHaveBeenCalledWith(discardMessage(1))
    expect(discardMessage(1)).toBe(
      '開いている設計図に、書き出していない変更が 1 回あります。続けると、この変更はなくなります。続けますか。',
    )
    expect(await confirmDiscard(session, () => true)).toBe(true)
  })

  it('デスクトップ版の確認（答えが Promise）は、答えを待ってから決める（#225）', async () => {
    const session = editedSession()
    expect(await confirmDiscard(session, async () => false)).toBe(false)
    expect(await confirmDiscard(session, async () => true)).toBe(true)
  })

  it('書き出した印を付けると確かめない', async () => {
    const session = editedSession()
    const doc = session.current.value!
    session.markExported(doc, doc.history.changeCount)
    expect(session.unsavedChanges.value).toBe(0)
    expect(await confirmDiscard(session, () => false)).toBe(true)
  })
})

describe('useUnsavedChangesGuard', () => {
  let unmount: (() => void) | null = null
  afterEach(() => {
    unmount?.()
    unmount = null
  })

  function guard(session: DocumentSession, ask?: AskConfirm): void {
    const wrapper = mount(
      defineComponent({
        setup() {
          useUnsavedChangesGuard(session, ask)
          return () => h('div')
        },
      }),
    )
    unmount = () => wrapper.unmount()
  }

  it('書き出していない変更があれば、ページを閉じる前に確認を出す', () => {
    const session = editedSession()
    guard(session)
    expect(unload().defaultPrevented).toBe(true)

    const doc = session.current.value!
    session.markExported(doc, doc.history.changeCount)
    expect(unload().defaultPrevented).toBe(false)
  })

  it('デスクトップ版でウィンドウを閉じる前に、書き出していない変更を確かめる（#173）', async () => {
    const session = editedSession()
    const ask = vi.fn(() => false)
    guard(session, ask)
    await flushPromises()
    expect(await windowClose.shouldClose?.()).toBe(false)
    expect(ask).toHaveBeenCalledWith(closeMessage(1))
    expect(closeMessage(1)).toBe(
      '開いている設計図に、書き出していない変更が 1 回あります。閉じると、この変更はなくなります。閉じますか。',
    )
    ask.mockReturnValue(true)
    expect(await windowClose.shouldClose?.()).toBe(true)

    const doc = session.current.value!
    session.markExported(doc, doc.history.changeCount)
    ask.mockClear()
    expect(await windowClose.shouldClose?.()).toBe(true)
    expect(ask).not.toHaveBeenCalled()

    unmount?.()
    unmount = null
    expect(windowClose.stop).toHaveBeenCalled()
    expect(windowClose.shouldClose).toBeNull()
  })

  it('デスクトップ版でウィンドウを閉じるとき、確認の答え（Promise）を待つ。やめたら閉じない（#225）', async () => {
    const session = editedSession()
    guard(session, async () => false)
    await flushPromises()
    expect(await windowClose.shouldClose?.()).toBe(false)
  })

  it('部品を外したら確認を出さない', () => {
    guard(editedSession())
    unmount?.()
    unmount = null
    expect(unload().defaultPrevented).toBe(false)
  })
})
