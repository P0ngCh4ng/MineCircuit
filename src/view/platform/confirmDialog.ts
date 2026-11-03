// OK・キャンセルの確認（#225、docs/ui.md「書き出していない変更」）。
// ブラウザ版は window.confirm。デスクトップ版は dialog プラグインの OS の確認の画面（許可 dialog:allow-message）。
// デスクトップ版の window.confirm は dialog プラグインが差し替えるが、今の版ではなくなったコマンドを呼ぶので使わない。
import { confirm } from '@tauri-apps/plugin-dialog'
import { isDesktop } from './platform'

/** 確認を出して、OK なら true */
export async function confirmOnPlatform(message: string): Promise<boolean> {
  if (!isDesktop()) return window.confirm(message)
  return confirm(message, { title: 'MineCircuit', kind: 'warning', okLabel: 'OK', cancelLabel: 'キャンセル' })
}
