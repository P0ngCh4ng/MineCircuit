// 書き出していない変更をなくす前の確認（#150、docs/ui.md「書き出していない変更」）。
// 設計図を入れ替える前と、ページ（デスクトップ版はウィンドウ。#173）を閉じる前に確かめる。
// デスクトップ版の確認は OS の確認の画面で、答えが Promise で返る。そのため確認の答えは、どちらの版でも待ってから使う（#225）。

import { onBeforeUnmount, onMounted } from 'vue'
import { confirmOnPlatform } from '../platform/confirmDialog'
import { onDesktopWindowClose } from '../platform/windowClose'
import type { DocumentSession } from './documentSession'

/** 確認を出して、続けるなら true を返す。ブラウザ版はすぐ、デスクトップ版は Promise で答える */
export type AskConfirm = (message: string) => boolean | Promise<boolean>

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
 * ask は確認を出して、続けるなら true を返す（既定はブラウザ版は window.confirm、デスクトップ版は OS の確認の画面）
 */
export async function confirmDiscard(session: DocumentSession, ask: AskConfirm = confirmOnPlatform): Promise<boolean> {
  const changes = session.unsavedChanges.value
  if (changes === 0) return true
  return (await ask(discardMessage(changes))) === true
}

/**
 * 書き出していない変更があるとき、ページを閉じる・再読み込みする前にブラウザの確認を出す。
 * 確認の文はブラウザが決める（ページからは変えられない）。
 * デスクトップ版では、ウィンドウを閉じる前にも確かめる（ask）。部品の setup の中で呼ぶ
 */
export function useUnsavedChangesGuard(session: DocumentSession, ask: AskConfirm = confirmOnPlatform): void {
  const onBeforeUnload = (e: BeforeUnloadEvent) => {
    if (session.unsavedChanges.value === 0) return
    e.preventDefault()
    // 古いブラウザは returnValue に文字が入っていないと確認を出さない
    e.returnValue = ''
  }
  const shouldCloseWindow = async (): Promise<boolean> => {
    const changes = session.unsavedChanges.value
    return changes === 0 || (await ask(closeMessage(changes))) === true
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
