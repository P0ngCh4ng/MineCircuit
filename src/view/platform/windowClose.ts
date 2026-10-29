// デスクトップ版でウィンドウを閉じる求めを受ける（#173、docs/ui.md「書き出していない変更」）。
// 閉じるのを止めなかったとき、Tauri はウィンドウを自分で壊す（destroy）ので、許可 core:window:allow-destroy が要る。
import { getCurrentWindow } from '@tauri-apps/api/window'
import { isDesktop } from './platform'

/**
 * デスクトップ版でウィンドウを閉じようとしたとき shouldClose を呼び、false なら閉じない。
 * ブラウザ版では何もしない（ブラウザ版は beforeunload で確かめる）。受けるのをやめる関数を返す
 */
export async function onDesktopWindowClose(shouldClose: () => boolean): Promise<() => void> {
  if (!isDesktop()) return () => {}
  return getCurrentWindow().onCloseRequested((event) => {
    if (!shouldClose()) event.preventDefault()
  })
}
