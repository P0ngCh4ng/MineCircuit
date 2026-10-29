// 書き出していない変更をなくす前の確認（#150、docs/ui.md「書き出していない変更」）。
// 設計図を入れ替える前と、ページを閉じる前に確かめる。

import { onBeforeUnmount, onMounted } from 'vue'
import type { DocumentSession } from './documentSession'

/** 入れ替えの前に出す確認の文 */
export function discardMessage(changes: number): string {
  return (
    `開いている設計図に、書き出していない変更が ${changes.toLocaleString('ja-JP')} 回あります。` +
    '続けると、この変更はなくなります。続けますか。'
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
 * 部品の setup の中で呼ぶ。確認の文はブラウザが決める（ページからは変えられない）
 */
export function useUnsavedChangesGuard(session: DocumentSession): void {
  const onBeforeUnload = (e: BeforeUnloadEvent) => {
    if (session.unsavedChanges.value === 0) return
    e.preventDefault()
    // 古いブラウザは returnValue に文字が入っていないと確認を出さない
    e.returnValue = ''
  }
  onMounted(() => window.addEventListener('beforeunload', onBeforeUnload))
  onBeforeUnmount(() => window.removeEventListener('beforeunload', onBeforeUnload))
}
