// 書き出していない変更をなくす前の確認（#150、docs/ui.md「書き出していない変更」）。
// 設計図を入れ替える前と、ページ（デスクトップ版はウィンドウ。#173）を閉じる前に確かめる。

import { onBeforeUnmount, onMounted } from 'vue'
import { onDesktopWindowClose } from '../platform/windowClose'
import type { DocumentSession } from './documentSession'

/** 入れ替えの前に出す確認の文 */
export function discardMessage(changes: number): string {
  return (
    `開いている設計図に、書き出していない変更が ${changes.toLocaleString('ja-JP')} 回あります。` +
    '続けると、この変更はなくなります。続けますか。'
  )
}

/** デスクトップ版でウィンドウを閉じる前に出す確認の文 */
export function closeMessage(changes: number): string {
  return (
    `開いている設計図に、書き出していない変更が ${changes.toLocaleString('ja-JP')} 回あります。` +
    '閉じると、この変更はなくなります。閉じますか。'
  )
}

/**
 * 設計図を入れ替えてよいかを確かめる。書き出していない変更がなければ確かめずに true。
 * ask は確認を出して、続けるなら true を返す（既定は window.confirm）
 */
export function confirmDiscard(
  session: DocumentSession,
  ask: (message: string) => boolean = (message) => window.confirm(message),
): boolean {
  const changes = session.unsavedChanges.value
  if (changes === 0) return true
  return ask(discardMessage(changes))
}

/**
 * 書き出していない変更があるとき、ページを閉じる・再読み込みする前にブラウザの確認を出す。
 * 確認の文はブラウザが決める（ページからは変えられない）。
 * デスクトップ版では、ウィンドウを閉じる前にも確かめる（ask。既定は window.confirm）。部品の setup の中で呼ぶ
 */
export function useUnsavedChangesGuard(
  session: DocumentSession,
  ask: (message: string) => boolean = (message) => window.confirm(message),
): void {
  const onBeforeUnload = (e: BeforeUnloadEvent) => {
    if (session.unsavedChanges.value === 0) return
    e.preventDefault()
    // 古いブラウザは returnValue に文字が入っていないと確認を出さない
    e.returnValue = ''
  }
  const shouldCloseWindow = (): boolean => {
    const changes = session.unsavedChanges.value
    return changes === 0 || ask(closeMessage(changes))
  }
  let stopWindowClose: (() => void) | null = null
  let unmounted = false
  onMounted(() => {
    window.addEventListener('beforeunload', onBeforeUnload)
    void onDesktopWindowClose(shouldCloseWindow).then((stop) => {
      // 受け始める前に部品が外れていたら、すぐやめる
      if (unmounted) stop()
      else stopWindowClose = stop
    })
  })
  onBeforeUnmount(() => {
    unmounted = true
    window.removeEventListener('beforeunload', onBeforeUnload)
    stopWindowClose?.()
  })
}
