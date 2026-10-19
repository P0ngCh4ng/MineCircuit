import { onBeforeUnmount, onMounted } from 'vue'
import { isTextInputTarget, resolveKeyAction, type KeyAction } from './keymap'

/** 操作ごとの処理。まだない操作は書かなくてよい（そのキーは何もしない） */
export type KeyActionHandlers = {
  readonly [T in KeyAction['type']]?: (action: Extract<KeyAction, { type: T }>) => void
}

/**
 * キー入力を操作に変えて handlers に渡す。処理したキーはブラウザの既定の動き（PageDown のスクロールなど）を止める。
 * 入力欄で打っている間は何もしない。
 */
export function handleKeyEvent(e: KeyboardEvent, handlers: KeyActionHandlers): boolean {
  if (e.defaultPrevented || isTextInputTarget(e.target)) return false
  const action = resolveKeyAction(e)
  if (!action) return false
  const handler = handlers[action.type] as ((a: KeyAction) => void) | undefined
  if (!handler) return false
  handler(action)
  e.preventDefault()
  return true
}

/** 部品が表示されている間、window のキー入力を受け取る */
export function useKeyboardShortcuts(handlers: KeyActionHandlers): void {
  const listener = (e: KeyboardEvent) => {
    handleKeyEvent(e, handlers)
  }
  onMounted(() => window.addEventListener('keydown', listener))
  onBeforeUnmount(() => window.removeEventListener('keydown', listener))
}
