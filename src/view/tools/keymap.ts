import type { ToolId } from './tool'
import { TOOL_CATALOG } from './toolCatalog'

/**
 * キー操作の結果。docs/ui.md「キー操作」。
 * 解釈だけをここで行い、実際の処理は受け取る側（useKeyboardShortcuts の handlers）が行う。
 */
export type KeyAction =
  | { readonly type: 'tool'; readonly id: ToolId }
  | { readonly type: 'rotateBrush'; readonly vertical: boolean }
  | { readonly type: 'undo' }
  | { readonly type: 'redo' }
  | { readonly type: 'deleteSelection' }
  | { readonly type: 'toggleGrid' }
  | { readonly type: 'layerUp' }
  | { readonly type: 'layerDown' }
  | { readonly type: 'clearSelection' }

/** KeyboardEvent のうち使う部分。テストで偽物を渡せるようにする */
export interface KeyInput {
  readonly key: string
  readonly shiftKey: boolean
  readonly ctrlKey: boolean
  readonly metaKey: boolean
  readonly altKey: boolean
  /** IME で変換中なら true */
  readonly isComposing?: boolean
}

const TOOL_KEYS: ReadonlyMap<string, ToolId> = new Map(
  TOOL_CATALOG.flatMap((t) => (t.key ? [[t.key.toLowerCase(), t.id] as const] : [])),
)

/** キー入力を操作に変える。割り当てがなければ null */
export function resolveKeyAction(e: KeyInput): KeyAction | null {
  if (e.isComposing) return null
  const key = e.key.toLowerCase()
  // Mac の Cmd も Ctrl と同じに扱う
  const ctrl = e.ctrlKey || e.metaKey

  if (ctrl && !e.altKey) {
    if (key === 'z' && !e.shiftKey) return { type: 'undo' }
    if (key === 'y' && !e.shiftKey) return { type: 'redo' }
    return null
  }
  if (e.altKey) return null

  switch (key) {
    case 'r':
      return { type: 'rotateBrush', vertical: e.shiftKey }
    case 'delete':
      return { type: 'deleteSelection' }
    case 'escape':
      return { type: 'clearSelection' }
    case 'pageup':
      return { type: 'layerUp' }
    case 'pagedown':
      return { type: 'layerDown' }
  }
  if (e.shiftKey) return null
  if (key === 'g') return { type: 'toggleGrid' }
  const tool = TOOL_KEYS.get(key)
  return tool ? { type: 'tool', id: tool } : null
}

/**
 * 入力欄で打っている文字はキー操作にしない。
 * イベントの target が入力欄・選択肢・編集できる要素なら true。
 */
export function isTextInputTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as { tagName?: unknown }).tagName !== 'string') return false
  const el = target as HTMLElement
  const tag = el.tagName.toLowerCase()
  if (tag === 'textarea' || tag === 'select') return true
  if (tag === 'input') {
    const type = (el as HTMLInputElement).type
    // ボタンやチェックボックスは文字を打たないので、キー操作を通す
    return !['button', 'checkbox', 'radio', 'range', 'color', 'submit', 'reset'].includes(type)
  }
  return el.isContentEditable === true
}
